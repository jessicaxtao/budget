import { useState } from "react";
import Button from "./Button";
import Field from "./Field";
import { useAuth } from "../contexts/AuthContext";
import { HOUSEHOLD_STATUS, ROLES, useHousehold } from "../contexts/HouseholdContext";
import { useSync } from "../contexts/SyncContext";

/**
 * Beside `BooksEncryptionPanel`, closed the same way. Where a household is
 * named, people are invited to share it, roles are set, and members are
 * removed. Rendered only on a build with an account and a household in force —
 * `useSync().remote` and `HouseholdContext.status === ready`, the same `?? {}`
 * guard the encryption panel uses so a page suite with no providers above it
 * renders nothing rather than throwing.
 *
 * The honest cost of end-to-end sharing is said out loud here, because it is
 * surprising: inviting someone who has not set up their own books password yet
 * cannot grant them access immediately — the key can only be wrapped for them
 * once they have a public key *and* a member who holds the key is next online.
 */
export default function HouseholdPanel() {
  const { remote } = useSync() ?? {};
  const household = useHousehold() ?? {};
  const { status } = household;

  if (!remote || status !== HOUSEHOLD_STATUS.READY) return null;

  const isOwner = household.role === ROLES.OWNER;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">
            Household sharing
          </span>
          <span className="ml-3 text-label uppercase text-chalk-soft">
            {household.activeHousehold?.name ?? "Household"} · {household.role}
          </span>
        </summary>

        <div className="border-t border-edge">
          <NewHereExplainer />
          {household.memberships.length > 1 && <HouseholdSwitcher household={household} />}
          <RenameHousehold household={household} canEdit={isOwner} />
          <MemberRoster household={household} isOwner={isOwner} />
          {isOwner && <InviteMember household={household} />}
          <CreateHousehold household={household} />
        </div>
      </details>
    </section>
  );
}

/** The one-screen primer a new user needs: what a shared household is, how a
 *  grant actually travels, what the roles mean, and why the recovery code is
 *  not optional. */
function NewHereExplainer() {
  return (
    <details className="border-b border-edge">
      <summary className="cursor-pointer px-4 py-3 font-sans text-row text-azure marker:text-chalk-soft">
        New to shared budgets? Start here.
      </summary>
      <div className="space-y-3 px-4 pb-4 font-sans text-row leading-relaxed text-chalk-soft">
        <p>
          A <strong className="text-chalk">household</strong> is one shared budget. Everyone you
          invite sees and (unless they are a viewer) edits the very same transactions, envelopes and
          accounts, synced live across your devices.
        </p>
        <p>
          Your books stay end-to-end encrypted the whole time. The household's key is sealed
          separately for each member's own books password — so sharing never means handing anyone
          your password, and the server still cannot read a thing.
        </p>
        <p>
          <strong className="text-chalk">Inviting takes two steps, by design.</strong> Invite someone
          by email; if they already have a Canopy account with a books password set, they get access
          at once. If not, ask them to sign up and choose their own books password first — their
          invite then completes automatically the next time you (or any member) open the app.
        </p>
        <p>
          <strong className="text-chalk">Roles.</strong> An <em>owner</em> manages members and edits;
          an <em>editor</em> edits but cannot manage members; a <em>viewer</em> can only look.
        </p>
        <p>
          <strong className="text-chalk">Save your recovery code.</strong> It is the only other way
          back into your own books if you forget your books password. In a shared household another
          member can re-invite you, but on a household of your own, losing both means the server's
          copy is gone for good.
        </p>
      </div>
    </details>
  );
}

function HouseholdSwitcher({ household }) {
  return (
    <div className="border-b border-edge px-4 py-3">
      <label className="mb-1 block text-label uppercase text-chalk-soft">Active household</label>
      <select
        value={household.activeHouseholdId}
        onChange={(e) => household.switchActive(e.target.value)}
        className="w-full rounded-lg border border-edge bg-ledger px-3 py-2 font-sans text-row text-chalk"
      >
        {household.memberships.map((m) => (
          <option key={m.householdId} value={m.householdId}>
            {m.name} ({m.role})
          </option>
        ))}
      </select>
    </div>
  );
}

function RenameHousehold({ household, canEdit }) {
  const [name, setName] = useState(household.activeHousehold?.name ?? "");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  if (!canEdit) {
    return (
      <div className="border-b border-edge px-4 py-3">
        <span className="text-label uppercase text-chalk-soft">Household</span>
        <span className="ml-3 font-sans text-row text-chalk">{household.activeHousehold?.name}</span>
      </div>
    );
  }

  async function commit() {
    setError(null);
    setDone(false);
    if ((name ?? "").trim() === (household.activeHousehold?.name ?? "")) return;
    const result = await household.renameHousehold(name);
    if (!result.ok) setError(result.error);
    else setDone(true);
  }

  return (
    <div className="border-b border-edge px-4 py-3">
      <label className="mb-1 block text-label uppercase text-chalk-soft" htmlFor="household-name">
        Household name
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="household-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ledger px-3 py-2 font-sans text-row text-chalk"
        />
      </div>
      {error && <p role="alert" className="mt-2 font-sans text-row text-vermilion">{error}</p>}
      {done && <p role="status" className="mt-2 font-sans text-row text-chalk-soft">Renamed.</p>}
    </div>
  );
}

function MemberRoster({ household, isOwner }) {
  const { userId } = useAuth();
  const { members, pendingInvites } = household;

  return (
    <div className="border-b border-edge px-4 py-3">
      <h3 className="mb-2 font-sans text-sm font-semibold tracking-tight text-chalk">Members</h3>
      <ul className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            isSelf={m.userId === userId}
            isOwner={isOwner}
            household={household}
          />
        ))}
      </ul>

      {pendingInvites.length > 0 && (
        <>
          <h3 className="mb-2 mt-4 font-sans text-sm font-semibold tracking-tight text-chalk">
            Pending invites
          </h3>
          <ul className="space-y-2">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 font-sans text-row">
                <span className="text-chalk">{i.email}</span>
                <span className="text-label uppercase text-chalk-soft">
                  {i.role} · waiting for them to set up
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MemberRow({ member, isSelf, isOwner, household }) {
  const { resync } = useSync() ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function changeRole(role) {
    setError(null);
    const result = await household.setRole(member.userId, role);
    if (!result.ok) setError(result.error);
  }

  async function remove(reKey) {
    setBusy(true);
    setError(null);
    const removed = await household.removeMember(member.userId);
    if (!removed.ok) {
      setBusy(false);
      setError(removed.error);
      return;
    }
    if (reKey) {
      const rotated = await household.rotateKey();
      if (rotated.ok && resync) resync();
      else if (!rotated.ok) setError(rotated.error);
    }
    setBusy(false);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 font-sans text-row">
      <span className="text-chalk">
        {/* No email is shown for other members: a co-member's address is not
            readable under the per-user key policy, so only a short handle is. */}
        {isSelf ? "You" : `Member ${member.userId.slice(0, 8)}`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {isOwner && !isSelf ? (
          <select
            value={member.role}
            onChange={(e) => changeRole(e.target.value)}
            className="rounded-lg border border-edge bg-ledger px-2 py-1 text-label uppercase text-chalk"
          >
            {Object.values(ROLES).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        ) : (
          <span className="text-label uppercase text-chalk-soft">{member.role}</span>
        )}
        {isOwner && !isSelf && (
          <>
            <Button variant="outline" type="button" disabled={busy} onClick={() => remove(false)}>
              Remove
            </Button>
            <Button variant="outline" type="button" disabled={busy} onClick={() => remove(true)}>
              {busy ? "Working…" : "Remove & re-key"}
            </Button>
          </>
        )}
      </div>
      {error && <p role="alert" className="w-full font-sans text-row text-vermilion">{error}</p>}
    </li>
  );
}

function InviteMember({ household }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLES.EDITOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await household.invite({ email, role });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmail("");
    setNotice(
      result.pending
        ? "Invite saved. They'll get access once they sign up, set a books password, and a member opens the app."
        : "Access granted — they'll see this household the next time they open the app."
    );
  }

  return (
    <form onSubmit={submit} noValidate className="border-b border-edge px-4 py-4">
      <h3 className="mb-3 font-sans text-sm font-semibold tracking-tight text-chalk">Invite someone</h3>
      <Field
        label="Their email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label className="mb-1 block text-label uppercase text-chalk-soft" htmlFor="invite-role">
        Role
      </label>
      <select
        id="invite-role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="mb-4 w-full rounded-lg border border-edge bg-ledger px-3 py-2 font-sans text-row text-chalk"
      >
        <option value={ROLES.EDITOR}>Editor — can edit the books</option>
        <option value={ROLES.VIEWER}>Viewer — can only look</option>
        <option value={ROLES.OWNER}>Owner — can also manage members</option>
      </select>
      {error && <p role="alert" className="mb-3 font-sans text-row text-vermilion">{error}</p>}
      {notice && <p role="status" className="mb-3 font-sans text-row text-chalk-soft">{notice}</p>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Inviting…" : "Send invite"}
      </Button>
    </form>
  );
}

function CreateHousehold({ household }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await household.createHousehold(name || "My household");
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setName("");
  }

  return (
    <div className="px-4 py-4">
      <h3 className="mb-1 font-sans text-sm font-semibold tracking-tight text-chalk">
        Start another household
      </h3>
      <p className="mb-3 font-sans text-row leading-relaxed text-chalk-soft">
        A separate shared budget with its own books and its own members — for a side business, say.
        You can switch between them above.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          placeholder="Name (optional)"
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ledger px-3 py-2 font-sans text-row text-chalk"
        />
        <Button variant="outline" type="button" disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 font-sans text-row text-vermilion">{error}</p>}
    </div>
  );
}
