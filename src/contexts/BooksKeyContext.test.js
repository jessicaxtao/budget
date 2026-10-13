import { renderHook, act, waitFor } from "@testing-library/react";
import { AUTH_STATUS, AuthProvider, useAuth } from "./AuthContext";
import { BOOKS_KEY_STATUS, BooksKeyProvider, useBooksKey } from "./BooksKeyContext";
import { clearBooksKey, getBooksKey } from "../booksKey";
import { decryptDocument, encryptDocument, newKeyRecord } from "../booksCrypto";
import { BOOKS_KEY_CACHE_KEY, clearScope, readKey, setStorageScope, writeKey } from "../storage";

// Names must begin with `mock` — jest hoists the factory above the imports.
// Same shape as AuthContext.test.js, since this suite mounts the real
// AuthProvider above the real BooksKeyProvider.
let mockConfigured = true;

const mockAuth = {
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signOut: jest.fn(),
};

const mockDb = { from: jest.fn() };

jest.mock("../supabaseClient", () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  getSupabase: () => {
    if (!mockConfigured) return null;
    return {
      auth: mockAuth,
      from: (...args) => mockDb.from(...args),
    };
  },
}));

const USER_ID = "u1";

/**
 * A fake `app_crypto` table holding one row, which is all the real one ever
 * holds per account. Returns the stub `from("app_crypto")` resolves to, and
 * records every write so a test can assert that a password change wrote
 * **one** row and touched no document.
 */
function cryptoTable(initialRow = null) {
  const table = {
    row: initialRow,
    upserts: [],
    updates: [],
  };

  mockDb.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: table.row, error: null }),
      }),
    }),
    upsert: (values) => {
      table.upserts.push(values);
      // `ignoreDuplicates` — the first insert wins and later ones are no-ops,
      // which is the whole mechanism the set-up race relies on.
      if (!table.row) table.row = { ...values };
      return Promise.resolve({ error: null });
    },
    update: (patch) => {
      table.updates.push(patch);
      table.row = { ...table.row, ...patch };
      return { eq: () => Promise.resolve({ error: null }) };
    },
  }));

  return table;
}

beforeEach(() => {
  mockConfigured = true;
  localStorage.clear();
  setStorageScope(null);
  clearBooksKey();

  mockAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: USER_ID, email: "a@b.com" } } },
    error: null,
  });
  mockAuth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  mockAuth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  setStorageScope(null);
  clearBooksKey();
});

const wrapper = ({ children }) => (
  <AuthProvider>
    <BooksKeyProvider>{children}</BooksKeyProvider>
  </AuthProvider>
);

/**
 * The key context, plus the auth status above it.
 *
 * `authStatus` is here for the trap below, not because anything in the app
 * reads the two together.
 */
function useGate() {
  const { status: authStatus } = useAuth();
  return { authStatus, ...useBooksKey() };
}

/**
 * Mount and wait for the status this test is actually about.
 *
 * **Waiting for "not `checking`" is not enough, and the reason is a trap worth
 * naming**: `remote` is false for one tick while `AuthProvider`'s own session
 * check is still `checking`, so this provider's status starts at `unlocked` —
 * the correct answer for a build with no server, and the wrong one here. A
 * `waitFor` that only refused `checking` would resolve on that first tick,
 * before the row was ever read, and every assertion after it would be about
 * the inert path. So the caller names the state it expects and we wait for
 * exactly that.
 */
async function mountKey(expected) {
  const rendered = renderHook(() => useGate(), { wrapper });
  await waitFor(() => {
    expect(rendered.result.current.authStatus).not.toBe(AUTH_STATUS.CHECKING);
  });
  await waitFor(() => {
    expect(rendered.result.current.status).toBe(expected);
  });
  return rendered;
}

/** The cache as this device actually wrote it, read under the account's scope. */
function cachedUnderAccount() {
  setStorageScope(USER_ID);
  try {
    return readKey(BOOKS_KEY_CACHE_KEY);
  } finally {
    setStorageScope(null);
  }
}

/**
 * Stand in for a *different* device — or the same one after a sign-out.
 *
 * Both halves have to go, and forgetting the second is the easy mistake:
 * `clearBooksKey` only drops the key this page load is holding in memory,
 * while the cache in storage is exactly what makes a remount unlock without
 * asking. Clearing one and not the other tests the remembering path while
 * believing it tests the asking one.
 */
