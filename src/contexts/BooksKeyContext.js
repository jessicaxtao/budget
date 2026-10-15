import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import { BOOKS_KEY_CACHE_KEY, getStorageScope, readKey, setStorageScope, writeKey } from "../storage";
import {
  DEFAULT_KDF,
  deriveKek,
  exportMasterKey,
  importMasterKey,
  newKeyRecord,
  newRecoveryCode,
  newSalt,
  normalizeRecoveryCode,
  unwrapKey,
  wrapKey,
} from "../booksCrypto";
import { booksKeyGeneration, getBooksKey, setBooksKey } from "../booksKey";

/**
 * The account's key record, and the unwrapped master key once something has
 * unlocked it.
 *
 * **Inert whenever `SyncProvider` is** — an unconfigured build, a guest, a
 * local-only session — computed from the same predicate `SyncContext.js`
 * reads `remote` from, so the two can never disagree about whether there is
 * a server to seal anything for. Not remote means `status` is `unlocked`
 * immediately: nothing gates, and the existing test suite — which renders
 * with no `AuthProvider` above it, so `remote` is false everywhere — never
 * sees any of this.
 *
 * **`status` is a four-state, for the reason `AUTH_STATUS` is a three-state**:
 * `checking` is real, because the row is read back from the server
 * asynchronously and a gate that read the gap as "no key yet" would flash
 * the set-up screen at every returning account on every reload.
 *
 * **Every mutator returns `{ ok, error }`**, the convention every store in
 * this app keeps. `setUp` and `regenerateRecoveryCode` also return a
 * `recoveryCode` on success, which the caller must show once and never ask
 * this context for again — nothing here remembers it past the call that
 * minted it.
 */
// Exported for `SyncContext`'s reason, stated there too: a test needs to be
// able to stage a key layer without a server to mock. `TESTING.md`'s rule is
// that **nothing mocks a hook** — a panel that reads this through a jest mock
// would pass while the real provider's shape drifted out from under it — and a
// bare `createContext()` leaves a test no honest way to keep that rule.
export const BooksKeyContext = createContext();

export function useBooksKey() {
  return useContext(BooksKeyContext);
}

export const BOOKS_KEY_STATUS = Object.freeze({
  CHECKING: "checking",
  /** No `app_crypto` row for this account yet. */
  SETUP: "setup",
  /** A row exists, but nothing on this device has unwrapped it. */
  LOCKED: "locked",
  UNLOCKED: "unlocked",
});

/**
 * The floor for a books password, and it is **not** `MIN_PASSWORD_LENGTH`'s
 * eight. An account password is defended by the server's rate limiter; a
 * books password is defended by nothing but PBKDF2 against somebody who
 * already has the ciphertext, so it is held to a higher bar on purpose.
 */
export const MIN_BOOKS_PASSWORD_LENGTH = 12;

