import { v4 as uuidV4 } from "uuid";
import { GUEST_SCOPE, getStorageScope } from "./storage";
import { getSupabase } from "./supabaseClient";
import {
  isDesktop,
  openReceiptFile,
  putReceiptFile,
  removeReceiptFile,
} from "./desktop";
import { todayISO } from "./utils";
import { getBooksKey } from "./booksKey";
import { encryptBytes, decryptBytes } from "./booksCrypto";

/**
 * Receipts — the charity's written acknowledgment of a gift — as files.
 *
 * **A file is not a document, so it does not go where the books go.** Every
 * store is one JSON document, pushed whole on every write and held whole in
 * `localStorage`; a few scanned receipts as base64 would make every edit to a
 * gift re-send megabytes and would fill a browser's few megabytes of storage on
 * their own. So the bytes live beside the books, in the medium that matches
 * where the books are, and the donation record holds only a small
 * description of the file (`receipt` on the donation: id, name, type, size, the
 * day it was added, and where it was stored).
 *
 * **Where is decided the way the books' source of truth is** (see
 * `storage.js`):
 *
 *   - Signed in: the account's private `receipts` bucket in Supabase Storage,
 *     under a folder named by the user id, which is what its row-level policy
 *     checks (`supabase/schema.sql`). Any device signed in can open it.
 *   - Local, in the desktop shell: a file in the app's own folder on this
 *     computer, through three narrow bridge verbs (`electron/receipts.js`).
 *   - Local, in a browser: this browser's IndexedDB — or, where there is none
 *     (the test suite), memory.
 *
 * `storedIn` on the record names which, because a household can change mode
 * — sign in after a trial, or stop syncing on the desktop — and a receipt does
 * not travel with the books when it does. Asked for one that lives elsewhere,
 * this says where it is rather than failing with nothing to say.
 *
 * **This is a second, independent door to the server, and it is sealed the
 * same way the first one is.** A receipt filed under `ACCOUNT` carries the
 * charity's name, the amount, the date and usually the household's own name
 * and address — exactly what `SyncContext`'s envelope encryption exists to
 * keep off the server. `saveReceipt` encrypts the bytes under the books key
 * (`booksKey.js`) before upload and marks the record `sealed: true`;
 * `readReceipt` decrypts after download when the record says so. A receipt
 * filed under `COMPUTER` or `BROWSER` is never sealed — those bytes never
 * leave the device, so there is nothing to protect and sealing them would
 * only break opening the file locally.
 */

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * What a receipt can be, and the extension each is filed under. Also written
 * out in `electron/receipts.js` (the shell cannot import this module), and in
 * the bucket's `allowed_mime_types` in `supabase/schema.sql` — change one,
 * change all three.
 */
export const RECEIPT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** For a file input's `accept`. */
export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES).join(",");

export const RECEIPT_MEDIA = {
  ACCOUNT: "account",
  COMPUTER: "computer",
  BROWSER: "browser",
};

const BUCKET = "receipts";

function currentMedium() {
  const scope = getStorageScope();
  if (scope && scope !== GUEST_SCOPE && getSupabase()) return RECEIPT_MEDIA.ACCOUNT;
  if (isDesktop()) return RECEIPT_MEDIA.COMPUTER;
  return RECEIPT_MEDIA.BROWSER;
}

/** Why a file cannot be a receipt, or null. Checked before anything is sent. */
export function checkReceiptFile(file) {
  if (!file) return "Choose a file.";
  if (!RECEIPT_TYPES[file.type]) return "Attach a PDF or a photo (JPEG, PNG, WebP, GIF or HEIC).";
  if (file.size > MAX_RECEIPT_BYTES) return "That file is over 10 MB. Attach a smaller copy.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/**
 * A description of a stored receipt is well formed. Used by the store's
 * migration. Deliberately does not require `sealed` — it is new and
 * optional, so a receipt attached before encryption existed still passes
 * this check unchanged.
 */
export function isReceipt(value) {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof RECEIPT_TYPES[value.type] === "string" &&
    Object.values(RECEIPT_MEDIA).includes(value.storedIn)
  );
}

