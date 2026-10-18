/**
 * The `booksFile.js` of the wire: the one module that knows the shape of an
 * encrypted envelope, so two readers — `SyncContext` writing one and reading
 * it back, a second device doing the same — cannot disagree about what is
 * inside it.
 *
 * Pure on purpose. No React, no module state, no reach into `storage.js` or
 * `supabaseClient.js` — every function here is called with the key material
 * it needs and hands back `{ ok, … }` or `{ ok: false, error }`, never a
 * throw, because a wrong password is an expected outcome and not an
 * exception. That is what lets this file be tested with no provider, no
 * scope and no server to stage — see `src/booksKey.js` for where the one
 * genuinely live key is kept instead.
 *
 * **Envelope encryption, and nothing else.** A random AES-GCM master key
 * (MK) encrypts every document and every receipt; MK itself is never typed,
 * never sent anywhere raw, and is stored only wrapped — under a key derived
 * from the books password, and again under a key derived from a printed
 * recovery code. Changing the password therefore rewraps 32 bytes rather
 * than re-encrypting the books, and a device already holding MK does not
 * care that another device just did.
 *
 * `kid` names the key an envelope was sealed with. On the single-household
 * design it never rotated and was a pure tripwire; with shared households it
 * grows a second job, because removing a member who has seen MK can only be
 * made real by **re-keying** the household — a fresh MK under a fresh `kid`,
 * every document re-sealed. Either way an envelope whose `kid` does not match
 * the key unlocking it is refused outright rather than handed to GCM to fail
 * obscurely: a cached document that crossed a scope switch, a row that crossed
 * households, or a document that predates a re-key. Checking `kid` against the
 * live key is the caller's job, which is why `envelopeKid` is exported rather
 * than folded into `decryptDocument`.
 *
 * **The second layer: sharing a household without sharing its password.** A
 * household's MK is still symmetric and still seals every document, but it is
 * no longer wrapped only under secrets one person typed. Each member has an
 * RSA-OAEP **identity keypair**; MK is wrapped once per member's public key
 * (`wrapKeyFor` / `unwrapKeyWith`), so a member opens the household with their
 * own private key and no shared passphrase ever exists. The private key is the
 * thing the books password now guards — wrapped under a password-derived KEK
 * and a recovery-derived one, exactly as MK used to be (`newIdentityRecord`).
 * One password unlocks one identity; that identity opens every household it has
 * been granted. All of this is still native `crypto.subtle` — no wasm, no CSP
 * change.
 */

import { v4 as uuidV4 } from "uuid";

// -----------------------------------------------------------------------
// Bytes, base64, and the one UUID this module has to frame as bytes rather
// than read as text.
// -----------------------------------------------------------------------

// Spreading a large `Uint8Array` into `String.fromCharCode(...)` blows the
// engine's argument-count limit well before a store's real documents would
// — a household's whole transaction list can be megabytes. Chunking is what
// keeps base64 encoding correct at every size rather than only in a test
// with a short fixture.
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A `kid` is a UUID, and `encryptBytes`' framing wants it as the 16 raw
 * bytes a UUID actually is, not the 36-character string it is printed as.
 * Returns `null` for anything that is not a well-formed UUID, which is how
 * `encryptBytes` below fails closed on a `kid` it cannot frame rather than
 * writing a header that looks fine and decodes to nonsense.
 */
