import {
  MAX_RECEIPT_BYTES,
  RECEIPT_MEDIA,
  checkReceiptFile,
  deleteReceipt,
  readReceipt,
  saveReceipt,
} from "./receipts";
import { GUEST_SCOPE, setStorageScope } from "./storage";
import { getSupabase } from "./supabaseClient";
import { setBooksKey, clearBooksKey } from "./booksKey";
import { newMasterKey } from "./booksCrypto";

jest.mock("./supabaseClient", () => ({ getSupabase: jest.fn(), isSupabaseConfigured: true }));

const pdf = (body = "%PDF-1.4") => new File([body], "letter.pdf", { type: "application/pdf" });

// A fixed, well-formed `kid` — what the account's key record would carry.
// Its actual value is never asserted on; it only has to be a UUID, since
// that is all `encryptBytes` requires of it.
const KID = "11111111-1111-4111-8111-111111111111";

// jsdom's `File`/`Blob` has no `arrayBuffer()` (see `readBytes` in
// receipts.js, which falls back to this same `FileReader` for the same
// reason) — this is the test side of that fallback.
function bytesOf(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  setStorageScope(null);
  clearBooksKey();
  delete window.__hbDesktop;
});

describe("checkReceiptFile", () => {
  test("takes a PDF or a photo, and nothing empty, oversized or of another kind", () => {
    expect(checkReceiptFile(pdf())).toBeNull();
    expect(checkReceiptFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
    expect(checkReceiptFile(new File(["x"], "a.txt", { type: "text/plain" }))).toMatch(/PDF or a photo/);
    expect(checkReceiptFile(new File([], "a.pdf", { type: "application/pdf" }))).toMatch(/empty/);
    const huge = { name: "a.pdf", type: "application/pdf", size: MAX_RECEIPT_BYTES + 1 };
    expect(checkReceiptFile(huge)).toMatch(/over 10 MB/);
  });
});

describe("without an account, in a browser", () => {
  beforeEach(() => getSupabase.mockReturnValue(null));

  test("a receipt is stored, read back and deleted here, unsealed — it never leaves the device", async () => {
    setStorageScope(GUEST_SCOPE);
    const file = pdf("%PDF thanks");
    const saved = await saveReceipt(file);
    expect(saved.ok).toBe(true);
    expect(saved.receipt.storedIn).toBe(RECEIPT_MEDIA.BROWSER);
    expect(saved.receipt.sealed).toBeUndefined();

    const read = await readReceipt(saved.receipt);
    expect(read.ok).toBe(true);
    expect(read.blob).toBe(file);

    await deleteReceipt(saved.receipt);
    expect((await readReceipt(saved.receipt)).ok).toBe(false);
  });

  test("a receipt kept in the account says so rather than failing silently", async () => {
    const receipt = {
      id: "x",
      name: "letter.pdf",
      type: "application/pdf",
      sizeBytes: 1,
      addedOn: "2026-10-09",
      storedIn: RECEIPT_MEDIA.ACCOUNT,
    };
    expect(await readReceipt(receipt)).toEqual({
      ok: false,
      error: "This receipt is stored in your account — sign in to open it.",
    });
  });
});

describe("on this computer, in the desktop shell", () => {
  beforeEach(() => getSupabase.mockReturnValue(null));

  test("the bytes handed to the bridge are the file's own, unsealed — those bytes never leave the device", async () => {
    const receiptPut = jest.fn().mockResolvedValue({ ok: true });
    window.__hbDesktop = { receiptPut };
    setStorageScope(GUEST_SCOPE);

    // The COMPUTER branch (untouched by this change) reads the file with
    // `file.arrayBuffer()` directly, which real browsers and Electron have
    // and jsdom 16 does not — so a File-like stub exercises the branch's
    // own logic here rather than tripping over an unrelated environment gap.
    const originalBytes = new TextEncoder().encode("%PDF plain, on this computer's own disk");
    const file = {
      name: "letter.pdf",
      type: "application/pdf",
      size: originalBytes.byteLength,
      arrayBuffer: () => Promise.resolve(originalBytes.buffer),
    };
    const saved = await saveReceipt(file);

    expect(saved.ok).toBe(true);
    expect(saved.receipt.storedIn).toBe(RECEIPT_MEDIA.COMPUTER);
    expect(saved.receipt.sealed).toBeUndefined();
    expect(receiptPut).toHaveBeenCalledTimes(1);
    const [id, ext, bytesArg] = receiptPut.mock.calls[0];
    expect(id).toBe(saved.receipt.id);
    expect(ext).toBe("pdf");
    expect(Array.from(bytesArg)).toEqual(Array.from(originalBytes));
  });
});

describe("signed in, with the books unlocked", () => {
  beforeEach(async () => {
    setBooksKey(await newMasterKey(), KID);
  });

  // This is the test the task exists to pass: what reaches the wire is not
  // the file, and nothing of the file's own content survives in it.
  test("an account-medium upload sends bytes that are not the file's own", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    getSupabase.mockReturnValue({ storage: { from: () => ({ upload }) } });
    setStorageScope("user-1");

    const secret = "Thank you for your $5,000 gift to Example Charity, dated 2026-10-09.";
    const file = pdf(secret);
    const plainBytes = await bytesOf(file);

    const saved = await saveReceipt(file);
    expect(saved.ok).toBe(true);
    expect(saved.receipt.sealed).toBe(true);

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, uploadedBytes, options] = upload.mock.calls[0];
    expect(path).toBe(`user-1/${saved.receipt.id}.pdf`);
    expect(options).toEqual({ contentType: "application/octet-stream", upsert: false });

    expect(uploadedBytes).toBeInstanceOf(Uint8Array);
    expect(uploadedBytes).not.toBe(file);
    expect(Array.from(uploadedBytes)).not.toEqual(Array.from(plainBytes));

    // Decoding the sealed bytes as text (best-effort — most of it is not
    // valid UTF-8, which is itself evidence it is not the plaintext) must
    // not surface anything readable from the original file.
    const uploadedText = Buffer.from(uploadedBytes).toString("latin1");
    expect(uploadedText).not.toContain(secret);
    expect(uploadedText).not.toContain("5,000");
    expect(uploadedText).not.toContain("Example Charity");
  });

  test("the path is still the signed-in user's own folder, and the upload never overwrites", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn(() => ({ upload, remove }));
    getSupabase.mockReturnValue({ storage: { from } });
    setStorageScope("user-1");

    const saved = await saveReceipt(pdf());
    expect(saved.ok).toBe(true);
    expect(saved.receipt.storedIn).toBe(RECEIPT_MEDIA.ACCOUNT);
    expect(from).toHaveBeenCalledWith("receipts");
    expect(upload).toHaveBeenCalledWith(
      `user-1/${saved.receipt.id}.pdf`,
      expect.any(Uint8Array),
      { contentType: "application/octet-stream", upsert: false }
    );

    await deleteReceipt(saved.receipt);
    expect(remove).toHaveBeenCalledWith([`user-1/${saved.receipt.id}.pdf`]);
  });

  test("a sealed receipt round-trips: readReceipt returns the original bytes exactly", async () => {
    let uploadedBytes = null;
    const upload = jest.fn(async (_path, bytes) => {
      uploadedBytes = bytes;
      return { error: null };
    });
    const download = jest.fn(async () => ({ data: new Blob([uploadedBytes]), error: null }));
    getSupabase.mockReturnValue({ storage: { from: () => ({ upload, download }) } });
    setStorageScope("user-1");

    const original = "%PDF-1.4 a real, honest receipt";
    const file = pdf(original);
    const originalBytes = await bytesOf(file);

    const saved = await saveReceipt(file);
    expect(saved.ok).toBe(true);
    expect(saved.receipt.sealed).toBe(true);

    const read = await readReceipt(saved.receipt);
    expect(read.ok).toBe(true);
    const roundTripped = await bytesOf(read.blob);
    expect(Array.from(roundTripped)).toEqual(Array.from(originalBytes));
  });

  test("an unsealed receipt — uploaded before this change — still downloads and opens unchanged", async () => {
    const plainBlob = new Blob(["%PDF-1.4 uploaded before sealing existed"], {
      type: "application/pdf",
    });
    const download = jest.fn().mockResolvedValue({ data: plainBlob, error: null });
    getSupabase.mockReturnValue({ storage: { from: () => ({ download }) } });
    setStorageScope("user-1");

    const legacyReceipt = {
      id: "legacy-1",
      name: "letter.pdf",
      type: "application/pdf",
      sizeBytes: 42,
      addedOn: "2026-01-01",
      storedIn: RECEIPT_MEDIA.ACCOUNT,
      // No `sealed` field at all — exactly what a pre-encryption record
      // looks like.
    };

    const read = await readReceipt(legacyReceipt);
    expect(read.ok).toBe(true);
    expect(read.blob).toBe(plainBlob);
  });

  test("a refused upload is reported and describes nothing", async () => {
    const upload = jest.fn().mockResolvedValue({ error: { message: "Payload too large" } });
    getSupabase.mockReturnValue({ storage: { from: () => ({ upload }) } });
    setStorageScope("user-1");

    expect(await saveReceipt(pdf())).toEqual({
      ok: false,
      error: "The receipt could not be saved: Payload too large",
    });
  });
});

describe("signed in, with the books locked", () => {
  test("saveReceipt refuses rather than uploading in the clear", async () => {
    clearBooksKey();
    const upload = jest.fn().mockResolvedValue({ error: null });
    getSupabase.mockReturnValue({ storage: { from: () => ({ upload }) } });
    setStorageScope("user-1");

    const result = await saveReceipt(pdf());
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(upload).not.toHaveBeenCalled();
  });

  test("readReceipt on a sealed receipt refuses rather than handing back ciphertext", async () => {
    clearBooksKey();
    const download = jest.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      error: null,
    });
    getSupabase.mockReturnValue({ storage: { from: () => ({ download }) } });
    setStorageScope("user-1");

    const sealedReceipt = {
      id: "sealed-1",
      name: "letter.pdf",
      type: "application/pdf",
      sizeBytes: 5,
      addedOn: "2026-10-09",
      storedIn: RECEIPT_MEDIA.ACCOUNT,
      sealed: true,
    };

    const read = await readReceipt(sealedReceipt);
    expect(read.ok).toBe(false);
    expect(typeof read.error).toBe("string");
  });
});
