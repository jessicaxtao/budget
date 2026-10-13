import {
  ENVELOPE_VERSION,
  DEFAULT_KDF,
  newSalt,
  newMasterKey,
  deriveKek,
  wrapKey,
  unwrapKey,
  encryptDocument,
  decryptDocument,
  encryptBytes,
  decryptBytes,
  isEncryptedDocument,
  envelopeKid,
  newRecoveryCode,
  normalizeRecoveryCode,
  newKeyRecord,
  exportMasterKey,
  importMasterKey,
} from "./booksCrypto";
import { STORE_KEYS } from "./storage";
import { EMPTY_SCHEDULE } from "./contexts/PayScheduleContext";
import { DEFAULT_PLAN } from "./contexts/RetirementContext";
import { DEFAULT_FUND } from "./contexts/EmergencyFundContext";
import { DEFAULT_GIVING_SETTINGS } from "./contexts/DonationsContext";

// PBKDF2 at 600,000 iterations (`DEFAULT_KDF`) is deliberately slow — it is
// this module's whole defence against an offline guess against a stolen
// row. A suite that derives several KEKs needs more than Jest's 5-second
// default; raised once here rather than lowering the iteration count
// anywhere, which would test a KDF nobody actually ships.
jest.setTimeout(30000);

const PASSWORD = "a very good books password";

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe("booksCrypto", () => {
  test("round trip: a document encrypted under MK decrypts back to the same value", async () => {
    const mk = await newMasterKey();
    const kid = "11111111-1111-4111-8111-111111111111";
    const value = { transactions: [{ id: "t1", amountCents: 4321 }], note: "déjà vu 🎉" };

    const sealed = await encryptDocument(mk, kid, value);
    expect(sealed.ok).toBe(true);
    expect(sealed.envelope.v).toBe(ENVELOPE_VERSION);
    expect(sealed.envelope.kid).toBe(kid);
    expect(typeof sealed.envelope.iv).toBe("string");
    expect(typeof sealed.envelope.ct).toBe("string");

    const opened = await decryptDocument(mk, sealed.envelope);
    expect(opened).toEqual({ ok: true, value });
  });

  test("a wrong password fails closed rather than unwrapping the wrong key", async () => {
    const salt = newSalt();
    const kek = await deriveKek(PASSWORD, { salt, kdf: DEFAULT_KDF });
    expect(kek.ok).toBe(true);
    const mk = await newMasterKey();
    const wrapped = await wrapKey(kek.key, mk);
    expect(wrapped.ok).toBe(true);

    const wrongKek = await deriveKek("not the password", { salt, kdf: DEFAULT_KDF });
    expect(wrongKek.ok).toBe(true);

    const attempt = await unwrapKey(wrongKek.key, wrapped.wrapped);
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toBeTruthy();
  });

  test("a tampered document fails rather than returning garbage", async () => {
    const mk = await newMasterKey();
    const sealed = await encryptDocument(mk, "kid-1", { a: 1 });

    const ctBytes = base64ToBytes(sealed.envelope.ct);
    ctBytes[0] ^= 0xff; // flip one byte — GCM's tag check must now fail
    const tampered = { ...sealed.envelope, ct: bytesToBase64(ctBytes) };

    const opened = await decryptDocument(mk, tampered);
    expect(opened).toEqual({ ok: false, error: expect.any(String) });
  });

  test("a tampered binary blob fails rather than returning garbage", async () => {
    const mk = await newMasterKey();
    const kid = "22222222-2222-4222-8222-222222222222";
    const sealed = await encryptBytes(mk, kid, new Uint8Array([10, 20, 30, 255, 0, 128]));
    expect(sealed.ok).toBe(true);

    const tampered = Uint8Array.from(sealed.bytes);
    tampered[tampered.length - 1] ^= 0xff; // flip a byte in the ciphertext/tag

    const opened = await decryptBytes(mk, tampered);
    expect(opened).toEqual({ ok: false, error: expect.any(String) });
  });

  test("encryptBytes frames the kid as 16 raw bytes, matching the UUID it was given", async () => {
    const mk = await newMasterKey();
    const kid = "11111111-2222-4333-8444-555555555555";
    const { ok, bytes } = await encryptBytes(mk, kid, new Uint8Array([1, 2, 3]));
    expect(ok).toBe(true);
    expect(bytes[0]).toBe(ENVELOPE_VERSION);
    const kidHex = Array.from(bytes.slice(1, 17), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(kidHex).toBe(kid.replace(/-/g, ""));
  });

  test("encryptBytes refuses a kid that is not a UUID rather than framing garbage", async () => {
    const mk = await newMasterKey();
    const result = await encryptBytes(mk, "not-a-uuid", new Uint8Array([1]));
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  test("encryptBytes / decryptBytes round-trip a binary blob unchanged, including bytes that are not valid UTF-8", async () => {
    const mk = await newMasterKey();
    const kid = "33333333-3333-4333-8333-333333333333";
    // 0xff 0xfe on their own are not valid UTF-8 — if either side went
    // through a string anywhere, this would come back altered.
    const payload = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0x80, 0x81, 200, 201, 255]);

    const sealed = await encryptBytes(mk, kid, payload);
    expect(sealed.ok).toBe(true);
    // version(1) + kid(16) + iv(12) + ciphertext(payload) + tag(16)
    expect(sealed.bytes.length).toBe(1 + 16 + 12 + payload.length + 16);

    const opened = await decryptBytes(mk, sealed.bytes);
    expect(opened.ok).toBe(true);
    expect(Array.from(opened.bytes)).toEqual(Array.from(payload));
  });

  test("decryptBytes fails closed on a version byte it does not recognise", async () => {
    const mk = await newMasterKey();
    const kid = "44444444-4444-4444-8444-444444444444";
    const sealed = await encryptBytes(mk, kid, new Uint8Array([9, 9, 9]));

    const fromTheFuture = Uint8Array.from(sealed.bytes);
    fromTheFuture[0] = ENVELOPE_VERSION + 1;

    const opened = await decryptBytes(mk, fromTheFuture);
    expect(opened).toEqual({ ok: false, error: expect.any(String) });
  });

  test("newKeyRecord: the recovery code unwraps the same master key as the password", async () => {
    const created = await newKeyRecord(PASSWORD);
    expect(created.ok).toBe(true);
    const { mk, record } = created;

    const recoveryKek = await deriveKek(normalizeRecoveryCode(created.recoveryCode), {
      salt: record.recovery_salt,
      kdf: record.kdf,
    });
    expect(recoveryKek.ok).toBe(true);
    const unwrapped = await unwrapKey(recoveryKek.key, record.recovery_wrap);
    expect(unwrapped.ok).toBe(true);

    // Two non-exported `CryptoKey`s are the same key if — and only if — they
    // produce identical ciphertext from the same plaintext and IV.
    const iv = new Uint8Array(12);
    const plaintext = new Uint8Array([7]);
    const sealedByMk = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, mk, plaintext);
    const sealedByRecovered = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      unwrapped.key,
      plaintext
    );
    expect(Array.from(new Uint8Array(sealedByRecovered))).toEqual(
      Array.from(new Uint8Array(sealedByMk))
    );
  });

  test("a recovery code retyped lowercase and without hyphens still unwraps", async () => {
    const created = await newKeyRecord(PASSWORD);
    const { record } = created;
    const retyped = created.recoveryCode.toLowerCase().replace(/-/g, "");

    const kek = await deriveKek(normalizeRecoveryCode(retyped), {
      salt: record.recovery_salt,
      kdf: record.kdf,
    });
    expect(kek.ok).toBe(true);
    const unwrapped = await unwrapKey(kek.key, record.recovery_wrap);
    expect(unwrapped.ok).toBe(true);
  });

  test("rewrapping MK under a new password leaves a document encrypted before the rewrap still readable", async () => {
    const created = await newKeyRecord(PASSWORD);
    const { mk, kid, record } = created;

    const sealedBefore = await encryptDocument(mk, kid, { before: true });

    // Change the password: a fresh salt, a fresh wrap, the same MK.
    const newPasswordSalt = newSalt();
    const newPasswordKek = await deriveKek("a brand new password", {
      salt: newPasswordSalt,
      kdf: record.kdf,
    });
    expect(newPasswordKek.ok).toBe(true);
    const rewrapped = await wrapKey(newPasswordKek.key, mk);
    expect(rewrapped.ok).toBe(true);

    // Unwrap under the new password and open the document sealed before the
    // rewrap — MK itself never changed, so it still opens.
    const reopenedKek = await deriveKek("a brand new password", {
      salt: newPasswordSalt,
      kdf: record.kdf,
    });
    const unwrapped = await unwrapKey(reopenedKek.key, rewrapped.wrapped);
    expect(unwrapped.ok).toBe(true);

    const opened = await decryptDocument(unwrapped.key, sealedBefore.envelope);
    expect(opened).toEqual({ ok: true, value: { before: true } });
  });

  test("unwrapKey and decryptDocument fail closed on garbage input rather than throwing", async () => {
    const mk = await newMasterKey();
    const kek = await deriveKek(PASSWORD, { salt: newSalt(), kdf: DEFAULT_KDF });

    await expect(unwrapKey(kek.key, "not valid base64 !!")).resolves.toMatchObject({ ok: false });
    await expect(
      decryptDocument(mk, { v: ENVELOPE_VERSION, kid: "k", iv: "!!", ct: "!!" })
    ).resolves.toMatchObject({ ok: false });
  });

  test("decryptDocument refuses an envelope missing a field, rather than throwing", async () => {
    const mk = await newMasterKey();
    const sealed = await encryptDocument(mk, "kid-1", { a: 1 });
    const { ct, ...withoutCt } = sealed.envelope;
    void ct;

    const opened = await decryptDocument(mk, withoutCt);
    expect(opened).toEqual({ ok: false, error: expect.any(String) });
  });

  test("envelopeKid reads the kid off a well-formed envelope and refuses anything else", async () => {
    const mk = await newMasterKey();
    const sealed = await encryptDocument(mk, "kid-xyz", { a: 1 });
    expect(envelopeKid(sealed.envelope)).toBe("kid-xyz");
    expect(envelopeKid({})).toBeNull();
    expect(envelopeKid(null)).toBeNull();
    expect(envelopeKid([])).toBeNull();
    expect(envelopeKid("a string")).toBeNull();
  });

  test("newRecoveryCode is eight hyphen-separated groups of four base32 characters, and never repeats", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    expect(newRecoveryCode()).not.toBe(code);
  });

  test("normalizeRecoveryCode upper-cases and strips anything that is not a base32 character", () => {
    const code = newRecoveryCode();
    const messy = `  ${code.toLowerCase().replace(/-/g, " ")}  `;
    expect(normalizeRecoveryCode(messy)).toBe(code.replace(/-/g, ""));
  });

  test("isEncryptedDocument says no to every real store document shape", () => {
    // The two handfuls of stores whose default is a singleton object rather
    // than a list — the shapes closest to an envelope's own, since an
    // envelope is a plain object too. Read off their own contexts rather
    // than guessed.
    const OBJECT_DEFAULTS = {
      paySchedule: EMPTY_SCHEDULE,
      retirementPlan: DEFAULT_PLAN,
      emergencyFund: DEFAULT_FUND,
      givingSettings: DEFAULT_GIVING_SETTINGS,
      rewardsValuations: {},
    };

    expect(STORE_KEYS.length).toBeGreaterThan(0);

    for (const key of STORE_KEYS) {
      const singleton = OBJECT_DEFAULTS[key];
      if (singleton !== undefined) {
        expect(isEncryptedDocument(singleton)).toBe(false);
      } else {
        // Every other store defaults to an array — empty, as a fresh
        // account has it, and populated, as a real household's does.
        expect(isEncryptedDocument([])).toBe(false);
        expect(
          isEncryptedDocument([
            { id: "11111111-1111-4111-8111-111111111111", amountCents: 1234, name: key },
          ])
        ).toBe(false);
      }
    }

    expect(isEncryptedDocument({})).toBe(false);
    expect(isEncryptedDocument(null)).toBe(false);
    expect(isEncryptedDocument(undefined)).toBe(false);
    expect(isEncryptedDocument("a string")).toBe(false);
    expect(isEncryptedDocument(42)).toBe(false);
    // Close, but the version is wrong — the one shape most likely to slip
    // past a looser check than the one this function actually does.
    expect(isEncryptedDocument({ v: 2, kid: "k", iv: "i", ct: "c" })).toBe(false);
  });

  /**
   * The key cache's round trip. This is what lets a device remember the key
   * across a reload instead of asking for the books password every time, so
   * the claim worth pinning is that the key which comes back out still opens
   * what the key that went in had sealed — not merely that the base64 matches.
   */
  test("a master key survives being exported to the cache and imported back", async () => {
    const mk = await newMasterKey();
    const kid = "11111111-1111-4111-8111-111111111111";
    const sealed = await encryptDocument(mk, kid, { transactions: [{ amountCents: 4200 }] });

    const exported = await exportMasterKey(mk);
    expect(exported.ok).toBe(true);
    expect(typeof exported.raw).toBe("string");

    const reimported = await importMasterKey(exported.raw);
    expect(reimported.ok).toBe(true);

    const opened = await decryptDocument(reimported.key, sealed.envelope);
    expect(opened).toEqual({ ok: true, value: { transactions: [{ amountCents: 4200 }] } });
  });

  // A cache that will not import is a cache to throw away, and the caller
  // falls back to asking for the password — so this must refuse rather than
  // throw, or a corrupt key in storage would white-screen every reload with
  // nothing to clear it.
  test("a corrupt cached key is refused rather than thrown", async () => {
    expect(await importMasterKey("not base64 at all!!")).toEqual({
      ok: false,
      error: "That remembered key could not be read.",
    });
    // Valid base64, wrong length for an AES-256 key.
    expect((await importMasterKey("YWJj")).ok).toBe(false);
  });
});