function uuidToBytes(uuid) {
  const hex = typeof uuid === "string" ? uuid.replace(/-/g, "") : "";
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function failure(error) {
  return { ok: false, error: String(error?.message ?? error) };
}

// -----------------------------------------------------------------------
// The envelope shape
// -----------------------------------------------------------------------

/** Bumped only if the envelope's own shape ever changes — not on a key
 *  change, which `kid` carries instead. */
export const ENVELOPE_VERSION = 1;

/**
 * KEK parameters, stored in the row (`app_crypto.kdf`) rather than assumed,
 * so they can be raised later without stranding an account set up under the
 * old ones. 600,000 iterations is deliberately slow — it is this module's
 * whole defence against someone who has the ciphertext guessing offline.
 */
export const DEFAULT_KDF = { alg: "PBKDF2", hash: "SHA-256", iterations: 600000 };

/** A fresh 16-byte salt, base64-encoded. One per wrap — the password's and
 *  the recovery code's each get their own, so a wrap can be rotated
 *  without disturbing the other. */
export function newSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** A random 256-bit master key. Extractable, because it has to be exported
 *  to be wrapped (`wrapKey`) and re-imported once unwrapped — a key that
 *  could not leave the `CryptoKey` object could never be rewrapped under a
 *  changed password. */
export async function newMasterKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * A key-encryption key from a secret a person typed — the books password or
 * a recovery code, both run through this one path so there is one
 * derivation to get right rather than two. Not extractable: nothing ever
 * needs the KEK's own bytes, only what it can wrap and unwrap.
 */
export async function deriveKek(secret, { salt, kdf = DEFAULT_KDF } = {}) {
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: base64ToBytes(salt), iterations: kdf.iterations, hash: kdf.hash },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return { ok: true, key };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Wrap MK under a KEK: export MK's raw bytes, AES-GCM encrypt them with a
 * fresh IV, and hand back `base64(iv ‖ ciphertext)` — one string, which is
 * what a single `app_crypto` column holds. Authentication is the password
 * check: there is no separate verifier, because a wrong KEK fails GCM's own
 * tag the moment `unwrapKey` tries it.
 */
export async function wrapKey(kek, mk) {
  try {
    const raw = await crypto.subtle.exportKey("raw", mk);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return { ok: true, wrapped: bytesToBase64(combined) };
  } catch (error) {
    return failure(error);
  }
}

/** The other half of `wrapKey`. A wrong KEK — a wrong password, a wrong
 *  recovery code — fails GCM's tag check and comes back `{ ok: false }`
 *  rather than throwing, which is what lets the caller say "wrong password"
 *  and nothing scarier. */
export async function unwrapKey(kek, wrapped) {
  try {
    const combined = base64ToBytes(wrapped);
    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ciphertext);
    const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    return { ok: true, key };
  } catch {
    return { ok: false, error: "That key could not be unwrapped." };
  }
}

/**
 * MK as base64 of its raw bytes, and back again — the pair that lets a device
 * *remember* the key between page loads.
 *
 * Deliberately separate from `wrapKey` / `unwrapKey`, which exist to put MK
 * somewhere the server can hold it and are useless without a secret nobody
 * typed yet. This pair is the opposite case: the key cache in this browser's
 * own storage, where there is no second secret to derive from and asking for
 * the books password on every reload is the thing the cache exists to avoid.
 *
 * **So this is the one place MK is written down unprotected, and it is only
 * acceptable because of where it is written**: scoped storage, beside a
 * plaintext cache of the very books it opens (`BOOKS_KEY_CACHE_KEY` in
 * `src/storage.js`). Anyone who can read the key can already read the books
 * it unlocks, so the key adds no exposure — and like the outbox, it leaves
 * with the session, because the one thing that would not be true of is the
 * *next* person to open this browser.
 */
export async function exportMasterKey(mk) {
  try {
    return { ok: true, raw: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", mk))) };
  } catch (error) {
    return failure(error);
  }
}

export async function importMasterKey(raw) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(raw),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    return { ok: true, key };
  } catch {
    // A cache that will not import is a cache to discard, not a crash — the
    // caller falls to `locked` and asks for the password, which always works.
    return { ok: false, error: "That remembered key could not be read." };
  }
}

// -----------------------------------------------------------------------
// Identity keypairs — how a household's MK reaches a second member without a
// shared secret
// -----------------------------------------------------------------------

/**
 * A member's identity keypair. RSA-OAEP rather than ECDH because the job is
 * exactly `wrapKey`/`unwrapKey` of a 32-byte AES key for one named recipient,
 * which RSA-OAEP does in one native call with no ephemeral-key bookkeeping; a
 * 3072-bit modulus carries MK's 32 bytes with room to spare. Extractable for
 * the private half so it can be wrapped under the password (`wrapPrivateKey`)
 * and remembered per device, the same bargain `newMasterKey` strikes.
 */
export async function newIdentityKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["wrapKey", "unwrapKey"]
  );
}

/** The public half as SPKI base64 — the form that sits in `user_keys` in the
 *  clear, because a public key is public by definition and is what another
 *  member needs to wrap MK for this one. */
export async function exportPublicKey(publicKey) {
  try {
    return { ok: true, spki: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey))) };
  } catch (error) {
    return failure(error);
  }
}

