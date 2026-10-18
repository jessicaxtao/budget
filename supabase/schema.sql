-- Canopy Budget — Supabase schema.
--
-- Run this once, whole, in the SQL editor of a new project. It is idempotent:
-- every statement guards itself, so re-running after a change is safe, and the
-- one legacy-migration block guards on a column's presence so it converts an
-- old single-user database exactly once and is a no-op thereafter.
--
-- ONE SHAPE OF DATA, still: one row per store, each the whole value of that
-- store. Every derivation in this app (envelopes, net worth, the retirement
-- projection, the spending report) loads a whole array and computes over it in
-- JavaScript, so there is nothing for a relational split to buy — and a great
-- deal for it to cost, since every mutator here returns `{ ok, error }`
-- synchronously and ~40 call sites plus the invariant tripwires depend on that.
--
-- WHAT CHANGED FROM "ONE HOUSEHOLD PER ACCOUNT": a budget is no longer the same
-- thing as an account. A **household** is now a first-class row with its own id
-- and its own master key; users **belong** to it through `household_members`
-- with a role (owner / editor / viewer); and `app_state` is keyed and gated by
-- `household_id`, not `user_id`. The security predicate is therefore no longer
-- `user_id = auth.uid()` but "is auth.uid() a member of this household" —
-- `is_member(household_id)` for reads, `member_role(household_id)` for writes.
-- Both are `security definer` so a policy on `household_members` can ask about
-- `household_members` without the infinite recursion a self-referential RLS
-- predicate would otherwise cause.
--
-- THE KEY NEVER REACHES THE SERVER, still. A household's master key (MK) is
-- symmetric and seals every document, exactly as before — but it is no longer
-- wrapped under a password. Each user has an RSA-OAEP **identity keypair**
-- (`user_keys`); MK is wrapped once per member's public key
-- (`household_keys.wrapped_mk`). The books password now guards the user's
-- *private key*, not MK. See `src/booksCrypto.js` and `.claude/ACCOUNTS.md`.
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

-- ===========================================================================
-- Households and membership
-- ===========================================================================

