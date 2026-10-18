import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import { IDENTITY_KEY_CACHE_KEY, getStorageScope, readKey, setStorageScope, writeKey } from "../storage";
import {
  DEFAULT_KDF,
  deriveKek,
  exportPrivateKey,
  importPrivateKey,
  importPublicKey,
  newIdentityRecord,
  newRecoveryCode,
  newSalt,
  normalizeRecoveryCode,
  unwrapKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from "../booksCrypto";
import { booksKeyGeneration } from "../booksKey";

/**
 * The account's **identity keypair**, and the books password that guards it.
 *
 * This is the first of the two layers that replaced the single-household key
 * gate. It owns a personal secret — an RSA private key, wrapped under the books
 * password and under a recovery code — and nothing about any particular
 * household. `HouseholdContext` sits below it and uses the unlocked private key
 * to open each household's master key; the split is the shape of the change,
 * because one password now unlocks one identity, and that identity opens every
 * household it has been granted.
 *
 * **Inert whenever `SyncProvider` is** — unconfigured build, guest, local-only —
 * computed from the same predicate, so the existing test suite (no `AuthProvider`
 * above it) never sees any of this and `status` is `unlocked` at once.
 *
 * **`status` is a four-state**, for the reason `AUTH_STATUS` is a three-state:
 * `checking` is real, because the `user_keys` row is read back asynchronously
 * and a gate that read the gap as "no key yet" would flash the set-up screen at
 * every returning account on every reload.
 *
 * Exported context object for `TESTING.md`'s "nothing mocks a hook" rule, the
 * same reason `SyncContext` and the old key context are.
 */
export const IdentityKeyContext = createContext();

export function useIdentityKey() {
  return useContext(IdentityKeyContext);
}

export const IDENTITY_STATUS = Object.freeze({
  CHECKING: "checking",
  /** No `user_keys` row for this account yet. */
  SETUP: "setup",
  /** A row exists, but nothing on this device has unwrapped the private key. */
  LOCKED: "locked",
  UNLOCKED: "unlocked",
});

/**
 * The floor for a books password, and it is **not** `MIN_PASSWORD_LENGTH`'s
 * eight. An account password is defended by the server's rate limiter; a books
 * password is defended by nothing but PBKDF2 against somebody who already has
 * the ciphertext, so it is held to a higher bar on purpose.
 */
export const MIN_BOOKS_PASSWORD_LENGTH = 12;

function checkBooksPassword(password) {
  if (!password || password.length < MIN_BOOKS_PASSWORD_LENGTH) {
    return `Use a books password of at least ${MIN_BOOKS_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Select this account's `user_keys` row, or `null` if there is none yet. */
async function selectRow(supabase, userId) {
  return supabase.from("user_keys").select("*").eq("user_id", userId).maybeSingle();
}

/**
 * The legacy `app_crypto` row, if this account predates households — the old
 * single-key record, MK wrapped under the old books password.
 *
 * Read so the migration can recover that master key with the password the
 * person already knows and hand it to `HouseholdContext` to adopt, reusing the
 * same MK and `kid` so not one existing document has to be re-encrypted. `null`
 * for a fresh account, which is the common path and takes none of this.
 */
async function selectLegacyRow(supabase, userId) {
  const { data } = await supabase.from("app_crypto").select("*").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/**
 * Recover the old master key from a legacy `app_crypto` row, using the same
 * secret the person just typed. `which` is `"password"` or `"recovery"`,
 * naming which wrap to open. Returns `{ mk, kid }` or `null` when there is no
 * legacy row, no such wrap, or the secret does not open it — a `null` the
 * caller reads as "this is not that person's existing books password".
 */
async function recoverLegacyMk(legacy, secret, which) {
  if (!legacy) return null;
  const salt = which === "recovery" ? legacy.recovery_salt : legacy.password_salt;
  const wrap = which === "recovery" ? legacy.recovery_wrap : legacy.password_wrap;
  if (!salt || !wrap) return null;
  const kek = await deriveKek(secret, { salt, kdf: legacy.kdf });
  if (!kek.ok) return null;
  const mk = await unwrapKey(kek.key, wrap);
  if (!mk.ok) return null;
  return { mk: mk.key, kid: legacy.kid };
}

/**
 * The identity-key cache, read and written under the **user's own scope**, set
 * here rather than inherited — the same bracketing dance `storage.js`'s
 * `isGuestMode` does, and for the same reason the old key cache did it: this
 * provider sits above `SyncProvider`, the only thing that sets the scope, so a
 * bare read here would land the key under the unscoped slot and survive
 * sign-out. The user's scope (not a household's) is right because one private
 * key opens every household.
 */
function readCachedKey(userId) {
  const previous = getStorageScope();
  setStorageScope(userId);
  try {
    return readKey(IDENTITY_KEY_CACHE_KEY);
  } finally {
    setStorageScope(previous);
  }
}

function writeCachedKey(userId, cached) {
  const previous = getStorageScope();
  setStorageScope(userId);
  try {
    writeKey(IDENTITY_KEY_CACHE_KEY, cached);
  } finally {
    setStorageScope(previous);
  }
}

const cancelled = () => ({ ok: false, error: "Your session changed. Sign in and unlock your books again." });

export const IdentityKeyProvider = ({ children }) => {
  const { status: authStatus, userId } = useAuth();

  const remote = authStatus === AUTH_STATUS.SIGNED_IN && isSupabaseConfigured && Boolean(userId);

  const [status, setStatus] = useState(remote ? IDENTITY_STATUS.CHECKING : IDENTITY_STATUS.UNLOCKED);
  /** The account's `user_keys` row — salts, wraps and the public key, never the private key itself. */
  const [row, setRow] = useState(null);
  /** The unlocked keypair, once something opens it. `null` until then. */
  const [keys, setKeys] = useState(null);
  /** The legacy `app_crypto` row, present only while an old account is mid-migration. */
  const [legacyRow, setLegacyRow] = useState(null);
  /** The old master key recovered from `app_crypto`, for `HouseholdContext` to
   *  adopt when a migrated household has no `household_keys` row yet. `{ mk, kid }`
   *  or `null`. */
  const [legacyMk, setLegacyMk] = useState(null);
  const lifetime = useRef(0);
  const sessionEpoch = useRef(booksKeyGeneration());
  const owner = useRef(null);
  owner.current = remote ? userId : null;

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
      setStatus(IDENTITY_STATUS.UNLOCKED);
      setRow(null);
      setKeys(null);
      setLegacyRow(null);
      setLegacyMk(null);
      return undefined;
    }

    let active = true;
    const isCurrent = operation();
    setStatus(IDENTITY_STATUS.CHECKING);
    setRow(null);
    setKeys(null);
    setLegacyRow(null);
    setLegacyMk(null);

    (async () => {
      const supabase = getSupabase();
      const [{ data, error }, legacy] = await Promise.all([
        selectRow(supabase, userId),
        selectLegacyRow(supabase, userId),
      ]);
      if (!active || !isCurrent()) return;
      setLegacyRow(legacy);

      if (error || !data) {
        setRow(null);
        setStatus(IDENTITY_STATUS.SETUP);
        return;
      }

      setRow(data);

      // The cache carries the public key it was saved beside, so a cache left
      // over from a race this device lost — see `setUp` — is refused rather than
      // treated as the identity that actually won.
      const cached = readCachedKey(userId);
      if (
        cached &&
        typeof cached === "object" &&
        cached.publicKey === data.public_key &&
        typeof cached.pkcs8 === "string"
      ) {
        const priv = await importPrivateKey(cached.pkcs8);
        const pub = await importPublicKey(data.public_key);
        if (!active || !isCurrent()) return;
        if (priv.ok && pub.ok) {
          setKeys({ privateKey: priv.key, publicKey: pub.key });
          setStatus(IDENTITY_STATUS.UNLOCKED);
          return;
        }
      }

      setStatus(IDENTITY_STATUS.LOCKED);
    })();

    return () => {
      active = false;
    };
  }, [remote, userId, operation]);

  /** Remember the unlocked private key on this device, beside the public key it pairs with. */
  const cacheAndHold = useCallback(
    async (pair, publicKeySpki, isCurrent) => {
      const exported = await exportPrivateKey(pair.privateKey);
      if (!isCurrent()) return false;
      if (exported.ok) writeCachedKey(userId, { pkcs8: exported.pkcs8, publicKey: publicKeySpki });
      setKeys({ privateKey: pair.privateKey, publicKey: pair.publicKey });
      setStatus(IDENTITY_STATUS.UNLOCKED);
      return true;
    },
    [userId]
  );

  /**
   * First-time set-up: a new identity keypair, its private half wrapped under
   * `password` and a fresh recovery code, written as this account's one
   * `user_keys` row.
   *
   * **The concurrent set-up race**, handled exactly as the old key context did:
   * `upsert` with `ignoreDuplicates` lets only one insert land, the re-select
   * tells this device whether it was the one, and a row whose `public_key` is
   * not ours means another device won — so the keypair generated here is
   * discarded and this device falls to `locked`.
   */
  const setUp = useCallback(
    async (password) => {
      if (!remote) return { ok: false, error: "This build has no account server configured." };
      const isCurrent = operation();

      const passwordError = checkBooksPassword(password);
      if (passwordError) return { ok: false, error: passwordError };

      // A migrating account: this "set up" is really "enter your existing books
      // password", because that password is the one thing that can recover the
      // old master key — and adopting that same key is what keeps every existing
      // document readable. A password that does not open the old wrap is refused
      // here rather than quietly minting a fresh key that would strand the books.
      let recoveredLegacy = null;
      if (legacyRow) {
        recoveredLegacy = await recoverLegacyMk(legacyRow, password, "password");
        if (!isCurrent()) return cancelled();
        if (!recoveredLegacy) {
          return {
            ok: false,
            error: "That is not this account's existing books password. Enter the password you used before.",
          };
        }
      }

      const created = await newIdentityRecord(password);
      if (!isCurrent()) return cancelled();
      if (!created.ok) return { ok: false, error: created.error };

      const supabase = getSupabase();
      const { error: upsertError } = await supabase
        .from("user_keys")
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

      if (data.public_key !== created.record.public_key) {
        setStatus(IDENTITY_STATUS.LOCKED);
        return {
          ok: false,
          error: "Another device finished setting this up first. Unlock with its password or recovery code instead.",
        };
      }

      if (!(await cacheAndHold({ privateKey: created.privateKey, publicKey: created.publicKey }, data.public_key, isCurrent))) {
        return cancelled();
      }
      if (recoveredLegacy) setLegacyMk(recoveredLegacy);
      return { ok: true, recoveryCode: created.recoveryCode };
    },
    [remote, userId, legacyRow, cacheAndHold, operation]
  );

  const openWith = useCallback(
    async (secret, salt, wrap, which, isCurrent, mismatchError) => {
      if (!salt || !wrap) return { ok: false, error: "No recovery code was set up for this account." };
      const kek = await deriveKek(secret, { salt, kdf: row.kdf });
      if (!isCurrent()) return cancelled();
      if (!kek.ok) return { ok: false, error: mismatchError };

      const priv = await unwrapPrivateKey(kek.key, wrap);
      if (!isCurrent()) return cancelled();
      if (!priv.ok) return { ok: false, error: mismatchError };

      const pub = await importPublicKey(row.public_key);
      if (!isCurrent()) return cancelled();
      if (!pub.ok) return { ok: false, error: "This account's public key could not be read." };

      if (!(await cacheAndHold({ privateKey: priv.key, publicKey: pub.key }, row.public_key, isCurrent))) {
        return cancelled();
      }

      // A migration this device never finished — a resumed one — recovers the
      // old master key here too, with the same secret, so `HouseholdContext` can
      // still adopt it into a `household_keys` row that failed to write before.
      if (legacyRow) {
        const recovered = await recoverLegacyMk(legacyRow, secret, which);
        if (isCurrent() && recovered) setLegacyMk(recovered);
      }
      return { ok: true };
    },
    [row, legacyRow, cacheAndHold]
  );

  /** Unwrap the private key under the books password. A wrong password fails
   *  GCM's tag — that failure is the only check there is. */
  const unlock = useCallback(
    async (password) => {
      if (!row) return { ok: false, error: "There is no books key to unlock yet." };
      return openWith(password, row.password_salt, row.password_wrap, "password", operation(), "That password does not match.");
    },
    [row, openWith, operation]
  );

  /** The second way in. `normalizeRecoveryCode` first, so a code retyped
   *  lowercase or without its hyphens still derives the same KEK. */
  const unlockWithRecoveryCode = useCallback(
    async (code) => {
      if (!row) return { ok: false, error: "There is no books key to unlock yet." };
      return openWith(
        normalizeRecoveryCode(code),
        row.recovery_salt,
        row.recovery_wrap,
        "recovery",
        operation(),
        "That recovery code does not match."
      );
    },
    [row, openWith, operation]
  );

  /**
   * Rewrap the private key under a new password and write ONE row. Never
   * re-encrypts a document or a household key — a household's master key is
   * wrapped under the public key, which a password change does not touch.
   */
  const changePassword = useCallback(
    async (next) => {
      const isCurrent = operation();
      if (status !== IDENTITY_STATUS.UNLOCKED || !keys) return { ok: false, error: "Unlock your books first." };

      const passwordError = checkBooksPassword(next);
      if (passwordError) return { ok: false, error: passwordError };

      const salt = newSalt();
      const kek = await deriveKek(next, { salt, kdf: DEFAULT_KDF });
      if (!isCurrent()) return cancelled();
      if (!kek.ok) return { ok: false, error: kek.error };
      const wrapped = await wrapPrivateKey(kek.key, keys.privateKey);
      if (!isCurrent()) return cancelled();
      if (!wrapped.ok) return { ok: false, error: wrapped.error };

      const supabase = getSupabase();
      const { error } = await supabase
        .from("user_keys")
        .update({ kdf: DEFAULT_KDF, password_salt: salt, password_wrap: wrapped.wrapped })
        .eq("user_id", userId);
      if (!isCurrent()) return cancelled();
      if (error) return { ok: false, error: error.message ?? "Could not change your books password." };

      setRow((previous) =>
        previous ? { ...previous, kdf: DEFAULT_KDF, password_salt: salt, password_wrap: wrapped.wrapped } : previous
      );
      return { ok: true };
    },
    [status, keys, userId, operation]
  );

  /** Mint a fresh recovery code, rewrap the private key under it, write ONE
   *  row. The old code stops working the moment this succeeds. */
  const regenerateRecoveryCode = useCallback(async () => {
    const isCurrent = operation();
    if (status !== IDENTITY_STATUS.UNLOCKED || !keys) return { ok: false, error: "Unlock your books first." };

    const code = newRecoveryCode();
    const salt = newSalt();
    const kek = await deriveKek(normalizeRecoveryCode(code), { salt, kdf: DEFAULT_KDF });
    if (!isCurrent()) return cancelled();
    if (!kek.ok) return { ok: false, error: kek.error };
    const wrapped = await wrapPrivateKey(kek.key, keys.privateKey);
    if (!isCurrent()) return cancelled();
    if (!wrapped.ok) return { ok: false, error: wrapped.error };

    const supabase = getSupabase();
    const { error } = await supabase
      .from("user_keys")
      .update({ recovery_salt: salt, recovery_wrap: wrapped.wrapped })
      .eq("user_id", userId);
    if (!isCurrent()) return cancelled();
    if (error) return { ok: false, error: error.message ?? "Could not regenerate your recovery code." };

    setRow((previous) => (previous ? { ...previous, recovery_salt: salt, recovery_wrap: wrapped.wrapped } : previous));
    return { ok: true, recoveryCode: code };
  }, [status, keys, userId, operation]);

  const value = useMemo(
    () => ({
      status,
      createdAt: row?.created_at ?? null,
      /** The unlocked public and private keys, for `HouseholdContext` to open
       *  and grant household master keys with. `null` until unlocked. */
      publicKey: keys?.publicKey ?? null,
      privateKey: keys?.privateKey ?? null,
      /** True while an old single-household account still has an `app_crypto`
       *  row, so the set-up screen can say "enter your existing books password"
       *  rather than "choose one". */
      legacyPresent: Boolean(legacyRow),
      /** The old master key, recovered during a migrating unlock, for
       *  `HouseholdContext` to adopt. `{ mk, kid }` or `null`. */
      legacyMk,
      setUp,
      unlock,
      unlockWithRecoveryCode,
      changePassword,
      regenerateRecoveryCode,
    }),
    [status, row, keys, legacyRow, legacyMk, setUp, unlock, unlockWithRecoveryCode, changePassword, regenerateRecoveryCode]
  );

  return <IdentityKeyContext.Provider value={value}>{children}</IdentityKeyContext.Provider>;
};
