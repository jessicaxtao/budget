import { formatCents } from "../utils";
import Button from "./Button";

/**
 * Money that has arrived and has not been given a job yet.
 *
 *   toBeAssigned = all income received − everything assigned to a category
 *
 * Both sides run cumulatively, so last month's leftover is still here to assign
 * and does not quietly expire at the month boundary.
 *
 * Always renders, even at zero: this is the entry point to the assign flow and
 * the standing answer to "where did my paycheck go", not an overflow bucket
 * that should disappear when it happens to be empty.
 *
 * "Add income" deliberately lives in the page header rather than here. It was
 * on this card when the card was the only place to reach it; now that the
 * header carries the three verbs, having it in both places was just two buttons
 * doing one job.
 */
export default function ToBeAssignedCard({
  toBeAssignedCents,
  periodIncomeCents,
  periodAssignedCents,
  onAssignClick,
  onViewIncomeClick,
}) {
  // Sulfur is the caution slot, and money sitting unassigned is exactly that —
  // it needs a decision. Zero is the goal, so it reads as income green.
  const tone =
    toBeAssignedCents < 0
      ? { border: "border-vermilion/60", text: "text-vermilion", label: "Over-assigned" }
      : toBeAssignedCents > 0
      ? { border: "border-sulfur/50", text: "text-sulfur", label: "Unassigned" }
      : { border: "border-verdant/50", text: "text-verdant", label: "All assigned" };

  return (
    <div className={`border ${tone.border} bg-panel p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="font-sans text-sm font-semibold tracking-tight text-chalk">
          To be assigned
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-mono text-figure font-medium ${tone.text}`}>
            {formatCents(toBeAssignedCents)}
          </div>
          <div className={`font-mono text-label uppercase ${tone.text}`}>{tone.label}</div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-edge pt-2.5">
        {[
          ["Received", periodIncomeCents],
          ["Assigned", periodAssignedCents],
        ].map(([label, cents]) => (
          <div key={label}>
            <dt className="font-mono text-label uppercase text-chalk-soft">{label} this month</dt>
            <dd className="font-mono text-row text-chalk">{formatCents(cents)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="primary" size="sm" onClick={onAssignClick}>
          Assign
        </Button>
        <Button variant="outline" size="sm" onClick={onViewIncomeClick}>
          View income
        </Button>
      </div>
    </div>
  );
}
