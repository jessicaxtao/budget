# End-to-end encryption

**Built.** This was the plan and it is now the design, kept because the *reasons* in it are
not recoverable from the code — and **"As built" at the foot records every place the plan
and the result disagree**, which is the part worth reading before changing any of this.

Four decisions were made in conversation rather than deduced from the code, and they are
the ones to preserve if the rest is revisited: the server copy alone is encrypted,
encryption is **always on** for every account rather than a toggle, the key is remembered
per device, and a printed recovery code is the second way in.

## Context

The server can read the books. `app_state.value` is jsonb holding the whole of a store —
every transaction, every account, every dollar — and RLS only decides *which* rows a
client may fetch. Anyone with the database has the ledger: the project owner, anyone who
compromises the project, anyone served a subpoena for it.

That is a promise gap rather than only a risk. The desktop build exists to say "your books
are on your own machine"; the moment a household turns on sync, that claim quietly becomes
"your books are on someone else's machine, in the clear". Actual Budget closes the same gap
the same way — the server stores ciphertext and holds no key — and that is what this does.

The outcome: **everything the app puts on the server is sealed with a key that never leaves
the device.** There are exactly two things it puts there, and both are in scope:

- **`app_state.value`** — one row per store, always an encrypted envelope, for every account.
- **the `receipts` bucket** — the charity's acknowledgment of a gift, as a PDF or a photo.

Nothing above `SyncContext` changes, which is the whole reason the seam is where it is.

### The second door is the one easy to forget

`app_state` is reached from exactly one file. Confirmed rather than assumed — a search for
`app_state` across `src/` and `electron/` finds only `src/contexts/SyncContext.js`, so
"one place encrypts" is achievable there as a property of the code.

**`src/receipts.js` is a second, independent door to the server**, and the earlier draft of
this plan did not mention it. `saveReceipt` uploads the raw file to Supabase Storage with
its real content type. A donation receipt carries the charity's name, the amount, the date
and usually the household's own name and address — precisely the content the rest of this
change exists to put out of the server's reach. Sealing fourteen-odd jsonb documents and
then uploading a legible PDF of a $5,000 gift beside them is not end-to-end encryption, it
is a change of subject.

So receipts are in scope, and they are *why* the key is held in module state rather than in
React context alone — see `src/booksKey.js` below. `receipts.js` is not a component and
cannot read a hook.

### What stays readable, and why that is the right line

Encryption covers the **server copy only**. `localStorage` and the desktop books file stay
plaintext, and that is close to forced: four store initialisers (`foldLegacyLedger`,
`readStoredLedger`, `legacyPlannedCentsById`, `storedGroupBuckets`) read storage
**synchronously** before the first paint, and `crypto.subtle` is async — no decrypt can run
underneath them. It also keeps the desktop promise that the books are a file a person can
open in a text editor, and it keeps `booksFile.js` exactly as it is.

**"Ask" is unaffected and needs no part of this.** The model is Ollama on
`127.0.0.1:11434`, reached from the main process, desktop-only — the books never go to a
server in the first place, which is the whole of `ASSISTANT.md`'s argument. No key, no
envelope, no change.

What the server can still see, stated plainly because the panel will say it out loud: the
account's email and sign-in times, which store keys exist, each document's **size** and
update time, and how many receipt files there are and how big each one is. Not one figure,
name, date or category inside any of them.

## The key material

**Envelope encryption**, and it is what makes the rest small:

- A random 256-bit **master key** (MK), generated once per account. Documents and receipt
  files are encrypted with MK and nothing else.
- MK is stored **wrapped**, twice: once under a KEK derived from the books password, once
  under a KEK derived from a printed recovery code. Both wraps live on the server; neither
  is useful without a secret the server never receives.

Everything good here falls out of that shape. **Changing the books password rewraps 32 bytes
and rewrites one row** — no re-encrypting every document and every receipt, so no
half-rotated state to design around and no need for a transactional RPC. **Recovery is a
second wrap, not a second design.** And a device already holding MK is unaffected when
another device changes the password, which is the honest behaviour: the password guards the
wrap, not the books.