function checkBooksPassword(password) {
  if (!password || password.length < MIN_BOOKS_PASSWORD_LENGTH) {
    return `Use a books password of at least ${MIN_BOOKS_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Select this account's `app_crypto` row, or `null` if there is none yet. */
async function selectRow(supabase, userId) {
  return supabase.from("app_crypto").select("*").eq("user_id", userId).maybeSingle();
}

/**
 * The key cache, read and written **under the account's own scope, set here
 * rather than inherited**.
 *
 * This provider sits *above* `SyncProvider`, and `SyncProvider` is the only
 * thing in the app that calls `setStorageScope` — so at the moment this
 * provider first touches storage the scope is still `null`, and a bare
 * `readKey` / `writeKey` would put the master key under the **unscoped** key
 * `booksKey`. That is not a cosmetic slip. `clearScope` only ever clears
 * scoped keys, and deliberately so: the unscoped documents are this browser's
 * own local books and do not belong to any session. An unscoped key cache
 * would therefore **survive sign-out** and leave the previous household's
 * master key sitting in `localStorage` for whoever opens the browser next —
 * precisely the leak namespacing exists to prevent, carrying the one value
 * that unlocks everything else.
 *
 * Bracketed rather than set once, following `isGuestMode` / `setGuestMode` in
 * `storage.js`: those reach for a different scope for the length of one call
 * and put the previous one back in a `finally`. Doing it that way keeps this
 * provider from fighting `SyncProvider` over the same module state, which is
 * the other thing that could go wrong here.
 */
function readCachedKey(userId) {
  const previous = getStorageScope();
  setStorageScope(userId);
  try {
    return readKey(BOOKS_KEY_CACHE_KEY);
  } finally {
    setStorageScope(previous);
  }
}

function writeCachedKey(userId, cached) {
  const previous = getStorageScope();
  setStorageScope(userId);
  try {
    writeKey(BOOKS_KEY_CACHE_KEY, cached);
  } finally {
    setStorageScope(previous);
  }
}

const cancelled = () => ({ ok: false, error: "Your session changed. Sign in and unlock your books again." });

export const BooksKeyProvider = ({ children }) => {
  const { status: authStatus, userId } = useAuth();

  const remote = authStatus === AUTH_STATUS.SIGNED_IN && isSupabaseConfigured && Boolean(userId);

  const [status, setStatus] = useState(remote ? BOOKS_KEY_STATUS.CHECKING : BOOKS_KEY_STATUS.UNLOCKED);
  /** The account's `app_crypto` row — the salts and wraps, never the key itself. */
  const [row, setRow] = useState(null);
  const lifetime = useRef(0);
  const sessionEpoch = useRef(booksKeyGeneration());
  const owner = useRef(null);
  owner.current = remote ? userId : null;

  // Both guards matter: the epoch changes immediately on logout, while the
  // lifetime also catches unmounts and switches before a promise resumes.
  const operation = useCallback(() => {
    const epoch = sessionEpoch.current;
    const started = lifetime.current;
    return () => remote && owner.current === userId && lifetime.current === started && booksKeyGeneration() === epoch;
  }, [remote, userId]);

  useEffect(() => {
    lifetime.current += 1;
    sessionEpoch.current = booksKeyGeneration();
    return () => { lifetime.current += 1; };
  }, [remote, userId]);

  useEffect(() => {
    if (!remote) {
      setStatus(BOOKS_KEY_STATUS.UNLOCKED);
      setRow(null);
      return undefined;
    }

    let active = true;
    const isCurrent = operation();
    setStatus(BOOKS_KEY_STATUS.CHECKING);
    setRow(null);

    (async () => {
      const supabase = getSupabase();
      const { data, error } = await selectRow(supabase, userId);
      if (!active || !isCurrent()) return;

      if (error || !data) {
        setRow(null);
        setStatus(BOOKS_KEY_STATUS.SETUP);
        return;
      }

      setRow(data);

      // The cache carries the key's `kid` alongside its bytes, so a cache
      // left over from a race this device lost — see `setUp` below — is
      // refused rather than handed to `setBooksKey` as though it belonged to
      // the row that actually won.
      const cached = readCachedKey(userId);
      if (cached && typeof cached === "object" && cached.kid === data.kid && typeof cached.raw === "string") {
        const imported = await importMasterKey(cached.raw);
        if (!active || !isCurrent()) return;
        if (imported.ok) {
          setBooksKey(imported.key, data.kid);
          setStatus(BOOKS_KEY_STATUS.UNLOCKED);
          return;
        }
      }

      // No cache, a mismatched one, or one that will not import — a corrupt
      // cache is a reason to ask for the password again, never a reason to
      // crash.
      setStatus(BOOKS_KEY_STATUS.LOCKED);
    })();

    return () => {
      active = false;
    };
  }, [remote, userId, operation]);

  /** Remember the unwrapped key on this device, keyed to the row it opens. */
  const cacheKey = useCallback(
    async (mk, kid, isCurrent) => {
      const exported = await exportMasterKey(mk);
      if (!isCurrent()) return false;
      if (exported.ok) writeCachedKey(userId, { raw: exported.raw, kid });
      setBooksKey(mk, kid);
      setStatus(BOOKS_KEY_STATUS.UNLOCKED);
      return true;
    },
    [userId]
  );

  /**
   * First-time set-up: a new master key, wrapped under `password` and under a
   * fresh recovery code, written as this account's one `app_crypto` row.
   *
   * **The concurrent set-up race**: two devices reaching this screen at once
   * would otherwise each generate their own key and each believe it won.
   * `upsert` with `ignoreDuplicates` lets only one insert land; the re-select
   * afterwards is what tells this device whether it was the one. If the row
   * that comes back names a different `kid`, the key generated here is
   * discarded — it would seal documents nothing else could open — and this
   * device falls to `locked`, where the password or recovery code that
   * actually won can unlock it.
   */
  const setUp = useCallback(
    async (password) => {
      if (!remote) return { ok: false, error: "This build has no account server configured." };
      const isCurrent = operation();

      const passwordError = checkBooksPassword(password);
      if (passwordError) return { ok: false, error: passwordError };

      const created = await newKeyRecord(password);
      if (!isCurrent()) return cancelled();
      if (!created.ok) return { ok: false, error: created.error };

      const supabase = getSupabase();
      const { error: upsertError } = await supabase
        .from("app_crypto")
        .upsert({ user_id: userId, ...created.record }, { onConflict: "user_id", ignoreDuplicates: true });
      if (!isCurrent()) return cancelled();
      if (upsertError) {
        return { ok: false, error: upsertError.message ?? "Could not set up your books key." };
      }

      const { data, error: selectError } = await selectRow(supabase, userId);
      if (!isCurrent()) return cancelled();
      if (selectError || !data) {
        return { ok: false, error: selectError?.message ?? "Could not set up your books key." };
      }

      setRow(data);

      if (data.kid !== created.kid) {
        // Another device's insert won the race. The key generated here must
        // never be used — go to locked and let the winning password or
        // recovery code open it instead.
        setStatus(BOOKS_KEY_STATUS.LOCKED);
        return {
          ok: false,
          error: "Another device finished setting this up first. Unlock with its password or recovery code instead.",
        };
      }

      if (!(await cacheKey(created.mk, created.kid, isCurrent))) return cancelled();
      return { ok: true, recoveryCode: created.recoveryCode };
    },
    [remote, userId, cacheKey, operation]
  );

  /** Unwrap MK under the books password. A wrong password fails GCM's tag —
   *  that failure is the only check there is, and it says nothing more. */
  const unlock = useCallback(
    async (password) => {
      if (!row) return { ok: false, error: "There is no books key to unlock yet." };
      const isCurrent = operation();

      const kek = await deriveKek(password, { salt: row.password_salt, kdf: row.kdf });
      if (!isCurrent()) return cancelled();
      if (!kek.ok) return { ok: false, error: "That password could not be used." };

      const unwrapped = await unwrapKey(kek.key, row.password_wrap);
      if (!isCurrent()) return cancelled();
      if (!unwrapped.ok) return { ok: false, error: "That password does not match." };

      if (!(await cacheKey(unwrapped.key, row.kid, isCurrent))) return cancelled();
      return { ok: true };
    },
    [row, cacheKey, operation]
  );

  /** The second way in. `normalizeRecoveryCode` first, so a code retyped
   *  lowercase or without its hyphens still derives the same KEK. */
  const unlockWithRecoveryCode = useCallback(
    async (code) => {
      if (!row) return { ok: false, error: "There is no books key to unlock yet." };
      const isCurrent = operation();
      if (!row.recovery_salt || !row.recovery_wrap) {
        return { ok: false, error: "No recovery code was set up for this account." };
      }

      const kek = await deriveKek(normalizeRecoveryCode(code), {
        salt: row.recovery_salt,
        kdf: row.kdf,
      });
      if (!isCurrent()) return cancelled();
      if (!kek.ok) return { ok: false, error: "That recovery code could not be used." };

      const unwrapped = await unwrapKey(kek.key, row.recovery_wrap);
      if (!isCurrent()) return cancelled();
      if (!unwrapped.ok) return { ok: false, error: "That recovery code does not match." };

      if (!(await cacheKey(unwrapped.key, row.kid, isCurrent))) return cancelled();
      return { ok: true };
    },
    [row, cacheKey, operation]
  );

  /**
   * Rewrap MK under a new password and write ONE row. Never re-encrypts a
   * document — that is the whole point of envelope encryption, see
   * `.claude/END_TO_END_ENCRYPTION.md`.
   */
  const changePassword = useCallback(
    async (next) => {
      const isCurrent = operation();
      if (status !== BOOKS_KEY_STATUS.UNLOCKED) return { ok: false, error: "Unlock your books first." };
      const key = getBooksKey();
      if (!key) return { ok: false, error: "Unlock your books first." };

      const passwordError = checkBooksPassword(next);
      if (passwordError) return { ok: false, error: passwordError };

      const salt = newSalt();
      const kek = await deriveKek(next, { salt, kdf: DEFAULT_KDF });
      if (!isCurrent()) return cancelled();
      if (!kek.ok) return { ok: false, error: kek.error };
      const wrapped = await wrapKey(kek.key, key.mk);
      if (!isCurrent()) return cancelled();
      if (!wrapped.ok) return { ok: false, error: wrapped.error };

      const supabase = getSupabase();
      const { error } = await supabase
        .from("app_crypto")
        .update({ kdf: DEFAULT_KDF, password_salt: salt, password_wrap: wrapped.wrapped })
        .eq("user_id", userId);
      if (!isCurrent()) return cancelled();
      if (error) return { ok: false, error: error.message ?? "Could not change your books password." };

      setRow((previous) =>
        previous ? { ...previous, kdf: DEFAULT_KDF, password_salt: salt, password_wrap: wrapped.wrapped } : previous
      );
      return { ok: true };
    },
    [status, userId, operation]
  );

  /** Mint a fresh recovery code, rewrap MK under it, and write ONE row. The
   *  old code stops working the moment this succeeds — there is only ever
   *  one in force, the same as the password. */
  const regenerateRecoveryCode = useCallback(async () => {
    const isCurrent = operation();
    if (status !== BOOKS_KEY_STATUS.UNLOCKED) return { ok: false, error: "Unlock your books first." };
    const key = getBooksKey();
    if (!key) return { ok: false, error: "Unlock your books first." };

    const code = newRecoveryCode();
    const salt = newSalt();
    const kek = await deriveKek(normalizeRecoveryCode(code), { salt, kdf: DEFAULT_KDF });
    if (!isCurrent()) return cancelled();
    if (!kek.ok) return { ok: false, error: kek.error };
    const wrapped = await wrapKey(kek.key, key.mk);
    if (!isCurrent()) return cancelled();
    if (!wrapped.ok) return { ok: false, error: wrapped.error };

    const supabase = getSupabase();
    const { error } = await supabase
      .from("app_crypto")
      .update({ recovery_salt: salt, recovery_wrap: wrapped.wrapped })
      .eq("user_id", userId);
    if (!isCurrent()) return cancelled();
    if (error) return { ok: false, error: error.message ?? "Could not regenerate your recovery code." };

    setRow((previous) => (previous ? { ...previous, recovery_salt: salt, recovery_wrap: wrapped.wrapped } : previous));
    return { ok: true, recoveryCode: code };
  }, [status, userId, operation]);

  const value = useMemo(
    () => ({
      status,
      // When the key was set up, and **nothing else off the row**. The salts
      // and the wraps stay in here: they are not secret — the server holds
      // them — but nothing outside this file has any use for them, and a
      // context that handed them out would invite a second place to try
      // unwrapping. A date is the one thing the panel has to be able to say.
      createdAt: row?.created_at ?? null,
      setUp,
      unlock,
      unlockWithRecoveryCode,
      changePassword,
      regenerateRecoveryCode,
    }),
    [status, row, setUp, unlock, unlockWithRecoveryCode, changePassword, regenerateRecoveryCode]
  );

  return <BooksKeyContext.Provider value={value}>{children}</BooksKeyContext.Provider>;
};