function forgetDevice() {
  clearBooksKey();
  clearScope(USER_ID);
}

// PBKDF2 at 600,000 iterations is deliberately slow and several of these
// derive two or three KEKs. Raised rather than weakened: lowering the
// iteration count in a test would be testing a KDF the app does not ship.
jest.setTimeout(30000);

// ---------------------------------------------------------------------------
// Setting up
// ---------------------------------------------------------------------------

describe("an account with no key yet", () => {
  test("asks to set one up, and set-up unlocks and returns a recovery code once", async () => {
    const table = cryptoTable(null);
    const { result } = await mountKey(BOOKS_KEY_STATUS.SETUP);

    expect(result.current.status).toBe(BOOKS_KEY_STATUS.SETUP);

    let outcome;
    await act(async () => {
      outcome = await result.current.setUp("a-long-books-password");
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.UNLOCKED);

    // One row written, carrying both wraps and neither secret.
    expect(table.upserts).toHaveLength(1);
    const written = table.upserts[0];
    expect(written.user_id).toBe(USER_ID);
    expect(Object.keys(written).sort()).toEqual(
      [
        "kdf",
        "kid",
        "password_salt",
        "password_wrap",
        "recovery_salt",
        "recovery_wrap",
        "user_id",
      ].sort()
    );
    // The thing that must never be on the wire.
    expect(JSON.stringify(written)).not.toContain("a-long-books-password");
    expect(JSON.stringify(written)).not.toContain(outcome.recoveryCode);
  });

  test("a password under twelve characters is refused before anything is written", async () => {
    const table = cryptoTable(null);
    const { result } = await mountKey(BOOKS_KEY_STATUS.SETUP);

    let outcome;
    await act(async () => {
      outcome = await result.current.setUp("short");
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/at least 12/);
    expect(table.upserts).toHaveLength(0);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.SETUP);
  });

  /**
   * Two devices on the set-up screen at once. `ignoreDuplicates` lets only one
   * insert land, and the re-select is what tells this device it lost — at
   * which point the key it generated must be thrown away, because documents
   * sealed under it could not be opened by the device that won.
   */
  test("losing the set-up race discards our key and falls to locked", async () => {
    const theirs = await newKeyRecord("the-other-device-password");
    const table = cryptoTable({ user_id: USER_ID, ...theirs.record });

    // A row already exists, so this device mounts straight into `locked`;
    // drive `setUp` anyway, which is the state a device that read "no row" a
    // moment earlier would be in.
    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);

    let outcome;
    await act(async () => {
      outcome = await result.current.setUp("this-device-password");
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/another device/i);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);
    // Nothing was handed to the rest of the app, and no cache was written.
    expect(getBooksKey()).toBeNull();
    expect(cachedUnderAccount()).toBeUndefined();
    expect(table.row.kid).toBe(theirs.kid);
  });
});

// ---------------------------------------------------------------------------
// Unlocking
// ---------------------------------------------------------------------------

