/**
 * The unlocked books key, held for exactly as long as this device has it
 * unlocked — and nothing else.
 *
 * Module state, for `storage.js`'s `scope` reason and no other: **two of
 * this module's three readers cannot call a hook.** `src/receipts.js` is a
 * pure module invoked from a file-input's event handler, nowhere near a
 * component tree, and `SyncContext`'s `flush` is called from `beforeunload`
 * and `visibilitychange` listeners firing outside React's render cycle
 * entirely. A key captured in either of those as a closure could go on
 * answering after the unlock that produced it has ended — through a
 * sign-out, a lock, a scope switch — which a getter read fresh on every
 * call cannot do. One access path, the getter below, serves all three
 * callers instead of a hook for one of them and a global for the other two.
 *
 * `BooksKeyContext` is the only writer: `setBooksKey` once an unlock or a
 * set-up succeeds, `clearBooksKey` everywhere `clearScope` is called, for
 * `clearScope`'s own reason — the key does not outlive the session it was
 * unlocked for.
 */

let current = null;
let generation = 0;

// Captured by asynchronous work; logout invalidates it synchronously, before
// React unmounts providers or a network sign-out finishes.
export function booksKeyGeneration() {
  return generation;
}

/** Put an unlocked master key — and the `kid` it was sealed under — in
 *  force for the rest of this session.
 *
 *  `householdId` is the household whose books this key opens, carried here
 *  for the one reader that needs it and cannot reach a hook: `receipts.js`
 *  names each receipt's storage folder by the household id, and the row-level
 *  policy on the bucket checks that folder against membership. It is optional
 *  so the single-household and pre-household callers (and the key tests) can
 *  keep passing two arguments. */
export function setBooksKey(mk, kid, householdId = null) {
  current = { mk, kid, householdId };
}

/** The unlocked key, or `null` if nothing has unlocked it yet this
 *  session. Every reader — `SyncContext`, `receipts.js`, anything else —
 *  reads through here rather than holding its own reference, so a lock
 *  takes effect for all of them at once. */
export function getBooksKey() {
  return current;
}

/** Lock back up. Called wherever `clearScope` is. */
export function clearBooksKey() {
  current = null;
  generation += 1;
}