const WHERE = {
  [RECEIPT_MEDIA.ACCOUNT]: "in your account — sign in to open it",
  [RECEIPT_MEDIA.COMPUTER]: "on the computer it was attached on",
  [RECEIPT_MEDIA.BROWSER]: "in the browser it was attached in, without an account",
};

function elsewhere(receipt) {
  return {
    ok: false,
    error: `This receipt is stored ${WHERE[receipt.storedIn] ?? "somewhere else"}.`,
  };
}

// Unchanged even for a sealed receipt, deliberately: the real extension on a
// file of ciphertext is a small lie, and the right trade. Changing it would
// strand every receipt already uploaded under the honest one, to hide a
// media type the server can infer anyway from the record's own `sizeBytes`.
// Neither path segment is a filename — the first is the user id Storage's
// own policy already checks, the second a UUID — so nothing here names what
// the bytes are regardless of the extension on the end.
function accountPath(receipt) {
  return `${getStorageScope()}/${receipt.id}.${RECEIPT_TYPES[receipt.type]}`;
}

/**
 * A `File` or `Blob`'s bytes, for the account medium's encrypt-before-upload
 * and decrypt-after-download. Not `blob.arrayBuffer()` directly: that method
 * is on every real browser's and Electron's `Blob`, but jsdom 16 (bundled
 * with react-scripts 5, and the only environment the test suite has) does
 * not implement it on the `File`/`Blob` it polyfills, so this falls back to
 * `FileReader`, which jsdom does implement and which real browsers have kept
 * around for exactly this reason. Both paths read the same bytes; this only
 * picks whichever one the environment actually has.
 */
function readBytes(blob) {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(blob);
  });
}

function failure(error) {
  return { ok: false, error: `The receipt could not be saved: ${String(error?.message ?? error)}` };
}

// ---------------------------------------------------------------------------
// This browser, without an account
// ---------------------------------------------------------------------------

const memory = new Map();
let dbPromise = null;

function browserKey(id) {
  return `${getStorageScope() ?? "local"}/${id}`;
}

function openDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("canopy-receipts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function browserCall(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", mode);
    const request = run(tx.objectStore("files"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

const browserStore = {
  async put(id, blob) {
    if (!openDb()) return void memory.set(browserKey(id), blob);
    await browserCall("readwrite", (files) => files.put(blob, browserKey(id)));
  },
  async get(id) {
    if (!openDb()) return memory.get(browserKey(id)) ?? null;
    return (await browserCall("readonly", (files) => files.get(browserKey(id)))) ?? null;
  },
  async remove(id) {
    if (!openDb()) return void memory.delete(browserKey(id));
    await browserCall("readwrite", (files) => files.delete(browserKey(id)));
  },
};

// ---------------------------------------------------------------------------
// The three verbs
// ---------------------------------------------------------------------------

/**
 * Store a file and describe it. Nothing is written to the books here — the
 * caller writes the description onto the gift, and deletes the file again if
 * that write is refused, so a refused gift never leaves a file behind.
 */
export async function saveReceipt(file) {
  const problem = checkReceiptFile(file);
  if (problem) return { ok: false, error: problem };

  const receipt = {
    id: uuidV4(),
    name: file.name || `receipt.${RECEIPT_TYPES[file.type]}`,
    type: file.type,
    sizeBytes: file.size,
    addedOn: todayISO(),
    storedIn: currentMedium(),
  };

  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      // This is the second door to the server (see the module comment at
      // the top of the file): a donation receipt carries the charity's
      // name, the amount, the date and usually the household's own name and
      // address, so it is sealed exactly as a document going through
      // SyncContext is. Sealing is not best-effort — with no key on this
      // device there is no fallback upload in the clear, only a refusal.
      const key = getBooksKey();
      if (!key) return failure("your books are locked — unlock them before attaching a receipt");

      const plainBytes = await readBytes(file);
      const sealed = await encryptBytes(key.mk, key.kid, plainBytes);
      if (!sealed.ok) return failure(sealed.error);

      const { error } = await getSupabase()
        .storage.from(BUCKET)
        .upload(accountPath(receipt), sealed.bytes, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (error) return failure(error);
      receipt.sealed = true;
    } else if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER) {
      // Unsealed, on purpose: these bytes are already on the household's
      // own machine, so encrypting them buys nothing, and it would break
      // `openReceiptFile`, which hands the file straight to whatever the
      // household opens a PDF or a photo with.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await putReceiptFile(receipt.id, RECEIPT_TYPES[file.type], bytes);
      if (!result.ok) return failure(result.error ?? "the file could not be written");
    } else {
      // Unsealed for the same reason as COMPUTER above: this browser's own
      // IndexedDB never leaves the device either.
      await browserStore.put(receipt.id, file);
    }
  } catch (error) {
    return failure(error);
  }
  return { ok: true, receipt };
}

