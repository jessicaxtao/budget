import { formatCents } from "../utils";
import Button from "./Button";
import Elder, { ELDER_MOODS } from "./Elder";

/**
 * Money that has arrived and has not been given a job yet.
 *
 *   toBeAssigned = opening balances + all income received − everything assigned
 *                  ± money moved across the budget's edge with no envelope named
 *
 * Both sides run cumulatively, so last month's leftover is still here to assign
 * and does not quietly expire at the month boundary.
 *
 * Money moved to or from an off-budget account is neither received nor
 * assigned, so when a month has any it gets a figure of its own beside those
 * two — otherwise the pool would move with nothing on screen to say why. Hidden
 * at zero, which is most months.
 *
 * A strip rather than a card, because it no longer sits in a grid of them: the
 * register below is the page, and this is the one figure that has to be true
 * while the ledger is being worked through. It always renders, even at zero —
 * this is the entry point to the assign flow and the standing answer to "where
 * did my paycheck go", not an overflow bucket that should disappear when it
 * happens to be empty.
 *
 * The Assign button lives here and nowhere else on the page. It was in the
 * header too when the header carried the three verbs; two buttons doing one job
 * is one too many, and this is the place the figure they act on is stated.
 */
export default function ToBeAssignedBar({
  toBeAssignedCents,
  periodIncomeCents,
  periodAssignedCents,
  periodTransferInCents = 0,
  periodTransferOutCents = 0,
  onAssignClick,
}) {
  // Sulfur is the caution slot, and money sitting unassigned is exactly that —
  // it needs a decision. Zero is the goal, so it reads as income green.
  const tone =
    toBeAssignedCents < 0
      ? {
          border: "border-vermilion/60",
          text: "text-vermilion",
          label: "Over-assigned",
          mood: ELDER_MOODS.CONCERNED,
        }
      : toBeAssignedCents > 0
      ? {
          border: "border-sulfur/50",
          text: "text-sulfur",
          label: "Unassigned",
          mood: ELDER_MOODS.PONDERING,
        }
      : {
          border: "border-verdant/50",
          text: "text-verdant",
          label: "All assigned",
          mood: ELDER_MOODS.CONTENT,
        };

  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-2xl border ${tone.border} bg-panel py-2 pl-3 pr-3`}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-3">
          {/* The label beside him says the same thing in words. */}
          <Elder mood={tone.mood} className="h-9 w-10" />
          <span className="font-mono text-label uppercase text-chalk-soft">To be assigned</span>
          {/* No tabular-nums: equal-width digits make a large standalone figure
              look loose, and this one is not in a column of anything. */}
          <span className={`font-mono text-figure font-medium ${tone.text}`}>
            {formatCents(toBeAssignedCents)}
          </span>
          <span className={`font-mono text-label uppercase ${tone.text}`}>{tone.label}</span>
        </div>

        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          {[
            { label: "Received", cents: periodIncomeCents, always: true },
            { label: "Assigned", cents: periodAssignedCents, always: true },
            { label: "Moved in", cents: periodTransferInCents },
            { label: "Moved out", cents: periodTransferOutCents },
          ]
            .filter(({ cents, always }) => always || cents !== 0)
            .map(({ label, cents }) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="font-mono text-label uppercase text-chalk-soft">
                  {label} this month
                </dt>
                <dd className="font-mono text-row tabular-nums text-chalk">{formatCents(cents)}</dd>
              </div>
            ))}
        </dl>
      </div>

      <Button variant="primary" size="sm" onClick={onAssignClick}>
        Assign income
      </Button>
    </div>
  );
}