export async function importPublicKey(spki) {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(spki),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["wrapKey"]
    );
    return { ok: true, key };
  } catch {
    return { ok: false, error: "That public key could not be read." };
  }
}

/** The private half as PKCS8 base64. Two callers: `wrapPrivateKey`, which
 *  seals these bytes under a password KEK for the server, and the per-device
 *  cache, which remembers them in the same `exportMasterKey` bargain — the one
 *  place the private key is written down, beside a plaintext cache of the very
 *  books it opens, and cleared with the session. */
export async function exportPrivateKey(privateKey) {
  try {
    return { ok: true, pkcs8: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey))) };
  } catch (error) {
    return failure(error);
  }
}

export async function importPrivateKey(pkcs8) {
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      base64ToBytes(pkcs8),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["unwrapKey"]
    );
    return { ok: true, key };
  } catch {
    return { ok: false, error: "That remembered key could not be read." };
  }
}

/**
 * Wrap a private key under a KEK derived from the books password (or recovery
 * code). The private key cannot export as "raw" the way MK does, so its PKCS8
 * bytes are AES-GCM encrypted under the KEK and framed `base64(iv ‖ ct)` — the
 * same one-string shape `wrapKey` produces, which is what a single column
 * holds. A wrong password fails GCM's tag the moment `unwrapPrivateKey` tries
 * it, so there is still no separate verifier.
 */
export async function wrapPrivateKey(kek, privateKey) {
  try {
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, pkcs8);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return { ok: true, wrapped: bytesToBase64(combined) };
  } catch (error) {
    return failure(error);
  }
}

export async function unwrapPrivateKey(kek, wrapped) {
  try {
    const combined = base64ToBytes(wrapped);
    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);
    const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ciphertext);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["unwrapKey"]
    );
    return { ok: true, key };
  } catch {
    return { ok: false, error: "That key could not be unwrapped." };
  }
}

/**
 * Wrap a household's MK for one member's public key. This is the whole of how
 * a second person comes to hold MK: an existing member, who has MK unlocked,
 * seals it under the invitee's public key so only the invitee's private key
 * can open it. The server stores the result (`household_keys.wrapped_mk`) and
 * is never nearer to MK for having relayed it.
 */
export async function wrapKeyFor(mk, recipientPublicKey) {
  try {
    const wrapped = await crypto.subtle.wrapKey("raw", mk, recipientPublicKey, { name: "RSA-OAEP" });
    return { ok: true, wrapped: bytesToBase64(new Uint8Array(wrapped)) };
  } catch (error) {
    return failure(error);
  }
}

/** The other half of `wrapKeyFor`: a member opens their own `wrapped_mk` with
 *  their private key. A wrap meant for a different member — a different public
 *  key — fails RSA-OAEP's own check and comes back `{ ok: false }` rather than
 *  throwing. */
export async function unwrapKeyWith(privateKey, wrapped) {
  try {
    const key = await crypto.subtle.unwrapKey(
      "raw",
      base64ToBytes(wrapped),
      privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    return { ok: true, key };
  } catch {
    return { ok: false, error: "That household key could not be unwrapped for this member." };
  }
}

/**
 * Seal one JSON-able value under MK. A fresh IV every call, which is the
 * whole reason `SyncContext`'s `known` has to keep holding plaintext —
 * the same document seals to different bytes each time, so ciphertext can
 * never be the thing a cache compares against.
 */
export async function encryptDocument(mk, kid, value) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, mk, plaintext);
    return {
      ok: true,
      envelope: {
        v: ENVELOPE_VERSION,
        kid,
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(ciphertext)),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * True only for a value that is actually one of these envelopes — a
 * non-null object carrying this version and string `kid`/`iv`/`ct`. Nothing
 * a real store writes has this shape (`booksCrypto.test.js` feeds it every
 * one of them), which is what lets `SyncContext`'s hydrate tell a sealed row
 * from a plaintext one left over from before this existed.
 */
export function isEncryptedDocument(value) {
  return (
    value != null &&
    typeof value === "object" &&
    value.v === ENVELOPE_VERSION &&
    typeof value.kid === "string" &&
    typeof value.iv === "string" &&
    typeof value.ct === "string"
  );
}

/** The key an envelope claims to be sealed with, or `null` if it is not a
 *  well-formed envelope at all. The `kid` check against the live account is
 *  the caller's — this only reads the claim off the envelope. */
export function envelopeKid(envelope) {
  return isEncryptedDocument(envelope) ? envelope.kid : null;
}

/**
 * Open an envelope. Refuses — rather than throwing — an envelope that is
 * not this shape, is the wrong version, or fails to decrypt (a wrong MK, or
 * a byte flipped anywhere in `iv`/`ct`, which GCM's tag catches).
 */
export async function decryptDocument(mk, envelope) {
  if (!isEncryptedDocument(envelope)) {
    return { ok: false, error: "That is not a sealed document this version understands." };
  }
  try {
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ct);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, mk, ciphertext);
    return { ok: true, value: JSON.parse(new TextDecoder().decode(plaintext)) };
  } catch {
    return { ok: false, error: "That document could not be opened." };
  }
}