**The books password is not the account password, and must not be.** The account password
reaches the server on every sign-in; a key derived from it would be a key the server can
derive too, which is not end-to-end anything. The set-up screen says this in one sentence,
and `AuthPage`'s reset flow gains one line saying a reset does not touch the books password.

Primitives, all from `crypto.subtle` — no new dependency, and nothing that needs
`wasm-unsafe-eval` in the shell's CSP:

- KEK: `PBKDF2`, SHA-256, **600,000 iterations**, a fresh 16-byte salt per wrap. The
  parameters are **stored in the row**, so they can be raised later without stranding
  existing accounts. Argon2id would be the better KDF and is not available: every
  JavaScript implementation is wasm, which the shell's CSP does not admit, and adding
  `wasm-unsafe-eval` to buy a stronger KDF would widen the renderer's execution surface to
  defend a key the renderer already holds in the clear.
- MK, every document and every receipt: `AES-GCM`, 256-bit, a fresh 12-byte IV per
  encryption.
- **Authentication is the password check.** A wrong password fails GCM's tag verification,
  so there is no separate verifier blob to store and no way for the two to disagree.
- The recovery code is ~160 bits of base32 in eight groups. It runs through the same
  `deriveKek` as the password — one derivation path, not two.

### What `kid` is for, since MK never rotates

`kid` names the key an envelope was sealed with, and on the design above it is written once
and never changes: a password change rewraps MK rather than replacing it. So it is **not
rotation support, and should not be mistaken for it** — `decryptDocument(mk, envelope)`
takes one key and could not service two.

It is kept because it is a **tripwire for a class of bug that is otherwise silent**: an
envelope whose `kid` is not this account's is refused outright rather than handed to GCM to
fail obscurely, which is what catches a row crossing accounts, a cached document surviving a
scope switch, or a restore from another household's exported file. Should MK rotation ever
be wanted, `kid` is the hook it would hang on; until then it earns its column as an
assertion.

## The schema — `supabase/schema.sql`

One new table beside `app_state`, and it is a second table rather than a reserved key
because the invariant is worth stating structurally: **`app_state.value` is always
ciphertext; `app_crypto` is always plaintext metadata.** A plaintext row inside `app_state`
would be one forgotten branch away from either leaking a document or encrypting the very
metadata needed to decrypt.

```
app_crypto (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kid uuid not null,               -- names the key a document was sealed with
  kdf jsonb not null,              -- { alg, hash, iterations }
  password_salt text not null,
  password_wrap text not null,     -- base64 iv‖ciphertext of MK
  recovery_salt text,
  recovery_wrap text,
  created_at timestamptz not null default now()
)
```

Same policy pair as `app_state` (`for all to authenticated using/with check user_id =
auth.uid()`), same `touch_updated_at` discipline if a column is added later. Not published
to realtime — a key change does not need pushing, and a device holding MK does not care.

**One CHECK constraint on `app_state`, added `not valid`:**

```sql
check (value ? 'kid' and value ? 'iv' and value ? 'ct')
```

`not valid` is what makes it deployable — existing plaintext rows are left alone and only
new writes are checked. It exists for one failure: a stale bundle (an old tab, an older
packaged desktop app) reading envelopes as documents, falling back to empty defaults, and
pushing those over the real books. Without the constraint that is silent server-side data
loss; with it the old client simply fails to save and says "Not saved". Wrapped in the
`do $$ ... pg_constraint ... $$` guard the file already uses for the realtime publication,
so re-running the schema stays safe.

**Two changes to the `receipts` bucket**, both in the existing `on conflict do update`, so
re-running the file applies them:

- `allowed_mime_types` gains `application/octet-stream`. A sealed receipt has no media type
  and must not claim one; the list is kept rather than nulled so an unsealed upload from an
  older build is still bounded.
- `file_size_limit` rises from `10485760` to **`10486784`**. The cap is enforced against the
  bytes uploaded, and a sealed receipt carries a **29-byte header** (a version byte, the
  16-byte `kid`, the 12-byte IV) plus AES-GCM's 16-byte tag — so without this a file of
  exactly `MAX_RECEIPT_BYTES` passes `checkReceiptFile` and is then refused by the bucket,
  45 bytes over. A kilobyte of headroom rather than 45 bytes, so the number does not have to
  move again if the envelope grows a field.

