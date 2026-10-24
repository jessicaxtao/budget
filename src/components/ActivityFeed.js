import { useActivity } from "../contexts/ActivityContext";
import { useAuth } from "../contexts/AuthContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useHousehold } from "../contexts/HouseholdContext";
import { TO_BE_ASSIGNED } from "../contexts/constants";
import { formatCents } from "../utils";

/**
 * Recent activity panel for the dashboard's right column.
 *
 * Shows the last 5 mutations by any household member, newest first, with
 * live updates via Supabase realtime. Each entry names who acted ("You" or a
 * truncated member handle), describes what happened, and shows a relative
 * timestamp. Descriptions are assembled from the decrypted payload at render
 * time, so payee and category names reflect any renames since the action.
 *
 * Rendered only when there is an ActivityContext above it — which is always
 * true in the real app, and lets the component fail gracefully in stories or
 * tests that mount it without providers.
 */
export default function ActivityFeed() {
  const activity = useActivity();
  const household = useHousehold();
  if (!activity) return null;
  if (!household || household.members.length < 2) return null;

  const { entries, ready } = activity;
  const visible = entries.slice(0, 15);

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Recent activity
        </h2>
      </div>

      {!ready ? (
        <div className="space-y-2 px-4 py-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-4 animate-pulse rounded bg-edge" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No activity yet. Transactions and envelope moves will appear here.
        </p>
      ) : (
        visible.map((entry, index) => (
          <ActivityRow key={entry.id} entry={entry} striped={index % 2 === 1} />
        ))
      )}
    </section>
  );
}

function ActivityRow({ entry, striped }) {
  const { userId } = useAuth();
  const { budgets } = useBudgets();
  const { payeeById } = usePayees();

  const actor = entry.userId === userId
    ? "You"
    : `Member ${(entry.userId ?? "").slice(0, 8)}`;

  const description = describeEntry(entry, budgets, payeeById);

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 px-4 py-2 ${
        striped ? "bg-sheet-alt" : "bg-sheet"
      }`}
    >
      <div className="min-w-0 flex-1">
        <span className="mr-2 font-mono text-label font-semibold uppercase text-chalk">
          {actor}
        </span>
        <span className="font-sans text-row text-chalk-soft">{description}</span>
      </div>
      <span className="shrink-0 text-label uppercase text-chalk-soft">
        {relativeTime(entry.createdAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Description assembly
// ---------------------------------------------------------------------------

function budgetName(budgets, id) {
  if (!id || id === TO_BE_ASSIGNED) return "available funds";
  return budgets?.find((b) => b.id === id)?.name ?? "Unknown category";
}

function payeeName(payeeById, id) {
  if (!id) return null;
  return payeeById?.get(id)?.name ?? null;
}

function formatPeriod(period) {
  if (!period) return "";
  const [year, month] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function describeEntry(entry, budgets, payeeById) {
  const { actionType, amountCents, kind, payeeId, budgetId, fromBudgetId, toBudgetId, period, count } = entry;
  const amount = formatCents(amountCents ?? 0);
  const payee = payeeName(payeeById, payeeId);

  switch (actionType) {
    case "transaction.created":
    case "transaction.updated": {
      const verb = actionType === "transaction.created" ? "Added" : "Updated";
      if (kind === "transfer") {
        return `${verb} ${amount} transfer${payee ? ` · ${payee}` : ""}`;
      }
      if (kind === "inflow") {
        if (budgetId) {
          return `${verb} ${amount} refund${payee ? ` · ${payee}` : ""} → ${budgetName(budgets, budgetId)}`;
        }
        return `${verb} ${amount} income${payee ? ` · ${payee}` : ""}`;
      }
      // outflow (most common)
      const parts = [amount];
      if (payee) parts.push(payee);
      if (budgetId) parts.push(budgetName(budgets, budgetId));
      return `${verb} ${parts.join(" · ")}`;
    }

    case "transaction.deleted": {
      const parts = [amount];
      if (payee) parts.push(payee);
      return `Deleted ${parts.join(" · ")}`;
    }

    case "assignment.set": {
      const cat = budgetName(budgets, budgetId);
      if (!amountCents) return `Cleared ${cat} in ${formatPeriod(period)}`;
      return `Set ${cat} to ${amount} in ${formatPeriod(period)}`;
    }

    case "assignment.moved": {
      const from = fromBudgetId === TO_BE_ASSIGNED
        ? "available funds"
        : budgetName(budgets, fromBudgetId);
      const to = toBudgetId === TO_BE_ASSIGNED
        ? "available funds"
        : budgetName(budgets, toBudgetId);
      return `Moved ${amount} from ${from} to ${to}`;
    }

    case "assignment.bulk": {
      const n = count ?? 0;
      return `Funded ${n} ${n === 1 ? "category" : "categories"} for ${formatPeriod(period)}`;
    }

    default:
      return actionType;
  }
}

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

function relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
