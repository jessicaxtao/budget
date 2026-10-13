-- Canopy Budget — Supabase schema.
--
-- Run this once, whole, in the SQL editor of a new project. It is idempotent:
-- every statement guards itself, so re-running after a change is safe.
--
-- ONE TABLE, because the app has one shape of data: one row per store, each
-- the whole value of that store. Every derivation in this app (envelopes,
-- net worth, the retirement projection, the spending report) loads
-- a whole array and computes over it in JavaScript, so there is nothing for a
-- relational split to buy — and a great deal for it to cost, since every
-- mutator here returns `{ ok, error }` synchronously and ~40 call sites plus
-- the invariant tripwires depend on that.
--
-- The security story is correspondingly small: one table, one policy pair, one
-- predicate to get right. `user_id = auth.uid()` is the whole of it.
--
-- ONE THING THIS FILE CANNOT STATE, and it is load-bearing for the desktop
-- build: the project's **Magic Link** email template has to carry `{{ .Token }}`
-- as well as `{{ .ConfirmationURL }}`. It is an Auth dashboard setting, not SQL,
-- so running this script is necessary and not sufficient.
--
-- And that setting has a prerequisite of its own, which is the part that
-- surprises: **Supabase will not let a template be edited at all until custom
-- SMTP is configured.** On the built-in sender the templates are fixed, and the
-- stock Magic Link template carries only the link. So the desktop sign-in
-- cannot work on the default mail setup — not because of a plan tier, but
-- because the one line it needs is in a template that cannot be touched. Any
-- SMTP provider does: Gmail with an app password needs no domain and is more
-- than enough for one household.
--
-- The reason is that signing in by email is one call with two shapes of answer
-- (`requestSignInEmail` in `src/contexts/AuthContext.js`). A browser follows the
-- link. The shell is served over `app://`, which no mail client and no OS
-- browser can open, so it asks for no redirect and reads the six-digit token out
-- of that same email instead — and Supabase renders both halves from this one
-- template. Leave the token out and the web app is unaffected while the desktop
-- app's sign-in silently has nothing to type: the email arrives, it just does
-- not contain the only part of itself the shell can use.
--
-- Two dashboard settings beside it, for the same flow:
--   * Site URL must point at the web deploy. An un-allow-listed redirect does
--     not fail the request, it falls back to this — so where the project is
--     shared with another app, a wrong value here sends households into it.
--   * Email OTP length is what `MAGIC_CODE_LENGTH` states in the copy. The
--     client's own check accepts six to ten digits so that raising it here does
--     not turn the form into one that refuses every real code.

create table if not exists public.app_state (
  -- On delete cascade: closing an account takes its books with it. There is no
  -- other copy on the server, which is what the export on the account panel is
  -- for.
  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- The store's own key — "budgets", "transactions", "accountBalances". Bounded
  -- rather than enumerated: a CHECK listing every key the app ships today would
  -- mean a schema migration every time a store is added, and the client is the
  -- thing that knows what a key means.
  key        text        not null check (char_length(key) between 1 and 64),

  -- The whole value of that store, exactly as it sat in localStorage. Migrations
  -- still run client-side on the way in, so a document written by an older
  -- build is upgraded by a newer one on read, the same as it always was.
  value      jsonb       not null,

  -- Maintained by the trigger below, never by the client. It is what lets a
  -- second device tell a stale push from a fresh one.
  updated_at timestamptz not null default now(),

  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- The anon key ships inside the JavaScript bundle — it is public by design, and
-- anyone who opens devtools on the deployed app has it. RLS is therefore not a
-- second line of defence here, it is the only one.

alter table public.app_state enable row level security;

-- Granted to `authenticated` only, so an unauthenticated caller holding the
-- anon key matches no policy and reads nothing. USING governs the rows a
-- statement may see; WITH CHECK governs the rows it may leave behind — both are
-- needed, or a user could UPDATE their own row into someone else's user_id.
drop policy if exists "app_state owner access" on public.app_state;
create policy "app_state owner access"
  on public.app_state
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- Set server-side rather than trusted from the client: a device with a wrong
-- clock would otherwise be able to write a timestamp far in the future and
-- permanently win every conflict comparison against every other device.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_state_touch_updated_at on public.app_state;
create trigger app_state_touch_updated_at
  before insert or update on public.app_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Encryption key material
-- ---------------------------------------------------------------------------
-- The central invariant this whole file now has to keep true:
-- **`app_state.value` is always ciphertext; `app_crypto` is always plaintext
-- metadata.** It is a second table rather than a reserved key inside
-- `app_state` precisely so that invariant is structural rather than
-- remembered — a plaintext row sitting inside `app_state` would be one
-- forgotten branch away from either leaking a document (a reader that
-- forgets to check before decrypting) or encrypting the very metadata needed
-- to decrypt (a writer that seals indiscriminately). Two tables means the
-- column list alone tells you which rule applies.
--
-- One row per account, holding everything needed to get at the master key
-- (MK) except the two secrets that unlock it — the books password and the
-- recovery code never reach the server, so this row alone is useless without
-- one of them.

create table if not exists public.app_crypto (
  -- On delete cascade for the same reason as app_state: closing an account
  -- takes its key material with it, and there is no other copy on the server.
  user_id        uuid        primary key references auth.users (id) on delete cascade,

  -- Names the key every envelope in app_state claims to be sealed with. MK
  -- never rotates on this design — a password change rewraps it rather than
  -- replacing it — so this column does not change either; it exists so a
  -- client can refuse an envelope that names the wrong account's key outright
  -- rather than handing it to AES-GCM to fail obscurely.
  kid            uuid        not null,

  -- { alg, hash, iterations } for the PBKDF2 derivation, stored rather than
  -- hard-coded so the iteration count can be raised later without stranding
  -- accounts set up under the old one.
  kdf            jsonb       not null,

  -- Salt and wrap for the KEK derived from the books password. password_wrap
  -- is base64 of iv‖ciphertext for MK — 32 bytes of key material, so rewrapping
  -- it on a password change is one small write, never a re-encryption of every
  -- document or receipt.
  password_salt  text        not null,
  password_wrap  text        not null,

  -- Salt and wrap for the KEK derived from the printed recovery code, through
  -- the same derivation as the password. Nullable because a household can
  -- decline a recovery code at set-up or regenerate it later — a gap between
  -- regenerating and confirming the new one is saved should not leave the row
  -- unwritable. Like password_wrap, this wrap is useless on its own: without
  -- the code itself, which the server never receives, it unwraps nothing.
  recovery_salt  text,
  recovery_wrap  text,

  created_at     timestamptz not null default now()
);

alter table public.app_crypto enable row level security;

drop policy if exists "app_crypto owner access" on public.app_crypto;
create policy "app_crypto owner access"
  on public.app_crypto
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately **not** added to the realtime publication, unlike app_state
-- below. A key change does not need pushing: a device that already holds MK
-- in memory is unaffected when another device rewraps it under a new
-- password, and the next time this device needs to unwrap anything, it reads
-- this row fresh rather than waiting on a subscription to tell it to.

-- ---------------------------------------------------------------------------
-- Encrypted envelopes only
-- ---------------------------------------------------------------------------
-- This exists for one failure: a stale bundle — an old browser tab left open,
-- an older packaged desktop build that has not been updated — reads an
-- encrypted envelope as if it were a plaintext document, finds none of the
-- fields it expects, falls back to empty defaults, and pushes those empty
-- books up over the real ones. Without this constraint that is silent,
-- server-side data loss. With it, the old client's write is simply refused
-- and the header says "Not saved" — loud and recoverable instead of quiet and
-- not.
--
-- `not valid` is what makes this deployable against a live account: existing
-- plaintext rows are left exactly as they are and only new writes are
-- checked, so an account mid-migration (see the client plan) is never locked
-- out of saving its own old documents. Wrapped in the same
-- `do $$ ... pg_constraint ... $$` guard the Realtime block below uses for
-- `pg_publication_tables`, so re-running this file after the constraint
-- already exists is a no-op rather than an error.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_state_value_is_envelope'
      and conrelid = 'public.app_state'::regclass
  ) then
    alter table public.app_state
      add constraint app_state_value_is_envelope
      check (value ? 'kid' and value ? 'iv' and value ? 'ct')
      not valid;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- What replaces the `storage` event that kept two browser tabs in step. Without