**While this file is open**, its header comment and the comment on `key` both say the app
has "fourteen" documents. `STORE_KEYS` holds twenty-six. Correct them to say *one row per
store* without a count, which is the claim that was actually meant and the only one that
stays true.

## The client

### `src/booksCrypto.js` — new, pure, no React, no module state

The `booksFile.js` of the wire: the one module that knows the shape of an envelope, so two
readers cannot disagree about one document. Exports, each returning `{ ok, … }` where
failure is expected (a wrong password is not an exception):

`newMasterKey()`, `deriveKek(secret, { salt, kdf })`, `wrapKey(kek, mk)` / `unwrapKey(kek,
wrapped)`, `encryptDocument(mk, kid, value)` → `{ v: 1, kid, iv, ct }`,
`decryptDocument(mk, envelope)`, `encryptBytes(mk, kid, bytes)` / `decryptBytes(mk,
envelope)` for receipts, `isEncryptedDocument(value)`, `newRecoveryCode()`,
`newKeyRecord(password)` (MK + both wraps + salts, the row as it is first written).

`isEncryptedDocument` tests `v === 1` and all three fields; no store document can collide
with that, and a test feeds it every shape in `STORE_KEYS` to keep it so.

Deliberately **free of globals** so it can be tested with no provider, no scope and no
staging — which is why the live key lives one module over.

### `src/booksKey.js` — new, three lines of module state

`setBooksKey(mk, kid)`, `getBooksKey()`, `clearBooksKey()`. Nothing else.

It exists for `storage.js`'s exact reason, and it is worth stating because a reviewer will
reasonably ask why the key is not simply in context: **two of its three readers cannot use a
hook.** `receipts.js` is a pure module called from event handlers, and `SyncContext`'s
`flush` is called from `beforeunload` and `visibilitychange` listeners outside React's
control, where a key captured in a closure could outlive the unlock it came from. One
access path for all three — the getter — rather than a hook for one and a global for the
others.

`BooksKeyContext` is the only writer. `clearBooksKey()` is called wherever `clearScope` is,
for the same reason and in the same breath: the key does not survive the session.

### `src/contexts/BooksKeyContext.js` — new

Holds the account's key record and the unwrapped MK. Inert whenever `SyncProvider` is —
unconfigured build, guest, local-only — so the test suite and the desktop's local mode never
see it. `status` is a four-state for the same reason `AUTH_STATUS` is a three-state:
`checking` / `setup` (no row for this account) / `locked` (row, no key on this device) /
`unlocked`.

Mutators return `{ ok, error }`: `setUp(password)`, `unlock(password)`,
`unlockWithRecoveryCode(code)`, `changePassword(next)`, `regenerateRecoveryCode()`.

**MK is cached in scoped storage** under a new `BOOKS_KEY_CACHE_KEY` in `src/storage.js` —
absent from `STORE_KEYS` and **added to `clearScope`'s list beside `PENDING_SYNC_KEY`**, for
that key's exact reason: it is not one of the books but it unlocks them, so it leaves with
the session. Caching raw key bytes next to a plaintext cache of the same books costs
nothing, which is the only reason it is acceptable.

It reads and writes that key through `readKey` / `writeKey` and **never through
`useSyncedState`** — which is what keeps `storage.test.js`'s source-reading test green
untouched. Confirmed rather than hoped: that test matches the literal pattern
`useSyncedState("…")` across `src/contexts/`, so a context that persists without it is
invisible to the assertion. The same fact is why the key cache can be scoped storage at all
without being pushed to the server.

**Two devices setting up at once**: insert `on conflict do nothing`, then re-select. If the
row that comes back is not ours, discard the MK we generated and fall to `locked`.

### `src/components/BooksKeyGate.js` — new

The fifth layer, between `AuthGate` and `SyncProvider`, because the question has to be
answered before there is anything to decrypt. The order in `src/index.js` becomes
`AuthProvider` → `AuthGate` → **`BooksKeyGate`** → `SyncProvider` → `ImportBooksGate`, and
the comment block there — which currently opens "Four layers outside the stores" and lists
four — grows a fifth entry and a new count.