describe("an account whose key this device has not opened", () => {
  test("the right password unlocks it and the key opens a real document", async () => {
    const created = await newKeyRecord("the-right-password");
    cryptoTable({ user_id: USER_ID, ...created.record });

    // A document sealed under the key that was set up elsewhere.
    const sealed = await encryptDocument(created.mk, created.kid, [{ id: "t1", amountCents: 999 }]);

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);

    await act(async () => {
      expect(await result.current.unlock("the-right-password")).toEqual({ ok: true });
    });

    expect(result.current.status).toBe(BOOKS_KEY_STATUS.UNLOCKED);

    // The claim worth making: not that a flag flipped, but that what came back
    // actually opens the books.
    const key = getBooksKey();
    expect(key.kid).toBe(created.kid);
    expect(await decryptDocument(key.mk, sealed.envelope)).toEqual({
      ok: true,
      value: [{ id: "t1", amountCents: 999 }],
    });
  });

  test("a wrong password fails closed and says only that", async () => {
    const created = await newKeyRecord("the-right-password");
    cryptoTable({ user_id: USER_ID, ...created.record });

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);

    let outcome;
    await act(async () => {
      outcome = await result.current.unlock("the-wrong-password");
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("That password does not match.");
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);
    expect(getBooksKey()).toBeNull();
  });

  test("the recovery code is the second way in", async () => {
    const created = await newKeyRecord("forgotten-password-here");
    cryptoTable({ user_id: USER_ID, ...created.record });

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);

    await act(async () => {
      expect(await result.current.unlockWithRecoveryCode(created.recoveryCode)).toEqual({
        ok: true,
      });
    });

    expect(getBooksKey().kid).toBe(created.kid);
  });

  // People retype what they wrote down, and they do not retype it exactly.
  test("a recovery code retyped lowercase and without hyphens still unlocks", async () => {
    const created = await newKeyRecord("forgotten-password-here");
    cryptoTable({ user_id: USER_ID, ...created.record });

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);

    const mangled = created.recoveryCode.toLowerCase().replace(/-/g, " ");
    await act(async () => {
      expect(await result.current.unlockWithRecoveryCode(mangled)).toEqual({ ok: true });
    });

    expect(getBooksKey().kid).toBe(created.kid);
  });
});

// ---------------------------------------------------------------------------
// Remembering the key between loads
// ---------------------------------------------------------------------------

