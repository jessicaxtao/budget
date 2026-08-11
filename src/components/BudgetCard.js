import { formatCents } from "../utils";
import Button from "./Button";
import TallyGauge from "./TallyGauge";

/**
 * One envelope: what the category carried in from earlier months, what was
 * assigned to it this month, and what it has spent.
 *
 *   available = carriedIn + assigned − spent
 *
 * The balance is the headline because that is the number the user acts on —
 * an estimate says what a category was expected to need, but only the balance
 * says whether there is money in it right now.
 */
export default function BudgetCard({
  name,
  carriedInCents = 0,
  assignedCents = 0,
  spentCents = 0,
  plannedCents = 0,
  // Derived cards — the running total and the uncategorised catch-all — recede
  // behind the categories the user actually configured.
  gray,
  onAddExpenseClick,
  hideButtons,
  onViewExpensesClick,
}) {
  const fundedCents = carriedInCents + assignedCents;
  const availableCents = fundedCents - spentCents;
  // One card, one definition of trouble: the envelope is empty and still paying
  // out. Not "spent more than the estimate", which an envelope with carry-over
  // can do quite safely.
  const overspent = availableCents < 0;

  return (
    <div
      className={`border p-4 ${
        gray
          ? "border-dashed border-edge bg-panel/60"
          : overspent
          ? "border-vermilion/60 bg-panel"
          : "border-edge bg-panel"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-sans text-sm font-semibold tracking-tight text-chalk">
            {name}
          </div>
          {plannedCents ? (
            <div className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
              Est. {formatCents(plannedCents)}/mo
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`font-mono text-figure font-medium ${
              overspent ? "text-vermilion" : availableCents > 0 ? "text-azure" : "text-chalk-soft"
            }`}
          >
            {formatCents(availableCents)}
          </div>
          <div
            className={`font-mono text-label uppercase ${
              overspent ? "text-vermilion" : "text-chalk-soft"
            }`}
          >
            {overspent ? "Overspent" : "Available"}
          </div>
        </div>
      </div>

      {/* Suppressed rather than clamped when there is nothing funding the
          envelope: TallyGauge treats a non-positive max as a zero ratio, so an
          overspent category would otherwise draw an empty, comfortable green
          meter over a negative balance. */}
      {fundedCents > 0 ? (
        <div className="mt-3">
          <TallyGauge amount={spentCents} max={fundedCents} />
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-2.5">
        {[
          ["Carried in", carriedInCents],
          ["Assigned", assignedCents],
          ["Spent", spentCents],
        ].map(([label, cents]) => (
          <div key={label}>
            <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
            <dd className="font-mono text-row text-chalk">{formatCents(cents)}</dd>
          </div>
        ))}
      </dl>

      {!hideButtons && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onAddExpenseClick}>
            Add expense
          </Button>
          <Button variant="outline" size="sm" onClick={onViewExpensesClick}>
            View expenses
          </Button>
        </div>
      )}
    </div>
  );
}