// -----------------------------------------------------------------------
// Receipts — one binary blob, so it can be the whole of an uploaded file
// -----------------------------------------------------------------------

/** The framing's fixed header: 1 version byte, 16 raw `kid` bytes, 12 IV
 *  bytes. Everything after this is AES-GCM ciphertext with its 16-byte tag
 *  appended, exactly as `crypto.subtle.encrypt` already returns it. */
const BYTES_HEADER_LENGTH = 1 + 16 + 12;

/**
 * Seal a file's bytes under MK as one binary blob — no JSON, no base64,
 * because this is uploaded as a file and a receipt can be megabytes. The
 * `kid` rides along in the header so a sealed receipt names its key the
 * same way a document's envelope does, even though nothing here checks it
 * back — that is still the caller's job, same as `envelopeKid`.
 */
export async function encryptBytes(mk, kid, bytes) {
  const kidBytes = uuidToBytes(kid);
  if (!kidBytes) return { ok: false, error: "That key id is not a UUID." };
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, mk, bytes);
    const out = new Uint8Array(BYTES_HEADER_LENGTH + ciphertext.byteLength);
    out[0] = ENVELOPE_VERSION;
    out.set(kidBytes, 1);
    out.set(iv, 17);
    out.set(new Uint8Array(ciphertext), BYTES_HEADER_LENGTH);
    return { ok: true, bytes: out };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Open a sealed blob. The version byte is checked and anything this build
 * does not recognise is refused outright — the one byte that lets a future
 * format change be detected instead of fed to GCM as if it were today's.
 */
export async function decryptBytes(mk, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < BYTES_HEADER_LENGTH) {
    return { ok: false, error: "That is not a sealed file." };
  }
  if (bytes[0] !== ENVELOPE_VERSION) {
    return { ok: false, error: "That file was sealed with a version this build does not understand." };
  }
  try {
    const iv = bytes.subarray(17, BYTES_HEADER_LENGTH);
    const ciphertext = bytes.subarray(BYTES_HEADER_LENGTH);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, mk, ciphertext);
    return { ok: true, bytes: new Uint8Array(plaintext) };
  } catch {
    return { ok: false, error: "That file could not be opened." };
  }
}

// -----------------------------------------------------------------------
// The recovery code
// -----------------------------------------------------------------------

// Crockford's base32 alphabet: the ten digits and every letter but I, L, O
// and U, which are the four most often misread off a printed page or
// mistyped for a digit. 32 symbols, so each encodes exactly 5 bits.
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_ALPHABET_SET = new Set(RECOVERY_ALPHABET.split(""));

/**
 * ~160 bits of randomness as base32, printed in eight groups of four. 160
 * divides by 5 exactly, so every bit drawn becomes a printed character and
 * none are discarded padding.
 */
export function newRecoveryCode() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(20)); // 160 bits
  let bits = 0;
  let buffer = 0;
  let letters = "";

  for (const byte of randomBytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      letters += RECOVERY_ALPHABET[(buffer >>> bits) & 0x1f];
      buffer &= (1 << bits) - 1;
    }
  }

  const groups = [];
  for (let i = 0; i < letters.length; i += 4) groups.push(letters.slice(i, i + 4));
  return groups.join("-");
}

/**
 * What `deriveKek` actually sees, so a code retyped in lowercase or without
 * its hyphens derives the identical key. Everything that turns a recovery
 * code into a KEK passes it through here first — there is exactly one
 * canonical form, not a second comparison to keep in sync with the first.
 */
