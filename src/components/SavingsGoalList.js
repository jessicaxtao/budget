import { formatCents, formatPeriod, fromCents, toCents } from "../utils";

/**
 * The goals recorded so far, in the envelope shape: what each is saving
 * towards, what has actually accumulated toward it, and what this period's
 * contribution is — editable right on the row, the same commit-on-blur
 * contract CategoryPlanner's estimate cell uses.
 *
 * `availableCents` is a goal's cumulative assignment (see useEnvelopes'
 * goalRows) — a goal has no ledger of its own, so there is no spend or
 * refund to net against it the way a category's balance does.
 */

const TICKS = 24;

/**
 * Full means the goal is funded, the reverse of TallyGauge's tone — a goal
 * carrying its whole target forward is the point, not a warning. Local
 * rather than a call to GivenMeter or FundedMeter: each of those already
 * reads its own ratio one way, and a shared component serving three readings
 * would be a trap for whichever of the three came next.
 */
function GoalMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-verdant" : ratio >= 0.5 ? "bg-sulfur" : "bg-azure";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <span key={index} className={`h-3 w-[3px] ${index < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}

const figureClass = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";

function GoalRow({ row, striped, onAssign }) {
  const ratio = row.targetCents > 0 ? row.availableCents / row.targetCents : 0;

  function handleBlur(e) {
    const raw = e.target.value;
    const cents = raw.trim() === "" ? 0 : toCents(raw);
    const result = onAssign(row, cents);
    if (!result.ok) e.target.value = row.assignedCents ? fromCents(row.assignedCents) : "";
  }

  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {row.name}
        {row.targetDate && (
          <div className="mt-0.5 font-mono text-label uppercase text-ink-soft">
            By {row.targetDate}
          </div>
        )}
      </th>
      <td className={`${figureClass} text-ink-soft`}>{formatCents(row.targetCents)}</td>
      <td className={figureClass}>
        <div className="font-medium text-ink">{formatCents(row.availableCents)}</div>
        <div className="mt-1 flex justify-end">
          <GoalMeter
            ratio={ratio}
            label={`${Math.round(Math.min(ratio, 1) * 100)} percent of the way to ${row.name}`}
          />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        {/* Keyed on the stored figure, like every other blur-commit field
            here: a rejected edit is put back, and a change made elsewhere
            (there is nowhere else yet, but the contract is the same one
            every other row-level field in the app keeps) re-seeds it. */}
        <input
          key={row.assignedCents}
          type="text"
          inputMode="decimal"
          defaultValue={row.assignedCents ? fromCents(row.assignedCents) : ""}
          placeholder="$0"
          aria-label={`Assign to ${row.name} this period`}
          onBlur={handleBlur}
          className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
        />
      </td>
      <td
        className={`${figureClass} ${
          row.remainingCents === 0 ? "font-medium text-verdant" : "text-ink-soft"
        }`}
      >
        {row.remainingCents === 0 ? "Funded" : formatCents(row.remainingCents)}
      </td>
    </tr>
  );
}

export default function SavingsGoalList({ rows, period, onAssign }) {
  return (
    <section aria-label="Savings goals" className="border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Goals</h2>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No savings goals yet. Add one for anything expected to exceed the normal budget — a
          camera, a wedding, a special event.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  Goal
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                >
                  Target
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                >
                  Available
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                >
                  {formatPeriod(period)}
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                >
                  Remaining
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <GoalRow
                  key={row.goalId}
                  row={row}
                  striped={index % 2 === 1}
                  onAssign={onAssign}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
