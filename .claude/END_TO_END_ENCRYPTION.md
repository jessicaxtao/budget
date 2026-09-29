# End-to-end encryption

Not started — an agreed plan, written down so it does not have to be re-derived. Four
decisions in it were made in conversation rather than deduced from the code, and they are
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

The outcome: **`app_state.value` is always an encrypted envelope, for every account, and
the key never leaves the device.** Nothing above `SyncContext` changes, which is the whole
reason the seam is where it is.

### What stays readable, and why that is the right line

Encryption covers the **server copy only**. `localStorage` and the desktop books file stay
plaintext, and that is close to forced: four store initialisers (`foldLegacyLedger`,
`readStoredLedger`, `legacyPlannedCentsById`, `storedGroupBuckets`) read storage
**synchronously** before the first paint, and `crypto.subtle` is async — no decrypt can run
underneath them. It also keeps the desktop promise that the books are a file a person can
open in a text editor, and it keeps `booksFile.js` exactly as it is.

What the server can still see, stated plainly because the panel will say it out loud: the
account's email and sign-in times, which of the fourteen documents exist, each document's
**size** and update time. Not one figure, name, date or category inside them.

## The key material

**Envelope encryption**, and it is what makes the rest small:

- A random 256-bit **master key** (MK), generated once per account. Documents are encrypted
  with MK and nothing else.
- MK is stored **wrapped**, twice: once under a KEK derived from the books password, once
  under a KEK derived from a printed recovery code. Both wraps live on the server; neither
  is useful without a secret the server never receives.

Everything good here falls out of that shape. **Changing the books password rewraps 32 bytes
and rewrites one row** — no re-encrypting fourteen documents, so no half-rotated state to
design around and no need for a transactional RPC. **Recovery is a second wrap, not a second
design.** And a device already holding MK is unaffected when another device changes the
password, which is the honest behaviour: the password guards the wrap, not the books.

**The books password is not the account password, and must not be.** The account password
reaches the server on every sign-in; a key derived from it would be a key the server can
derive too, which is not end-to-end anything. The set-up screen says this in one sentence,
and `AuthPage`'s reset flow gains one line saying a reset does not touch the books password.

Primitives, all from `crypto.subtle` — no new dependency, and nothing that needs
`wasm-unsafe-eval` in the shell's CSP:

- KEK: `PBKDF2`, SHA-256, **600,000 iterations**, a fresh 16-byte salt per wrap. The
  parameters are **stored in the row**, so they can be raised later without stranding
  existing accounts.
- MK and every document: `AES-GCM`, 256-bit, a fresh 12-byte IV per encryption.
- **Authentication is the password check.** A wrong password fails GCM's tag verification,
  so there is no separate verifier blob to store and no way for the two to disagree.
- The recovery code is ~160 bits of base32 in eight groups. It runs through the same
  `deriveKek` as the password — one derivation path, not two.

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

## The client

### `src/booksCrypto.js` — new, pure, no React

The `booksFile.js` of the wire: the one module that knows the shape of an envelope, so two
readers cannot disagree about one document. Exports, each returning `{ ok, … }` where
failure is expected (a wrong password is not an exception):

`newMasterKey()`, `deriveKek(secret, { salt, kdf })`, `wrapKey(kek, mk)` / `unwrapKey(kek,
wrapped)`, `encryptDocument(mk, kid, value)` → `{ v: 1, kid, iv, ct }`,
`decryptDocument(mk, envelope)`, `isEncryptedDocument(value)`, `newRecoveryCode()`,
`newKeyRecord(password)` (MK + both wraps + salts, the row as it is first written).

`isEncryptedDocument` tests `v === 1` and all three fields; no store document can collide
with that, and a test feeds it every shape in `STORE_KEYS` to keep it so.

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

**Two devices setting up at once**: insert `on conflict do nothing`, then re-select. If the
row that comes back is not ours, discard the MK we generated and fall to `locked`.

### `src/components/BooksKeyGate.js` — new

The fifth layer, between `AuthGate` and `SyncProvider`, because the question has to be
answered before there is anything to decrypt. Two faces:

- **Set up** — choose a books password, and the recovery code shown **once**, with a copy
  and a download and a "I have saved this" confirmation before the gate will pass. Explains
  in one sentence why this is a second password.
- **Unlock** — the password, with "use a recovery code instead" beside it. Wrong password
  says so; it cannot say anything else, since a failed unwrap is the only signal there is.

Minimum length for a books password is **12**, not `MIN_PASSWORD_LENGTH`'s 8, and the screen
says why: an account password is defended by the server's rate limiter, a books password is
defended by nothing but PBKDF2 against somebody who already has the ciphertext.

`src/index.js` gains the layer and its comment block grows a fifth entry.

### `src/contexts/SyncContext.js` — the only file in the app that touches ciphertext

Three verbs, three small changes, and nothing above them moves:

- **Hydrate** — after the fetch, map each row through `decryptDocument` when
  `isEncryptedDocument(row.value)`, and **take a plaintext row as-is**. `known` and the
  cache keep holding **plaintext**, so echo suppression and the redundant-write guard work
  exactly as they do now. A row that is an envelope and **will not decrypt** sets
  `hydrationError` and refuses the render — the stance already taken for a failed fetch, and
  for the same reason: falling through would show empty books and then push them up.
- **Push / flush** — `pending` and the outbox keep **plaintext**, and `flush` encrypts on the
  way out. One place encrypts, which is what makes "the server never sees plaintext" a
  property of the code rather than a claim about it. A queued write therefore survives a
  reload and is sealed when it finally goes.
- **Receive** — decrypt before notifying listeners; a row that will not decrypt is ignored,
  keeping what we have rather than blanking a store, which is `useSyncedState`'s existing
  stance for a document it cannot read.

**One new verb, `resync()`**: clear `known` and queue every cached document. Used by the
migration below, and it is the honest primitive for "the server's copy needs rewriting for a
reason that has nothing to do with its contents".

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
  packaged desktop build back.
- **Document sizes and update times still leak.** Padding is possible and is not worth its
  complexity here; the panel says so rather than implying otherwise.

## Tests

- **`src/setupTests.js`** — jsdom 16.7 ships **no** `crypto` at all, so nothing crypto-related
  runs without a polyfill. Add a guarded one (`require("node:crypto").webcrypto`), in the
  same shape as the existing `<dialog>` polyfill so a future jsdom wins instead.
- **`src/booksCrypto.test.js`** — round trip; wrong password fails closed; a **tampered**
  ciphertext fails rather than returning garbage (that is what GCM is for); the recovery code
  unwraps the same MK; rewrapping under a new password leaves every document readable; and
  `isEncryptedDocument` says no to every real store document.
- **`src/contexts/BooksKeyContext.test.js`** — mocks `../supabaseClient` as
  `AuthContext.test.js` does (remember `resetMocks: true` — stage implementations in
  `beforeEach`, and settle the effect's promise with `await act(async () => {})`). Covers
  set-up, unlock, wrong password, recovery, the cached key surviving a remount, and the
  concurrent-set-up race falling to `locked`.
- **`src/contexts/SyncContext.test.js`** — new, and the one that matters: **what reaches the
  wire is an envelope and never a document**; a plaintext row on the way in is accepted and
  re-pushed sealed; an envelope that will not decrypt refuses the render instead of blanking
  a store; a realtime envelope lands decrypted in the store.
- **`src/storage.test.js`** — the cached key leaves with `clearScope` and is not in
  `STORE_KEYS`. Its source-reading test is unaffected: `BooksKeyContext` does not call
  `useSyncedState`.
- **Every existing suite must stay green untouched.** There is no `AuthProvider` above the
  store suites, so `remote` is false, so none of this runs — and the envelope, report and
  retirement tripwires are the proof that the seam was placed correctly.

## Documentation

`.claude/CLAUDE.md` is hand-maintained doctrine and several claims become false: the
accounts section ("the whole value as a document"), the `SyncProvider` bullet (a fourth job,
and the three verbs' new shape), the four-layers list in both that file and `src/index.js`,
`storage.js`'s key inventory, and the testing section (the WebCrypto polyfill, the new
suites). Add a short section of its own for the key design — why envelope encryption, why
two passwords, why the local cache stays plaintext.

## Verification

1. `npm test -- --watchAll=false` — the whole suite, including the untouched tripwires.
2. `CI=true npm run build` — must compile with no lint warnings.
3. Against a real project, with the schema re-run:
   - Sign up. Set a books password, save the recovery code. Enter a few transactions.
   - **In the Supabase table editor, read `app_state`.** Every `value` is `{v, kid, iv, ct}`
     and no figure, name or date is legible anywhere in the table. This is the test the
     whole change exists to pass.
   - Sign in on a second browser. It asks for the books password; the books arrive intact;
     an edit on one appears on the other through realtime.
   - Change the books password on one device. The other keeps working without a prompt; a
     third, fresh sign-in needs the new one.
   - Unlock a fresh browser with the **recovery code** instead of the password.
   - Sign out and confirm the cached key is gone from `localStorage` along with the books.
   - Go offline, edit, reload, come back online — the queued write lands sealed.
   - On an account that already has plaintext rows: sign in, set a password, and watch every
     row turn into an envelope without being asked to do anything.
4. Desktop shell: `npm run desktop`, sign in, confirm the same, and confirm the books file
   on disk is still plain JSON and the egress allow-list is unchanged.