/** The file's bytes, where this session can reach them. */
export async function readReceipt(receipt) {
  if (receipt.storedIn !== currentMedium()) return elsewhere(receipt);
  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      const { data, error } = await getSupabase().storage.from(BUCKET).download(accountPath(receipt));
      if (error || !data) return { ok: false, error: "The receipt could not be found." };
      // Take an unsealed receipt — one uploaded before this change existed
      // — as-is, the same stance `SyncContext`'s hydrate takes on a
      // plaintext row: one rule for "the server's copy predates
      // encryption", in both doors.
      if (!receipt.sealed) return { ok: true, blob: data };

      const key = getBooksKey();
      if (!key) {
        return { ok: false, error: "This receipt is sealed — unlock your books to open it." };
      }
      const cipherBytes = await readBytes(data);
      const opened = await decryptBytes(key.mk, cipherBytes);
      if (!opened.ok) return { ok: false, error: opened.error };
      return { ok: true, blob: new Blob([opened.bytes], { type: receipt.type }) };
    }
    if (receipt.storedIn === RECEIPT_MEDIA.BROWSER) {
      const blob = await browserStore.get(receipt.id);
      return blob ? { ok: true, blob } : { ok: false, error: "The receipt could not be found." };
    }
    return { ok: false, unsupported: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Show the receipt. On this computer it opens in whatever the household opens
 * a PDF or a photo with; anywhere else it is handed over as a download, which
 * is the one door a browser has that no popup blocker or content policy stands
 * in front of.
 */
export async function openReceipt(receipt) {
  if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER && currentMedium() === RECEIPT_MEDIA.COMPUTER) {
    const result = await openReceiptFile(receipt.id);
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "The receipt could not be opened." };
  }
  const read = await readReceipt(receipt);
  if (!read.ok) return read;
  const url = URL.createObjectURL(read.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true };
}

/**
 * Delete the file. Best effort, and never the thing that decides whether the
 * gift's record changes: a file left behind costs a little space, while a
 * record left pointing at a deleted file would say a receipt is in hand when
 * it is not. A receipt kept elsewhere is left alone.
 */
export async function deleteReceipt(receipt) {
  if (!receipt || receipt.storedIn !== currentMedium()) return { ok: false };
  try {
    if (receipt.storedIn === RECEIPT_MEDIA.ACCOUNT) {
      const { error } = await getSupabase().storage.from(BUCKET).remove([accountPath(receipt)]);
      return { ok: !error };
    }
    if (receipt.storedIn === RECEIPT_MEDIA.COMPUTER) return removeReceiptFile(receipt.id);
    await browserStore.remove(receipt.id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** How big a file is, the way the row says it. */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