Two faces:

- **Set up** — choose a books password, and the recovery code shown **once**, with a copy
  and a download and a "I have saved this" confirmation before the gate will pass. Explains
  in one sentence why this is a second password.
- **Unlock** — the password, with "use a recovery code instead" beside it. Wrong password
  says so; it cannot say anything else, since a failed unwrap is the only signal there is.

Minimum length for a books password is **12**, not `MIN_PASSWORD_LENGTH`'s 8, and the screen
says why: an account password is defended by the server's rate limiter, a books password is
defended by nothing but PBKDF2 against somebody who already has the ciphertext.

### `src/contexts/SyncContext.js` — the only file that touches document ciphertext

It exports **four** verbs today — `push`, `dropRemote`, `subscribeRemote`, `flush` — and the
three jobs in its header comment are hydrate, push and receive. The changes are small and
nothing above them moves:

- **Hydrate** — after the fetch, map each row through `decryptDocument` when
  `isEncryptedDocument(row.value)`, and **take a plaintext row as-is**. `known` and the
  cache keep holding **plaintext**, which is what keeps `canonicalJSON`, echo suppression
  and the redundant-write guard working exactly as they do now — and it is load-bearing in a
  way worth spelling out: a fresh IV per encryption means the same document seals to
  different bytes every time, so a `known` holding ciphertext would match nothing and
  re-push everything on every pass. A row that is an envelope and **will not decrypt** sets
  `hydrationError` and refuses the render — the stance already taken for a failed fetch, and
  for the same reason: falling through would show empty books and then push them up.
- **Push / flush** — `pending` and the outbox keep **plaintext**, and `flush` encrypts on the
  way out, reading MK through `getBooksKey()`. One place encrypts, which is what makes "the
  server never sees plaintext" a property of the code rather than a claim about it. A queued
  write therefore survives a reload and is sealed when it finally goes. `flush` with no key
  available must **not** send: treat it as a failed push — `SYNC_STATE.OFFLINE`, keep the
  queue, retry — because the queue is already durable and the alternative is sending
  plaintext.
- **`dropRemote` needs no change.** It sends keys, never values, and a delete has nothing to
  seal. Worth stating so that reading the diff does not raise the question.
- **Receive** — decrypt before notifying listeners; a row that will not decrypt is ignored,
  keeping what we have rather than blanking a store, which is `useSyncedState`'s existing
  stance for a document it cannot read. The DELETE branch is untouched: its value is
  `undefined` and there is nothing to decrypt.

**One new verb, `resync()`**: clear `known` and queue every cached document. Used by the
migration below, and it is the honest primitive for "the server's copy needs rewriting for a
reason that has nothing to do with its contents".

**Import and restore are covered for free, and that is the test of the seam's placement.**
`ImportBooksGate` carries a browser's pre-account books up with `push` then `flush`, and
`BooksFilePanel`'s restore does the same plus `dropRemote` for keys the file does not name.
Neither touches `app_state` directly, so neither changes, and neither can leak a document
by being forgotten.

### `src/receipts.js` — the second door, sealed

Three of its verbs change and the shape of the module does not:

- **`saveReceipt`** — in the `ACCOUNT` medium only, encrypt the file's bytes under MK and
  upload the envelope with `contentType: "application/octet-stream"`. The record gains
  `sealed: true`. The `COMPUTER` and `BROWSER` media are untouched: those bytes are already
  on the household's own machine, and sealing them would buy nothing while breaking
  `openReceiptFile`, which hands the file to whatever the household opens a PDF with.
- **`readReceipt`** — decrypt after download when `receipt.sealed`, and **take an unsealed
  file as-is**. The same rule as a plaintext row on hydrate, deliberately: one stance for
  "the server's copy predates encryption", applied in both doors.
- **`accountPath` is unchanged.** It stays `<uid>/<id>.<ext>` with the real extension, which
  is a small lie about sealed bytes and the right trade: changing it would strand every
  receipt already uploaded, to hide a media type the server can infer from the record's own
  size anyway. The path's first segment is the user id and the second is a UUID — no
  filename reaches the server either way.

