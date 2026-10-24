import { useMemo, useState } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { occurrencesBetween } from "../domain/recurrence";
import useAccountBalances from "../hooks/useAccountBalances";
import {
  addMonths,
  currentPeriod,
  formatCents,
  formatPeriod,
  periodEnd,
} from "../utils";

/**
 * Forward-looking cashflow projection built entirely from schedules.
 *
 * The rest of the reports page looks backward — what the books have recorded.
 * This widget looks forward: given what is already scheduled, what will each
 * of the next twelve months bring in and send out, and how does today's
 * on-budget balance evolve through it?
 *
 * **Schedules only, not predictions.** The running balance is pure accounting
 * of what is already on the books as expected — rent, salary, subscriptions —
 * not a forecast of discretionary spending. That distinction is stated in the
 * footer so a household does not read the running figure as a promise. The
 * historical average from the report is carried separately as a runway figure
 * that does account for all spending.
 *
 * **Starts from next month.** Today's on-budget balance already includes every
 * transaction recorded in the current month. Projecting scheduled items for the
 * current month on top of that balance would count them twice — once through
 * the actual transactions that may already be in the ledger, and again through
 * the schedule. Starting from next month avoids that entirely.
 */

/** Months of scheduled cashflow to show ahead of today. */
const PROJECTION_MONTHS = 12;

export default function CashflowCalendarWidget({ report }) {
  const { schedules } = useSchedules();
  // Read once so today and all derived figures stay in agreement throughout.
  const [today] = useState(currentPeriod);
  // On-budget balance as of the current period — the figure the running
  // balance projection starts from, and the same one the dashboard shows.
  const accountBalances = useAccountBalances(today);

  const projection = useMemo(() => {
    const startBalance = accountBalances.onBudgetCents;
    let runningBalance = startBalance;
    const months = [];

    for (let i = 1; i <= PROJECTION_MONTHS; i++) {
      const period = addMonths(today, i);
      const from = `${period}-01`;
      const to = periodEnd(period);

      let scheduledIncomeCents = 0;
      let scheduledExpenseCents = 0;

      for (const schedule of schedules) {
        const occurrences = occurrencesBetween(schedule, from, to);
        for (let occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
          if (schedule.kind === TRANSACTION_KINDS.INFLOW) {
            scheduledIncomeCents += schedule.amountCents;
          } else {
            scheduledExpenseCents += schedule.amountCents;
          }
        }
      }

      const scheduledNetCents = scheduledIncomeCents - scheduledExpenseCents;
      runningBalance += scheduledNetCents;

      months.push({
        period,
        scheduledIncomeCents,
        scheduledExpenseCents,
        scheduledNetCents,
        runningBalanceCents: runningBalance,
      });
    }

    return { startBalance, months };
  }, [schedules, accountBalances.onBudgetCents, today]);

  // Runway from the historical average monthly net. Null until there are at
  // least two covered months — a single month's net is too volatile to divide
  // by, and dividing by one is the one case where "per month" reads as the
  // period itself rather than a rate.
  const runway = useMemo(() => {
    if (!report || report.averagedOverMonths < 2) return null;
    const avgNetCents = report.averageNetCents;
    if (avgNetCents >= 0) return { sustainable: true };
    if (projection.startBalance <= 0) return { sustainable: false, months: 0 };
    return {
      sustainable: false,
      months: Math.floor(projection.startBalance / Math.abs(avgNetCents)),
    };
  }, [report, projection.startBalance]);

  const hasSchedules = schedules.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
            Cashflow calendar
          </h2>
          <span className="text-label uppercase text-chalk-soft">
            {formatCents(projection.startBalance)} on-budget today
          </span>
        </div>
        {runway != null && (
          <span
            className={`text-label uppercase ${
              runway.sustainable ? "text-chalk-soft" : "text-sulfur"
            }`}
          >
            {runway.sustainable
              ? "Positive cashflow trajectory"
              : runway.months === 0
              ? "Balance already depleted at historical rate"
              : `~${runway.months} month${runway.months === 1 ? "" : "s"} runway at historical rate`}
          </span>
        )}
      </div>

      {!hasSchedules ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No schedules have been set up yet. Add recurring income and expense schedules on the plan
          page and they will be projected here month by month.
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-panel-raised px-4 py-2 text-left text-label uppercase text-chalk"
                >
                  Month
                </th>
                {["Scheduled in", "Scheduled out", "Net", "Running balance"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap bg-panel-raised px-3 py-2 text-right text-label uppercase text-chalk"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projection.months.map((month, index) => (
                <tr key={month.period} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                  >
                    {formatPeriod(month.period)}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                    {month.scheduledIncomeCents === 0 ? "—" : formatCents(month.scheduledIncomeCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                    {month.scheduledExpenseCents === 0
                      ? "—"
                      : formatCents(month.scheduledExpenseCents)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                      month.scheduledNetCents < 0
                        ? "text-vermilion-ink"
                        : month.scheduledNetCents > 0
                        ? "text-ink"
                        : "text-ink-soft"
                    }`}
                  >
                    {month.scheduledNetCents === 0 ? "—" : formatCents(month.scheduledNetCents)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                      month.runningBalanceCents < 0 ? "text-vermilion-ink" : "text-ink"
                    }`}
                  >
                    {formatCents(month.runningBalanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft">
        Running balance starts from today&apos;s on-budget total and applies scheduled income and
        expenses only — unscheduled discretionary spending is not projected.
        {runway != null && !runway.sustainable && report && (
          <>
            {" "}
            The runway figure uses the historical average of{" "}
            {formatCents(Math.abs(report.averageNetCents))} per month over{" "}
            {report.averagedOverMonths} months and includes all spending.
          </>
        )}
      </p>
    </>
  );
}
