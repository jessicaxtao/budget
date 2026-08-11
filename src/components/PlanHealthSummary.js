import { formatCents } from "../utils";
import TallyGauge from "./TallyGauge";

/**
 * Does the plan balance?
 *
 *   unplanned = expected income per month − Σ category estimates per month
 *
 * Three figures and a verdict. The verdict is the point of the page: a plan that
 * allocates more than it expects to take in is not a plan, and the user has to
 * see that before they leave the screen rather than discover it in three weeks
 * when the envelopes run dry.
 *
 * Both sides are monthly averages that hold until the user changes them, so
 * there is no month on this panel and no figure from the books on it either.
 * Whether the money that actually arrived has been given a job is "to be
 * assigned" on the Transactions page; answering both questions in one place
 * would blur which of them is being answered.
 */
export default function PlanHealthSummary({
  expectedIncomeCents,
  plannedCents,
  unplannedCents,
  sourceCount,
  categoryCount,
  estimatedCount,
}) {
  // With nothing expected to come in there is no verdict to give: every plan
  // would read as over-allocated, which says more about the empty income side
  // than about the plan.
  const unknown = sourceCount === 0;

  const tone = unknown
    ? { text: "text-chalk-soft", border: "border-edge", label: "Not known yet" }
    : unplannedCents < 0
    ? { text: "text-vermilion", border: "border-vermilion/60", label: "Over-allocated" }
    : unplannedCents > 0
    ? { text: "text-sulfur", border: "border-edge", label: "Left to plan" }
    : { text: "text-verdant", border: "border-verdant/50", label: "Fully allocated" };

  const allocatedPct =
    expectedIncomeCents > 0 ? Math.round((plannedCents / expectedIncomeCents) * 100) : null;

  const verdict = unknown
    ? "Nothing is expected to come in yet. Add an income source below, and the plan can tell you whether it balances."
    : unplannedCents < 0
    ? `This plan allocates ${formatCents(-unplannedCents)} more than it expects to take in. Trim an estimate, or add the income you are expecting.`
    : unplannedCents > 0
    ? `${formatCents(unplannedCents)} of expected income is not in any category yet.`
    : "Every expected dollar has a category. The plan balances.";

  const unestimated = categoryCount - estimatedCount;

  return (
    <section className={`mb-4 border ${tone.border} bg-panel`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Plan health</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">Per month</span>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour through
          between the tiles, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-3">
        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">Expected income</dt>
          <dd className="mt-1 font-mono text-figure font-medium text-verdant">
            {formatCents(expectedIncomeCents)}
          </dd>
          <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
            {sourceCount === 0
              ? "No sources"
              : `${sourceCount} ${sourceCount === 1 ? "source" : "sources"}, averaged`}
          </dd>
        </div>

        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">Planned expenses</dt>
          <dd className="mt-1 font-mono text-figure font-medium text-chalk">
            {formatCents(plannedCents)}
          </dd>
          <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
            {categoryCount === 0
              ? "No categories"
              : `${estimatedCount} of ${categoryCount} estimated`}
          </dd>
        </div>

        <div className="bg-panel px-4 py-3">
          <dt className="font-mono text-label uppercase text-chalk-soft">{tone.label}</dt>
          <dd className={`mt-1 font-mono text-figure font-medium ${tone.text}`}>
            {unknown ? "—" : formatCents(unplannedCents)}
          </dd>
          <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
            {allocatedPct == null ? "Awaiting income" : `${allocatedPct}% of income allocated`}
          </dd>
        </div>
      </dl>

      {/* Suppressed rather than clamped when nothing is expected: TallyGauge
          reads a non-positive max as a zero ratio, which would draw a
          comfortable empty meter under a plan that has no income behind it. */}
      {expectedIncomeCents > 0 && (
        <div className="border-t border-edge px-4 py-3">
          <TallyGauge
            amount={plannedCents}
            max={expectedIncomeCents}
            label="Planned expenses against expected income"
          />
        </div>
      )}

      {/* A status region rather than an alert: this is on screen from the moment
          the page loads, and an assertive announcement on every keystroke into
          an estimate would talk over the user. */}
      <div role="status" className="border-t border-edge px-4 py-3">
        <p className={`font-sans text-row ${unknown ? "text-chalk-soft" : tone.text}`}>{verdict}</p>
        {unestimated > 0 && (
          <p className="mt-1 font-sans text-row text-chalk-soft">
            {unestimated} {unestimated === 1 ? "category has" : "categories have"} no estimate yet,
            so nothing is set aside for {unestimated === 1 ? "it" : "them"}.
          </p>
        )}
      </div>
    </section>
  );
}