`isReceipt` is unchanged and still passes: it checks required fields and an extra optional
one does not disturb it, so the donations store's migration keeps working on old and new
records alike.

**Existing receipts are not re-sealed.** Stated under consequences rather than designed
around — a pass that downloaded, encrypted and re-uploaded every file is possible later and
is not worth building now.

### Existing accounts migrate themselves

There is no separate migration step and no script. An account with plaintext rows hits the
set-up gate (no `app_crypto` row), gets a password, and then hydrate reads its plaintext
documents as-is, notices at least one was plaintext, and calls `resync()`. The existing
flush machinery — the debounce, the outbox, the retry — carries it, so a migration
interrupted by a closed laptop finishes on the next load. The CHECK constraint is
`not valid` precisely so those old rows are allowed to sit there until that happens.

### `src/components/BooksEncryptionPanel.js` — new, on Configuration

Beside `BooksFilePanel` and closed the same way. No on/off switch — encryption is always on —
so it holds: what the server can and cannot see, when the key was set up, **change the books
password**, and **regenerate the recovery code**. Both need `unlocked`.

One sentence is added to `BooksFilePanel`'s copy: the exported file is **plain text**. It
has to say so, because it is also the one way back from a forgotten password plus a lost
recovery code, and a user who assumed it was sealed would store it carelessly.

## Known consequences, stated rather than designed away

- **Lose the password and the recovery code and the server copy is gone.** No reset exists
  or can exist. The local cache and any export are the only way back — which is the true
  cost of the thing being asked for.
- **A fresh device needs the books password**, not just the account password. That is the
  feature.
- **Sign-up now asks for two passwords.** Friction that "always on" buys structural
  simplicity with: there is no unencrypted account, so there is no mixed state, no toggle,
  and no code path where a document could go up in the clear.
- **An older build cannot read or write an encrypted account.** It will show "Not saved"
  rather than corrupting anything, thanks to the CHECK. Worth knowing before rolling a
  packaged desktop build back. Note the asymmetry: there is no equivalent guard on the
  `receipts` bucket, so an older build can still upload an unsealed file — which the current
  build will then read correctly, because `sealed` is per-record.
- **Receipts uploaded before this change stay readable to the server** until re-attached.
  The panel says so by name rather than implying every file is sealed.
- **Document sizes, file sizes and update times still leak.** Padding is possible and is not
  worth its complexity here; the panel says so rather than implying otherwise.

## Tests

- **`src/setupTests.js`** — jsdom 16.7 (confirmed: `jsdom@16.7.0`, bundled with
  react-scripts 5) ships **no** `crypto` at all, so nothing crypto-related runs without a
  polyfill. Add a guarded one (`require("node:crypto").webcrypto`), in the same shape as the
  existing `<dialog>` polyfill so a future jsdom wins instead.
- **`src/booksCrypto.test.js`** — round trip; wrong password fails closed; a **tampered**
  ciphertext fails rather than returning garbage (that is what GCM is for); the recovery code
  unwraps the same MK; rewrapping under a new password leaves every document readable;
  `encryptBytes` / `decryptBytes` round-trip a binary blob unchanged; and
  `isEncryptedDocument` says no to every real store document.