describe("the cached key", () => {
  test("a remount reads it back and never asks for the password", async () => {
    const created = await newKeyRecord("the-right-password");
    cryptoTable({ user_id: USER_ID, ...created.record });

    const first = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    await act(async () => {
      await first.result.current.unlock("the-right-password");
    });
    expect(first.result.current.status).toBe(BOOKS_KEY_STATUS.UNLOCKED);
    first.unmount();

    // A new page load: the module-held key is gone, the cache is not.
    clearBooksKey();
    const second = await mountKey(BOOKS_KEY_STATUS.UNLOCKED);

    expect(second.result.current.status).toBe(BOOKS_KEY_STATUS.UNLOCKED);
    expect(getBooksKey().kid).toBe(created.kid);
  });

  /**
   * **The cache must be written under the account's own scope.**
   *
   * `BooksKeyProvider` sits above `SyncProvider`, which is the only thing in
   * the app that calls `setStorageScope` — so at the moment this provider
   * first touches storage the scope is still null. An unscoped write would put
   * the master key under the bare key `booksKey`, where `clearScope` would
   * never reach it, and it would **survive sign-out** for whoever opens this
   * browser next. This test is the tripwire for that, and it is why it asserts
   * the bare key is absent as well as that the scoped one is present.
   */
  test("is written under the account's scope, not unscoped", async () => {
    cryptoTable(null);
    const { result } = await mountKey(BOOKS_KEY_STATUS.SETUP);

    await act(async () => {
      await result.current.setUp("a-long-books-password");
    });

    expect(cachedUnderAccount()).toEqual({
      raw: expect.any(String),
      kid: expect.any(String),
    });

    // Nothing unscoped — the slot that would outlive the session.
    setStorageScope(null);
    expect(readKey(BOOKS_KEY_CACHE_KEY)).toBeUndefined();
  });

  // The other half of the same claim, from `clearScope`'s side.
  test("leaves with the session", async () => {
    cryptoTable(null);
    const { result } = await mountKey(BOOKS_KEY_STATUS.SETUP);
    await act(async () => {
      await result.current.setUp("a-long-books-password");
    });
    expect(cachedUnderAccount()).toBeDefined();

    clearScope(USER_ID);

    expect(cachedUnderAccount()).toBeUndefined();
  });

  test("one that will not import falls to locked rather than crashing", async () => {
    const created = await newKeyRecord("the-right-password");
    cryptoTable({ user_id: USER_ID, ...created.record });

    setStorageScope(USER_ID);
    writeKey(BOOKS_KEY_CACHE_KEY, { raw: "not base64 at all!!", kid: created.kid });
    setStorageScope(null);

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);

    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);
    expect(getBooksKey()).toBeNull();
  });

  // A cache left over from a race this device lost names a key the row does
  // not. Refused on the `kid` rather than handed over as though it belonged.
  test("one naming another key is refused", async () => {
    const created = await newKeyRecord("the-right-password");
    const stale = await newKeyRecord("some-other-password");
    cryptoTable({ user_id: USER_ID, ...created.record });

    setStorageScope(USER_ID);
    writeKey(BOOKS_KEY_CACHE_KEY, { raw: "irrelevant", kid: stale.kid });
    setStorageScope(null);

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);

    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);
    expect(getBooksKey()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Changing the password, and the recovery code
// ---------------------------------------------------------------------------

describe("changing the books password", () => {
  /**
   * The point of envelope encryption, asserted rather than asserted *about*:
   * a password change rewraps 32 bytes and writes one row, and a document
   * sealed before it is still readable afterwards. If this ever needed to
   * re-encrypt the books, this test is what would notice.
   */
  test("rewraps the key, writes one row, and leaves every document readable", async () => {
    const created = await newKeyRecord("the-first-password");
    const table = cryptoTable({ user_id: USER_ID, ...created.record });
    const sealedBefore = await encryptDocument(created.mk, created.kid, [{ id: "b1" }]);

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    await act(async () => {
      await result.current.unlock("the-first-password");
    });

    await act(async () => {
      expect(await result.current.changePassword("the-second-password")).toEqual({ ok: true });
    });

    // One write, and only the password's own columns in it.
    expect(table.updates).toHaveLength(1);
    expect(Object.keys(table.updates[0]).sort()).toEqual(["kdf", "password_salt", "password_wrap"]);
    expect(table.row.kid).toBe(created.kid);

    // The document sealed under the old password still opens.
    expect(await decryptDocument(getBooksKey().mk, sealedBefore.envelope)).toEqual({
      ok: true,
      value: [{ id: "b1" }],
    });

    // And the new password is the one that works now.
    forgetDevice();
    const next = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    await act(async () => {
      expect((await next.result.current.unlock("the-first-password")).ok).toBe(false);
      expect(await next.result.current.unlock("the-second-password")).toEqual({ ok: true });
    });
  });

  test("it is refused while locked", async () => {
    const created = await newKeyRecord("the-first-password");
    const table = cryptoTable({ user_id: USER_ID, ...created.record });

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    expect(result.current.status).toBe(BOOKS_KEY_STATUS.LOCKED);

    let outcome;
    await act(async () => {
      outcome = await result.current.changePassword("a-long-enough-password");
    });

    expect(outcome.ok).toBe(false);
    expect(table.updates).toHaveLength(0);
  });

  test("regenerating the recovery code replaces it and keeps the key", async () => {
    const created = await newKeyRecord("the-first-password");
    const table = cryptoTable({ user_id: USER_ID, ...created.record });

    const { result } = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    await act(async () => {
      await result.current.unlock("the-first-password");
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.regenerateRecoveryCode();
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.recoveryCode).not.toBe(created.recoveryCode);
    expect(table.updates).toHaveLength(1);
    expect(Object.keys(table.updates[0]).sort()).toEqual(["recovery_salt", "recovery_wrap"]);

    // The old code stops working; the new one opens the same key.
    forgetDevice();
    const next = await mountKey(BOOKS_KEY_STATUS.LOCKED);
    await act(async () => {
      expect((await next.result.current.unlockWithRecoveryCode(created.recoveryCode)).ok).toBe(
        false
      );
      expect(await next.result.current.unlockWithRecoveryCode(outcome.recoveryCode)).toEqual({
        ok: true,
      });
    });
    expect(getBooksKey().kid).toBe(created.kid);
  });
});

// ---------------------------------------------------------------------------
// Inert where SyncProvider is
// ---------------------------------------------------------------------------

describe("with no account server", () => {
  /**
   * The reason every existing suite in this app stays green untouched: with
   * nothing configured there is no server to seal anything for, so this
   * provider reports `unlocked` and gates nothing. If this ever regressed,
   * every page suite would hang on a password form.
   */
  test("nothing gates, and nothing is asked", async () => {
    mockConfigured = false;
    mockDb.from.mockImplementation(() => {
      throw new Error("the key row must never be read with no server configured");
    });

    const { result } = await mountKey(BOOKS_KEY_STATUS.UNLOCKED);

    expect(result.current.status).toBe(BOOKS_KEY_STATUS.UNLOCKED);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
