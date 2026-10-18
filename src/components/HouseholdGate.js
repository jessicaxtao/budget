import GateShell from "./GateShell";
import Button from "./Button";
import { HOUSEHOLD_STATUS, useHousehold } from "../contexts/HouseholdContext";

/**
 * The sixth layer, between `HouseholdProvider` and `SyncProvider`: the active
 * household's master key has to be in force before there is anything for
 * `SyncContext` to decrypt. Renders `children` once the household is `ready`, a
 * loading state while `checking`, and otherwise a short explanation — either a
 * member still waiting to be granted the key (`noAccess`), or an error loading
 * it.
 *
 * Inert whenever sync is: the provider reports `ready` immediately for an
 * unconfigured, guest or local-only session, so this passes straight through.
 */
export default function HouseholdGate({ children }) {
  const { status, error, reload } = useHousehold();

  if (status === HOUSEHOLD_STATUS.READY) return children;

  if (status === HOUSEHOLD_STATUS.CHECKING) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ledger">
        <p className="font-mono text-label uppercase tracking-wide text-chalk-soft">
          Loading your household…
        </p>
      </div>
    );
  }

  if (status === HOUSEHOLD_STATUS.NO_ACCESS) {
    return (
      <GateShell
        title="Waiting for access"
        blurb={
          error ??
          "You have been invited to this household, but no one with its key has been online to grant you access yet. It will open automatically once they are — check back shortly."
        }
      >
        <Button variant="outline" type="button" onClick={reload} className="w-full">
          Check again
        </Button>
      </GateShell>
    );
  }

  return (
    <GateShell
      title="Could not open your household"
      blurb={error ?? "Something went wrong loading your household. Reload once you have a connection."}
    >
      <Button variant="primary" type="button" onClick={() => window.location.reload()} className="w-full">
        Reload
      </Button>
    </GateShell>
  );
}
