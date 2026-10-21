import { Link } from "react-router-dom";
import { formatCents, formatDateMedium, formatDayDelta, formatPeriod } from "../utils";
import TallyGauge from "./TallyGauge";

/**
 * The four figures the dashboard exists to answer, and one meter under them.
 *
 * What is left to budget, what has been budgeted, what has been spent, and when
 * the next paycheque lands. The first three are this month's cut of the books;
 * the fourth is the only thing on the panel that is not, and it is here because
 * the question the other three raise — is what is left going to last — cannot be
 * answered without it.
 *
 * The meter is spend against *funded*, not against budgeted. Money assigned in
 * an earlier month and carried in is just as spendable as money assigned this
 * month, so a meter against this month's assignments alone would show a
 * household living out of its envelopes as if it were over budget.
 */

// The same three tones the rest of the app uses for this figure, so a user who
// has read the Transactions page reads this one the same way: money with no job
// yet needs a decision, money over-assigned is an error, and zero is the goal.
function availableTone(cents) {
  if (cents < 0) return { text: "text-vermilion", label: "Over-assigned" };
  if (cents > 0) return { text: "text-sulfur", label: "Unassigned" };
  return { text: "text-verdant", label: "All assigned" };
}

/**
 * The month's budgeting against the plan's total estimate — the one funding
 * reading on the dashboard. The household budgets to an overall figure and
 * does not mind how it is split, so this is asked of the month as a whole and
 * never of a category: yellow while the month is budgeted below the plan.
 */
function budgetedTone(budgetedCents, plannedCents, categoryCount) {
  if (plannedCents <= 0) {
    return {
      text: "text-azure",
      note:
        categoryCount === 0
          ? "No categories"
          : `Across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}`,
    };
  }
  if (budgetedCents < plannedCents) {
    return {
      text: "text-sulfur",
      note: `${formatCents(plannedCents - budgetedCents)} short of the ${formatCents(plannedCents)} plan`,
    };
  }
  if (budgetedCents > plannedCents) {
    return {
      text: "text-azure",
      note: `${formatCents(budgetedCents - plannedCents)} over the ${formatCents(plannedCents)} plan`,
    };
  }
  return { text: "text-azure", note: `Matches the ${formatCents(plannedCents)} plan` };
}

function Tile({ label, figure, tone = "text-chalk", note }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-sans text-xs font-medium text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-figure font-medium tabular-nums ${tone}`}>{figure}</dd>
      <dd className="mt-0.5 font-sans text-xs text-chalk-soft">
        {note}
      </dd>
    </div>
  );
}

export default function DashboardSummary({
  period,
  availableToBudgetCents,
  assignedAheadCents = 0,
  periodIncomeCents,
  budgetedCents,
  plannedCents = 0,
  spentCents,
  refundCents,
  fundedCents,
  categoryCount,
  paycheck,
}) {
  const tone = availableTone(availableToBudgetCents);
  const budgeted = budgetedTone(budgetedCents, plannedCents, categoryCount);

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          {formatPeriod(period)}
        </h2>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour through
          between the tiles, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Available to budget"
          figure={formatCents(availableToBudgetCents)}
          tone={tone.text}
          /* The tone word first, then what is missing from the figure. Money
             given to a month ahead is still in the accounts and no longer
             free, and a pool that shrank without a transaction to explain it
             has to say why where it is stated. "Assigned ahead" is the one
             wording, shared with `ToBeAssignedBar` and `AssignIncomeModal`;
             `whitespace-nowrap` so the break falls between the two clauses
             rather than between the figure and what it is. */
          note={
            assignedAheadCents > 0 ? (
              <>
                {tone.label} ·{" "}
                <span className="whitespace-nowrap">
                  {formatCents(assignedAheadCents)} assigned ahead
                </span>
              </>
            ) : (
              tone.label
            )
          }
        />
        <Tile
          label="Budgeted this month"
          figure={formatCents(budgetedCents)}
          tone={budgeted.text}
          note={budgeted.note}
        />
        {/* Net of refunds: money paid back into a category undoes that much of
            what it spent, which is how the category's own row already reads it
            — spend $100 on dinner, be paid back $60, and the month cost $40.
            The refund is still named underneath, so the gross figure a
            statement shows is one addition away. */}
        <Tile
          label="Spent this month"
          figure={formatCents(spentCents)}
          tone="text-vermilion"
          note={
            refundCents > 0
              ? `After ${formatCents(refundCents)} refunded`
              : `${formatCents(periodIncomeCents)} came in`
          }
        />
        {paycheck.configured ? (
          <Tile
            label="Next paycheck"
            figure={formatDayDelta(paycheck.daysUntil)}
            tone={paycheck.daysUntil <= 1 ? "text-verdant" : "text-chalk"}
            note={`${formatDateMedium(paycheck.nextDate)} · ${paycheck.summary}`}
          />
        ) : (
          <div className="bg-panel px-4 py-3">
            <dt className="font-sans text-xs font-medium text-chalk-soft">Next paycheck</dt>
            <dd className="mt-1 font-mono text-figure font-medium text-chalk-soft">—</dd>
            <dd className="mt-0.5 font-sans text-xs text-chalk-soft">
              <Link
                to="/plan"
                className="text-azure underline underline-offset-2 hover:text-chalk"
              >
                Set a pay schedule
              </Link>{" "}
              to count down to it.
            </dd>
          </div>
        )}
      </dl>

      {/* Suppressed rather than clamped when nothing is funded: TallyGauge reads
          a non-positive max as a zero ratio, which would draw a comfortable
          empty meter over envelopes that are empty or overdrawn. */}
      {fundedCents > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge px-4 py-3">
          <TallyGauge
            amount={spentCents}
            max={fundedCents}
            label="Spent this month against the money sitting in envelopes"
          />
          <span className="font-sans text-xs text-chalk-soft">
            {formatCents(spentCents)} spent of {formatCents(fundedCents)} in envelopes
          </span>
        </div>
      )}
    </section>
  );
}