- **`src/contexts/BooksKeyContext.test.js`** — mocks `../supabaseClient` as
  `AuthContext.test.js` does (remember `resetMocks: true` — stage implementations in
  `beforeEach`, and settle the effect's promise with `await act(async () => {})`). Covers
  set-up, unlock, wrong password, recovery, the cached key surviving a remount, the
  concurrent-set-up race falling to `locked`, and `clearBooksKey` on sign-out.
- **`src/contexts/SyncContext.test.js`** — new, and the one that matters: **what reaches the
  wire is an envelope and never a document**; two flushes of the same document produce
  *different* ciphertext and still cost one write each, not a loop; a plaintext row on the
  way in is accepted and re-pushed sealed; an envelope that will not decrypt refuses the
  render instead of blanking a store; a realtime envelope lands decrypted in the store; and
  a flush with no key queues rather than sending.
- **`src/receipts.test.js`** — extended: an account-medium upload sends bytes that are not
  the file's; a sealed receipt round-trips; an **unsealed** receipt still downloads and opens;
  and the `COMPUTER` / `BROWSER` media are byte-for-byte unchanged.
- **`src/storage.test.js`** — the cached key leaves with `clearScope` and is not in
  `STORE_KEYS`. Its source-reading test is unaffected: `BooksKeyContext` does not call
  `useSyncedState`.
- **Every existing suite must stay green untouched.** There is no `AuthProvider` above the
  store suites, so `remote` is false, so none of this runs — and the envelope, report and
  retirement tripwires are the proof that the seam was placed correctly.

## Documentation

**`ACCOUNTS.md` is where almost all of this lands, not `CLAUDE.md`** — corrected here after
the fact, because this section originally named the wrong file and sent the work to a heading
that does not exist. The claims that go false are all in `ACCOUNTS.md`: "the whole value as a
document", the `SyncProvider` bullet (a fourth job and the verbs' new shape), the four-layers
list, its "three store initialisers" where `storage.js` says four, and `storage.js`'s key
inventory. The **key design section** belongs there too and only there — why envelope
encryption, why two passwords, why the local cache stays plaintext, why receipts are in
scope — since stating it in both files is the duplication this project's own rule warns
about.

`CLAUDE.md` takes only what is true of *it*: that `BooksKeyProvider` does **not** join the
sixteen-provider count (it wraps `AppProviders` from outside, in `index.js`), a pointer to
`ACCOUNTS.md` for the key design, and the testing section's list of environment gotchas and
suites. `src/index.js`'s own four-layers comment becomes five. `STORES.md` gains the
receipt record's `sealed` field. `TESTING.md` gains the two polyfills, the new suites, and
the one-tick `remote` trap. `ASSISTANT.md` needs nothing — "Ask" is Ollama on loopback and
never had a server in it.

Two pre-existing drifts to fix in passing, both counts that were true once: "fourteen
documents" in `schema.sql`, `storage.js`'s `writeKey` comment and `SyncContext`'s `known`
comment (it is twenty-six stores); and "three store initialisers" in `SyncContext` and
`ACCOUNTS.md` against `storage.js`'s four (`storedGroupBuckets` is the fourth).

## As built — where this plan and the result disagree

Everything above describes what was built. These are the deviations and the things the plan
did not know, each of which cost something to find:

**Two primitives the plan needed and did not name.** `exportMasterKey` / `importMasterKey`
in `booksCrypto.js`: the plan says MK is cached in scoped storage, but a `CryptoKey` cannot
be serialised and the only export the plan gave was `wrapKey`, which needs a KEK that does
not exist at cache time. They are **the one place MK is written down unprotected**, and the
justification is in their doc comment rather than here. Also `normalizeRecoveryCode`, because
people retype what they wrote down and do not retype it exactly, and `envelopeKid`, so the
`kid` check belongs to the caller rather than being buried in a decrypt.

**`src/booksKey.js` holds the live key, and `GateShell.js` is new.** The first is in the
plan. The second is not: `AuthPage` kept its frame, its `Message` and its `Switcher`
private, and `BooksKeyGate` is the app's *second* full-screen gate with the wordmark and an
`<h1>`. Two copies of that frame is the drift this project's docs warn about, so it was
extracted rather than duplicated.

**`offerFile` took a media type.** The recovery code's download goes through
`booksFile.js`'s existing door instead of an `<a download>` of its own, because the packaged
app is served over `app://` where a browser download is the weaker path and a save dialog is
the one a household can act on. It is the first file the app offers that is not the books,
which is why the type became a parameter.

**The books-key cache has to set its own storage scope, and this was a real bug.**
`BooksKeyProvider` sits *above* `SyncProvider`, and `SyncProvider` is the only thing in the
app that calls `setStorageScope` — so at the moment the provider first touched storage the
scope was still `null` and the key landed under the **unscoped** `booksKey`. `clearScope`
only clears scoped keys, deliberately, so the master key **survived sign-out** and sat in
`localStorage` for the next person to open the browser: exactly the leak namespacing exists
to prevent, carrying the one value that unlocks everything else. Fixed by bracketing the
scope around the cache access the way `isGuestMode` does, and pinned by a test that asserts
the unscoped slot is *empty* as well as that the scoped one is full.

**Sealing made the realtime handler async, which opened a window its guards did not cover.**
That handler checks two things — that the session has not moved the cache to another scope,
and that no local edit is queued for this key — and when it was synchronous, checking once
*was* checking at the moment of the write. A decrypt is an `await`. Both guards are now
asked again after it, because both of the things they protect against can really land in
that window: a sign-out writing a row back under an account whose books have just been
cleared, and the server's older copy overwriting an edit the user can already see. Two tests
cover it, and both were confirmed to fail without the re-check — the first silently did not,
because setting the scope in the test tripped the *pre*-await guard so the decrypt never ran.

**jsdom 16 ships no `TextEncoder`/`TextDecoder` either**, not just no `crypto`. Every
document seal goes through them, so `setupTests.js` carries two guarded polyfills rather
than one.

**`resync` iterates `STORE_KEYS` and must not iterate `LEGACY_KEYS`.** Checked rather than
assumed: both writers (`ImportBooksGate`, `BooksFilePanel`) already filter to `STORE_KEYS`,
so the server never holds a legacy row — and widening `resync` would newly *upload* the
legacy ledger that the import deliberately keeps local.

**The panel shows the set-up date through one new field, and the context exposes nothing
else off the row.** `createdAt` is the only thing that leaves `BooksKeyContext`; the salts
and wraps stay in it — not because they are secret (the server holds them) but because a
second place that could try unwrapping is a second place to get it wrong. It is a
`timestamptz`, so the panel parses the instant rather than slicing ten characters off it:
`formatDateMedium` takes a local `"YYYY-MM-DD"`, and feeding it a sliced UTC day is the
`toISOString` trap `CLAUDE.md` warns about, reading a day early for anyone west of
Greenwich in the evening.

**Both context objects are exported so their suites can keep "nothing mocks a hook".**
`SyncContext` already was, for that reason. `BooksKeyContext` now is too — a panel reading
its context through a jest mock passes while the provider's real shape drifts out from under
it, which is the failure that rule exists to prevent.

**`npm test` cannot discover a single test file in a worktree under `.claude/worktrees/`.**
CRA builds `testMatch` from `rootDir` and leaves a Windows backslash at the `.claude`
segment, where a glob reads `\.` as an escape, so the pattern cannot match the path it was
built from; CRA pins `roots` and refuses to let it be overridden. Nothing to do with this
change — it bites every test run in such a worktree, pre-existing suites included. Run
`npx react-scripts test --watchAll=false --testMatch '**/*.test.js'` instead.

## Verification

1. `npm test -- --watchAll=false` — the whole suite, including the untouched tripwires.
2. `CI=true npm run build` — must compile with no lint warnings.
3. Against a real project, with the schema re-run:
   - Sign up. Set a books password, save the recovery code. Enter a few transactions, and
     log a gift with a **receipt PDF** attached.
   - **In the Supabase table editor, read `app_state`.** Every `value` is `{v, kid, iv, ct}`
     and no figure, name or date is legible anywhere in the table. This is the test the
     whole change exists to pass.
   - **Download that receipt out of the Storage browser** and open it. It must be bytes, not
     a PDF. Then open it from inside the app, where it must render.
   - Sign in on a second browser. It asks for the books password; the books arrive intact;
     an edit on one appears on the other through realtime; the receipt opens there too.
   - Change the books password on one device. The other keeps working without a prompt; a
     third, fresh sign-in needs the new one.
   - Unlock a fresh browser with the **recovery code** instead of the password.
   - Sign out and confirm the cached key is gone from `localStorage` along with the books.
   - Go offline, edit, reload, come back online — the queued write lands sealed.
   - On an account that already has plaintext rows: sign in, set a password, and watch every
     row turn into an envelope without being asked to do anything. A receipt uploaded before
     the change must still open.
4. Desktop shell: `npm run desktop`, sign in, confirm the same, and confirm the books file
   on disk is still plain JSON, a locally-stored receipt is still a plain PDF in the app
   folder, and the egress allow-list is unchanged.