-- it, two devices hold independent copies and — because every write replaces a
-- whole document — the last to save silently destroys what the other logged.
--
-- Realtime respects RLS, so a subscriber is only ever sent their own rows.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end
$$;

-- Realtime sends only the replica-identity columns for the *old* tuple, which by
-- default is the primary key alone. `SyncContext`'s subscription reads
-- `payload.old` on a DELETE, and Supabase evaluates RLS against the old row for
-- UPDATE and DELETE, so the table has to replicate the whole thing.
--
-- `FULL` and not the bare statement: `ALTER TABLE ... REPLICA IDENTITY` takes a
-- mode (DEFAULT / FULL / NOTHING / USING INDEX) and is a syntax error without
-- one — which, in the SQL editor, rejects the *whole* script before any of it
-- runs, so this line failing means nothing above it was applied either.
alter table public.app_state replica identity full;

-- ---------------------------------------------------------------------------
-- Receipt files
-- ---------------------------------------------------------------------------
-- The charity's written acknowledgment of a gift, as a PDF or a photo. A file
-- is not a document, so it does not go in app_state: every store there is
-- pushed whole on every write, and a few scans as base64 would make every edit
-- to a gift re-send megabytes. The donation record carries a description of
-- the file (see `src/receipts.js`); the bytes live here.
--
-- PRIVATE, so nothing is served by URL; the app downloads through the API with
-- the user's own session. Each account's files sit under a folder named by its
-- user id — `<uid>/<receipt id>.<ext>` — and that first path segment is the
-- whole of the policy, the same predicate as app_state's one step over.
--
-- The size cap and the types are also stated in `src/receipts.js` and
-- `electron/receipts.js`; change one, change all three.
--
-- Closing an account does not reach in here: Storage keeps objects apart from
-- auth.users, so a deleted user's receipts stay until removed by hand.
--
-- `application/octet-stream` is added to the type list rather than replacing
-- it: a sealed receipt is ciphertext with no media type of its own and must
-- not claim one, but an unsealed upload from an older build — one that
-- predates encryption, or one still running beside this schema during a
-- rollout — still needs its real content type bounded.
--
-- The size cap rises by 1024 bytes: `10485760` (`MAX_RECEIPT_BYTES`, 10 MB) is
-- the limit `checkReceiptFile` enforces client-side before anything is sent,
-- but the bucket enforces against the bytes actually uploaded, and sealing
-- adds a 29-byte header (a version byte, the key id, and the IV) plus
-- AES-GCM's 16-byte authentication tag on top of the file's own bytes. A file
-- of exactly `MAX_RECEIPT_BYTES` therefore passes the client's own check and
-- is then refused by the bucket, 45 bytes over the old cap. The new cap gives
-- a kilobyte of headroom rather than the 45 bytes actually needed, so it does
-- not have to move again if the envelope format grows a field.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10486784,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts owner read" on storage.objects;
create policy "receipts owner read"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts owner insert" on storage.objects;
create policy "receipts owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts owner delete" on storage.objects;
create policy "receipts owner delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