create table if not exists public.households (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (char_length(name) between 1 and 120),
  -- Who first created it. Inert history, not a capability — an owner's powers
  -- come from their membership row, not from this, so a creator who later
  -- leaves takes no authority with them.
  created_by uuid        not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  -- owner  → manages membership and edits; editor → edits; viewer → reads only.
  -- The role bites in RLS (`member_role` below), not only in the UI: a viewer
  -- holds MK and can therefore decrypt, so their read-only-ness is enforced by
  -- the server refusing their writes, not by hiding anything from them.
  role         text        not null check (role in ('owner', 'editor', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Membership predicates, as `security definer` so RLS can ask about membership
-- without a self-referential policy recursing forever. Owned by the role that
-- runs this script (postgres, which bypasses RLS), so the lookups inside see
-- every row regardless of the caller's own policies. `stable` and a pinned
-- `search_path` so they are safe to call from a policy and cannot be shadowed.
-- ---------------------------------------------------------------------------

create or replace function public.is_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function public.member_role(hid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.household_members
  where household_id = hid and user_id = auth.uid();
$$;

-- auth.uid()'s own email, for the one policy that needs it (an invitee seeing
-- an invite addressed to them). `security definer` because `auth.users` is not
-- readable under a caller's RLS.
create or replace function public.my_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from auth.users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Creating a household is one atomic step, through a function, for a bootstrap
-- reason: the creator must become the first owner, but at the instant the
-- household row appears they are not yet a member, so a direct INSERT could not
-- satisfy an owner-only membership policy. `security definer` inserts both rows
-- as the script's owner and hands back the new id. There is deliberately no
-- direct INSERT policy on `households`, so this is the only way one is made.
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.households (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'My household'), auth.uid())
    returning id into new_id;
  insert into public.household_members (household_id, user_id, role)
    values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

-- ===========================================================================
-- Identity keys and the per-member household-key wraps
-- ===========================================================================
-- The invariant the encryption rests on: **`app_state.value` is always
-- ciphertext; these key tables are always plaintext metadata.** Separate tables
-- rather than reserved keys so the rule is structural, not remembered.

create table if not exists public.user_keys (
  user_id       uuid        primary key references auth.users (id) on delete cascade,

  -- The RSA-OAEP public key as SPKI base64. PUBLIC by definition: it is what
  -- another member reads (through `lookup_public_key`) to wrap MK for this one.
  public_key    text        not null,

  -- { alg, hash, iterations } for the PBKDF2 derivation of the KEK that guards
  -- the private key, stored rather than hard-coded so it can be raised later.
  kdf           jsonb       not null,

  -- The private key, wrapped under the books password and under the printed
  -- recovery code — base64(iv‖ciphertext) of its PKCS8 bytes. Useless without a
  -- secret the server never receives. **These wrap columns are why select on
  -- this table is own-row only**: they are the encrypted private key, and a
  -- world-readable copy would hand an offline attacker the one thing a slow KDF
  -- is there to protect. Others get the public key through the RPC, never a row.
  password_salt text        not null,
  password_wrap text        not null,
  recovery_salt text,
  recovery_wrap text,

  created_at    timestamptz not null default now()
);

create table if not exists public.household_keys (
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,

  -- Names the MK every envelope in this household's `app_state` is sealed with.
  -- Unlike the old per-account `kid`, this one *can* change: re-keying after a
  -- member is removed mints a fresh MK and `kid`, and the client refuses any
  -- envelope whose `kid` no longer matches.
  kid          uuid        not null,

  -- RSA-OAEP( MK, this member's public key ), base64. Written by an existing
  -- member who holds MK unlocked; readable only by the member it is for.
  wrapped_mk   text        not null,

  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Pending invitations, for the honest cost of end-to-end sharing: an existing
-- member can only wrap MK for someone who already has a public key. An invite
-- to someone who does not yet is parked here until they set one up, and the
-- next member online with MK completes it (see `src/contexts/HouseholdContext`).
create table if not exists public.household_invites (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households (id) on delete cascade,
  invitee_email text        not null,
  role          text        not null check (role in ('owner', 'editor', 'viewer')),
  invited_by    uuid        not null references auth.users (id),
  created_at    timestamptz not null default now(),
  unique (household_id, invitee_email)
);

-- Resolve an email to the user id and public key of the account that holds it,
-- or no row. The only crack in the wall and a deliberate one: it lets an owner
-- wrap MK for an invitee (which needs the public key) and write their membership
-- and key rows (which need the user id) without the private-key wraps ever being
-- readable. It leaks "this email has an account with a key here", the same leak
-- class the sign-in form is already worded around; gated to authenticated
-- callers, and returns the user id and public key only — never a wrap.
drop function if exists public.lookup_public_key(text);
create or replace function public.lookup_public_key(p_email text)
returns table (user_id uuid, public_key text)
language sql
security definer
set search_path = public
stable
as $$
  select k.user_id, k.public_key
  from auth.users u
  join public.user_keys k on k.user_id = u.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

-- ===========================================================================
-- app_state — the books, one encrypted document per store, per household
-- ===========================================================================

create table if not exists public.app_state (
  -- The household these books belong to. On delete cascade: deleting a
  -- household takes its books with it, and there is no other copy on the server
  -- — which is what the export on the account panel is for.
  household_id uuid        not null references public.households (id) on delete cascade,

  -- The store's own key — "budgets", "transactions", "accountBalances".
  -- Bounded rather than enumerated: a CHECK listing every key would mean a
  -- schema migration every time a store is added, and the client is the thing
  -- that knows what a key means.
  key          text        not null check (char_length(key) between 1 and 64),

  -- The whole value of that store, as an encrypted envelope { v, kid, iv, ct }.
  value        jsonb       not null,

  -- Maintained by the trigger below, never by the client — a device with a
  -- wrong clock could otherwise win every conflict comparison forever.
  updated_at   timestamptz not null default now(),

  primary key (household_id, key)
);

-- ---------------------------------------------------------------------------
-- Legacy migration: convert a single-user database (app_state keyed by user_id)
-- into the household shape, exactly once. Guarded on the old `user_id` column
-- still being present and the new `household_id` column still being absent, so
-- a fresh database skips it entirely and a re-run is a no-op.
--
-- This moves the ROWS; it cannot move the KEY. MK stays wrapped under the old
-- password in `app_crypto` (kept, below) until the client — the only thing that
-- can unlock it — mints an identity keypair and re-wraps MK into
-- `household_keys`. Until then a migrated user can read their rows (they are an
-- owner) but not decrypt them, which is the same self-healing stance the
-- plaintext→sealed migration already took.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_state' and column_name = 'user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_state' and column_name = 'household_id'
  ) then
    -- A household and an owner membership for every user who owns any books.
    with owners as (
      select distinct user_id from public.app_state
      union
      select user_id from public.app_crypto
    ),
    made as (
      insert into public.households (name, created_by)
      select 'My household', user_id from owners
      returning id, created_by
    )
    insert into public.household_members (household_id, user_id, role)
    select id, created_by, 'owner' from made;

    -- Point every row at its owner's new household, then enforce and re-key.
    alter table public.app_state
      add column household_id uuid references public.households (id) on delete cascade;
    update public.app_state s
      set household_id = m.household_id
      from public.household_members m
      where m.user_id = s.user_id;
    alter table public.app_state alter column household_id set not null;

    alter table public.app_state drop constraint app_state_pkey;
    alter table public.app_state add primary key (household_id, key);

    -- Keep user_id through the transition (an un-updated client may still read
    -- it), but it is no longer required on a write.
    alter table public.app_state alter column user_id drop not null;
  end if;
end
$$;

alter table public.app_state enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.user_keys enable row level security;
alter table public.household_keys enable row level security;
alter table public.household_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- The anon key ships inside the JavaScript bundle — it is public by design, so
-- RLS is not a second line of defence here, it is the only one. Granted to
-- `authenticated` only, so an unauthenticated caller holding the anon key
-- matches no policy and reads nothing.

-- app_state: any member reads; only owners and editors write. This split is
-- where the viewer role actually bites.
drop policy if exists "app_state owner access" on public.app_state;
drop policy if exists "app_state read" on public.app_state;
create policy "app_state read"
  on public.app_state for select to authenticated
  using (is_member(household_id));
drop policy if exists "app_state insert" on public.app_state;
create policy "app_state insert"
  on public.app_state for insert to authenticated
  with check (member_role(household_id) in ('owner', 'editor'));
drop policy if exists "app_state update" on public.app_state;
create policy "app_state update"
  on public.app_state for update to authenticated
  using (member_role(household_id) in ('owner', 'editor'))
  with check (member_role(household_id) in ('owner', 'editor'));
drop policy if exists "app_state delete" on public.app_state;
create policy "app_state delete"
  on public.app_state for delete to authenticated
  using (member_role(household_id) in ('owner', 'editor'));

-- households: members see their households; owners rename or delete. No INSERT
-- policy — a household is born only through create_household().
drop policy if exists "households read" on public.households;
create policy "households read"
  on public.households for select to authenticated
  using (is_member(id));
drop policy if exists "households update" on public.households;
create policy "households update"
  on public.households for update to authenticated
  using (member_role(id) = 'owner')
  with check (member_role(id) = 'owner');
drop policy if exists "households delete" on public.households;
create policy "households delete"
  on public.households for delete to authenticated
  using (member_role(id) = 'owner');

-- household_members: members see the roster; owners add, change roles, and
-- remove; anyone may remove their own row (leave).
drop policy if exists "household_members read" on public.household_members;
create policy "household_members read"
  on public.household_members for select to authenticated
  using (is_member(household_id));
drop policy if exists "household_members insert" on public.household_members;
create policy "household_members insert"
  on public.household_members for insert to authenticated
  with check (member_role(household_id) = 'owner');
drop policy if exists "household_members update" on public.household_members;
create policy "household_members update"
  on public.household_members for update to authenticated
  using (member_role(household_id) = 'owner')
  with check (member_role(household_id) = 'owner');
drop policy if exists "household_members delete" on public.household_members;
create policy "household_members delete"
  on public.household_members for delete to authenticated
  using (member_role(household_id) = 'owner' or user_id = auth.uid());

-- user_keys: own row only. The public key reaches others through
-- lookup_public_key(), never a row, so the private-key wraps are never exposed.
drop policy if exists "user_keys own" on public.user_keys;
create policy "user_keys own"
  on public.user_keys for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- household_keys: read your own wrap; an existing member may write a wrap for a
-- new member (that is how a grant happens); an owner may delete any (revoke) and
-- anyone may delete their own.
drop policy if exists "household_keys read" on public.household_keys;
create policy "household_keys read"
  on public.household_keys for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "household_keys insert" on public.household_keys;
create policy "household_keys insert"
  on public.household_keys for insert to authenticated
  with check (is_member(household_id));
drop policy if exists "household_keys update" on public.household_keys;
create policy "household_keys update"
  on public.household_keys for update to authenticated
  using (is_member(household_id))
  with check (is_member(household_id));
drop policy if exists "household_keys delete" on public.household_keys;
create policy "household_keys delete"
  on public.household_keys for delete to authenticated
  using (member_role(household_id) = 'owner' or user_id = auth.uid());

-- household_invites: owners manage them; an invitee may see an invite addressed
-- to their own email.
drop policy if exists "household_invites read" on public.household_invites;
create policy "household_invites read"
  on public.household_invites for select to authenticated
  using (is_member(household_id) or invitee_email = my_email());
drop policy if exists "household_invites insert" on public.household_invites;
create policy "household_invites insert"
  on public.household_invites for insert to authenticated
  with check (member_role(household_id) = 'owner');
drop policy if exists "household_invites update" on public.household_invites;
create policy "household_invites update"
  on public.household_invites for update to authenticated
  using (member_role(household_id) = 'owner')
  with check (member_role(household_id) = 'owner');
drop policy if exists "household_invites delete" on public.household_invites;
create policy "household_invites delete"
  on public.household_invites for delete to authenticated
  using (member_role(household_id) = 'owner' or invitee_email = my_email());

-- Postgres grants EXECUTE to PUBLIC by default AND Supabase's default
-- privileges grant it to `anon` explicitly — so `lookup_public_key` would
-- otherwise answer an unauthenticated caller, exactly the email-enumeration
-- leak it is meant to be gated against. Revoke from both `public` and `anon`
-- (the explicit grant survives a PUBLIC revoke), then grant to authenticated,
-- for every function here: the three helpers are evaluated inside policies that
-- are already `to authenticated`, and the two RPCs are only ever called by a
-- signed-in client.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.member_role(uuid) from public, anon;
revoke execute on function public.my_email() from public, anon;
revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.lookup_public_key(text) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.member_role(uuid) to authenticated;
grant execute on function public.my_email() to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.lookup_public_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

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
-- app_crypto — retired, retained for migration only
-- ---------------------------------------------------------------------------
-- This was the single-user key table: one row per account, MK wrapped under the
-- books password and the recovery code. It is superseded by `user_keys` (the
-- private-key wraps) and `household_keys` (the MK wraps), but it is kept so a
-- migrating client can read the old row, unlock the old MK with the password it
-- already knows, and re-wrap that same MK — same bytes, same `kid`, so not one
-- document is re-encrypted — into `household_keys`. A later schema may drop it
-- once every account has a `user_keys` row.

create table if not exists public.app_crypto (
  user_id        uuid        primary key references auth.users (id) on delete cascade,
  kid            uuid        not null,
  kdf            jsonb       not null,
  password_salt  text        not null,
  password_wrap  text        not null,
  recovery_salt  text,
  recovery_wrap  text,
  created_at     timestamptz not null default now()
);

alter table public.app_crypto enable row level security;

drop policy if exists "app_crypto owner access" on public.app_crypto;
create policy "app_crypto owner access"
  on public.app_crypto for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Encrypted envelopes only
-- ---------------------------------------------------------------------------
-- For one failure: a stale bundle reads an encrypted envelope as if it were a
-- plaintext document, finds none of the fields it expects, falls back to empty
-- defaults, and pushes those empty books over the real ones. Without this
-- constraint that is silent, server-side data loss; with it the old client's
-- write is refused and the header says "Not saved".
--
-- `not valid` leaves existing plaintext rows alone and checks only new writes,
-- so an account mid-migration is never locked out of saving its own old
-- documents. Wrapped in the same pg_constraint guard the Realtime block uses, so
-- re-running after it exists is a no-op.

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
-- What replaces the `storage` event that kept two browser tabs in step, one
-- device wider. Realtime respects RLS, so a subscriber is only ever sent rows
-- for households they belong to.

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

-- Realtime sends only the replica-identity columns for the old tuple, which by
-- default is the primary key alone. `SyncContext`'s subscription reads
-- `payload.old` on a DELETE, and Supabase evaluates RLS against the old row for
-- UPDATE and DELETE, so the table has to replicate the whole thing. FULL and not
-- the bare statement: `REPLICA IDENTITY` takes a mode or it is a syntax error
-- that rejects the whole script.
alter table public.app_state replica identity full;

-- The key tables are deliberately NOT published: a membership or key change is
-- picked up when a client loads or switches households, not pushed live — the
-- same stance the old app_crypto took, and a device already holding MK does not
-- care that another just granted it to someone else.

-- ---------------------------------------------------------------------------
-- Receipt files
-- ---------------------------------------------------------------------------
-- The charity's written acknowledgment of a gift, as a PDF or a photo, sealed
-- under the household MK. A file is not a document, so it does not go in
-- app_state. PRIVATE bucket; the app downloads through the API with the user's
-- own session.
--
-- Each household's files now sit under a folder named by its household id —
-- `<household id>/<receipt id>.<ext>` — and membership of that household is the
-- whole of the policy. The compatibility clause `... = auth.uid()::text` keeps
-- a receipt uploaded before this change (under the old `<uid>/` folder) readable
-- by the person who uploaded it until it is re-attached under the new path.
--
-- `application/octet-stream` is in the type list for a sealed receipt, which is
-- ciphertext with no media type of its own. The size cap carries the 1 KB of
-- headroom the envelope's 29-byte header plus AES-GCM's 16-byte tag need over
-- `MAX_RECEIPT_BYTES`. Change one of these, change `src/receipts.js` and
-- `electron/receipts.js` too.

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
drop policy if exists "receipts member read" on storage.objects;
create policy "receipts member read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      is_member((storage.foldername(name))[1]::uuid)
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists "receipts owner insert" on storage.objects;
drop policy if exists "receipts member insert" on storage.objects;
create policy "receipts member insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (
      member_role((storage.foldername(name))[1]::uuid) in ('owner', 'editor')
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists "receipts owner delete" on storage.objects;
drop policy if exists "receipts member delete" on storage.objects;
create policy "receipts member delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (
      member_role((storage.foldername(name))[1]::uuid) in ('owner', 'editor')
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );
