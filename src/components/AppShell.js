import { NavLink } from "react-router-dom";
import { navigation } from "../navigation";
import Button from "./Button";
import { AUTH_STATUS, useAuth } from "../contexts/AuthContext";
import { SYNC_STATE, useSync } from "../contexts/SyncContext";
import { isDesktop } from "../storage";

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-ledger">
      <header className="bg-ledger">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-sans text-xl font-bold tracking-tight text-chalk">Household Books</span>
              <span className="font-mono text-label uppercase text-chalk-soft">Personal budget</span>
            </div>
            <AccountControl />
          </div>
          <nav aria-label="Sections" className="mt-5 flex flex-wrap gap-x-7">
            {navigation.map(({ path, label, accent }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `border-b-[3px] pb-2.5 font-sans text-sm font-medium transition-colors ${
                    isActive
                      ? `${accent.border} ${accent.text}`
                      : "border-transparent text-chalk-soft hover:border-edge hover:text-chalk"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-9">{children}</main>
    </div>
  );
}

/**
 * Where the books are being kept, and the way to change it.
 *
 * **Both hooks are optional here**, and that is deliberate rather than
 * defensive: `AppShell` renders in the page and app test suites, which mount
 * `AppProviders` directly with nothing above them.
 *
 * **Three states get something, and the distinction between the last two
 * matters.** Signed in shows the account and the ways out of it. `GUEST` — a
 * configured build whose user chose to stay local — says so and offers sync,
 * because they were given the choice and may want the other answer. `LOCAL_ONLY`
 * says the same thing and offers *nothing*, because it is a fact about the
 * build: there is no account server configured, so a "turn on sync" button
 * there has exactly one possible outcome, which is an error message explaining
 * that it cannot.
 */
function AccountControl() {
  const { status, email, signOut, stopSyncing, leaveLocalMode } = useAuth() ?? {};
  const { syncState } = useSync() ?? {};

  const local = status === AUTH_STATUS.GUEST || status === AUTH_STATUS.LOCAL_ONLY;

  if (local) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className="font-mono text-label uppercase text-chalk-soft"
          title={
            isDesktop()
              ? "Your books are in a file on this computer. Nothing is sent anywhere."
              : "Your books are in this browser. Nothing is sent anywhere."
          }
        >
          On this {isDesktop() ? "computer" : "browser"}
        </span>
        {status === AUTH_STATUS.GUEST && (
          <Button variant="outline" size="sm" type="button" onClick={leaveLocalMode}>
            Turn on sync
          </Button>
        )}
      </div>
    );
  }

  if (!email) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SyncBadge state={syncState} />
      {/* `title` rather than a wider column: an address long enough to be
          truncated is still identifiable by its start, and the header must not
          reflow around it. */}
      <span
        title={email}
        className="max-w-[16rem] truncate font-mono text-label text-chalk-soft"
      >
        {email}
      </span>
      {/* Desktop only, and the wording is the difference: on a machine somebody
          owns, the useful thing is to keep the books and drop the server, which
          `signOut` will not do. In a browser the destructive one is the right
          default — the books have to leave with the session, because the next
          person to open this browser is not necessarily the same household. */}
      {isDesktop() && (
        <Button variant="outline" size="sm" type="button" onClick={stopSyncing}>
          Stop syncing
        </Button>
      )}
      <Button variant="outline" size="sm" type="button" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}

/**
 * Says something only when there is something to say.
 *
 * A permanent "Saved" badge is a light that is always on, which is a light
 * nobody reads. Idle shows nothing; the two states worth interrupting for are
 * "still going" and "not landing".
 */
function SyncBadge({ state }) {
  if (state === SYNC_STATE.SAVING) {
    return (
      <span role="status" className="font-mono text-label uppercase text-chalk-soft">
        Saving…
      </span>
    );
  }
  if (state === SYNC_STATE.OFFLINE) {
    return (
      <span
        role="status"
        title={`Your edits are safe ${
          isDesktop() ? "on this computer" : "in this browser"
        } and will be sent when the connection is back.`}
        className="border border-vermilion/60 px-2 py-0.5 font-mono text-label uppercase text-vermilion"
      >
        Not saved
      </span>
    );
  }
  return null;
}