export function normalizeRecoveryCode(input) {
  let out = "";
  for (const ch of String(input ?? "").toUpperCase()) {
    if (RECOVERY_ALPHABET_SET.has(ch)) out += ch;
  }
  return out;
}

// -----------------------------------------------------------------------
// Setting up an account's key for the first time
// -----------------------------------------------------------------------

/**
 * A new master key, wrapped once under the password and once under a fresh
 * recovery code — the whole of what a first sign-in needs to write to
 * `app_crypto`. `kid` is generated here rather than left to the caller so
 * that this function alone owns "what a brand-new key record looks like",
 * and it comes from `uuid` v4 like every other id in the app: a `kid` is an
 * id, and RFC 4122's two fixed nibbles are not worth re-deriving by hand in
 * the one module whose whole job is not getting bytes wrong.
 *
 * The body is wrapped because `newMasterKey` is the one primitive here that
 * hands back a bare `CryptoKey` rather than `{ ok }` — a `generateKey` that
 * failed would otherwise throw straight out of the only function a caller
 * actually calls, past the convention every other export keeps.
 */
export async function newKeyRecord(password) {
  try {
    const mk = await newMasterKey();
    const kid = uuidV4();

    const passwordSalt = newSalt();
    const passwordKek = await deriveKek(password, { salt: passwordSalt, kdf: DEFAULT_KDF });
    if (!passwordKek.ok) return failure(passwordKek.error);
    const passwordWrap = await wrapKey(passwordKek.key, mk);
    if (!passwordWrap.ok) return failure(passwordWrap.error);

    const recoveryCode = newRecoveryCode();
    const recoverySalt = newSalt();
    const recoveryKek = await deriveKek(normalizeRecoveryCode(recoveryCode), {
      salt: recoverySalt,
      kdf: DEFAULT_KDF,
    });
    if (!recoveryKek.ok) return failure(recoveryKek.error);
    const recoveryWrap = await wrapKey(recoveryKek.key, mk);
    if (!recoveryWrap.ok) return failure(recoveryWrap.error);

    return {
      ok: true,
      mk,
      kid,
      recoveryCode,
      record: {
        kid,
        kdf: DEFAULT_KDF,
        password_salt: passwordSalt,
        password_wrap: passwordWrap.wrapped,
        recovery_salt: recoverySalt,
        recovery_wrap: recoveryWrap.wrapped,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * A new identity keypair, its private half wrapped once under the password and
 * once under a fresh recovery code — the whole of what a first sign-in writes
 * to `user_keys`. The shared-household analogue of `newKeyRecord`, and the same
 * shape of answer, with one difference that is the entire point: what is
 * wrapped here is a **private key**, not a master key. The master key belongs
 * to a household, is minted when a household is created, and is wrapped for this
 * identity's public key in `household_keys` — never under a password at all.
 *
 * So a password change rewraps this private key and touches no household; and a
 * person in several households unlocks all of them from this one secret.
 */
export async function newIdentityRecord(password) {
  try {
    const pair = await newIdentityKeyPair();
    const publicKey = await exportPublicKey(pair.publicKey);
    if (!publicKey.ok) return failure(publicKey.error);

    const passwordSalt = newSalt();
    const passwordKek = await deriveKek(password, { salt: passwordSalt, kdf: DEFAULT_KDF });
    if (!passwordKek.ok) return failure(passwordKek.error);
    const passwordWrap = await wrapPrivateKey(passwordKek.key, pair.privateKey);
    if (!passwordWrap.ok) return failure(passwordWrap.error);

    const recoveryCode = newRecoveryCode();
    const recoverySalt = newSalt();
    const recoveryKek = await deriveKek(normalizeRecoveryCode(recoveryCode), {
      salt: recoverySalt,
      kdf: DEFAULT_KDF,
    });
    if (!recoveryKek.ok) return failure(recoveryKek.error);
    const recoveryWrap = await wrapPrivateKey(recoveryKek.key, pair.privateKey);
    if (!recoveryWrap.ok) return failure(recoveryWrap.error);

    return {
      ok: true,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      recoveryCode,
      record: {
        kdf: DEFAULT_KDF,
        public_key: publicKey.spki,
        password_salt: passwordSalt,
        password_wrap: passwordWrap.wrapped,
        recovery_salt: recoverySalt,
        recovery_wrap: recoveryWrap.wrapped,
      },
    };
  } catch (error) {
    return failure(error);
  }
}
