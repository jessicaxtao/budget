import { useState } from "react";
import { Link } from "react-router-dom";
import CashflowChart from "../components/CashflowChart";
import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";
import ReportSummary from "../components/ReportSummary";
import SegmentedControl from "../components/SegmentedControl";
import SpendingByCategoryTable from "../components/SpendingByCategoryTable";
import useSpendingReport, {
  DEFAULT_REPORT_RANGE,
  REPORT_RANGES,
} from "../hooks/useSpendingReport";
import { currentPeriod, formatCents, formatPeriod } from "../utils";

/**
 * What the books have been doing — over a span, which is what makes it a report.
 *
 * Every other screen in the app answers a question about one moment: what is in
 * the envelopes now, what the accounts hold at the end of this month, what the
 * plan intends in a typical month. This one is the only place a run of months is
 * the subject, and the reason is that the questions on it cannot be answered
 * from a single month. Whether a category is overspent is a question about
 * August; whether the estimate against it is *wrong* is a question about the
 * year, and the two want different tools.
 *
 * **One control, and it sets the span.** The range picker in the header is the
 * only thing on the page that changes what is shown, and everything below moves
 * with it together — the headline figures, the columns, the ranking, and the
 * divisor under every per-month figure. There is deliberately no second control
 * for the end month: walking the window backwards is what the presets already do
 * from the other end, and a report ending in the past is a different tool from
 * the one this page is. The window always ends at the current month, which is
 * why the last column is a month still in progress.
 *
 * **The cashflow chart and the category table cut the same books along different
 * axes and neither repeats the other.** The chart is the time axis: what came in
 * and what went out, month by month, with what was left traced across it. The
 * table is the category axis over that whole window: where the money went, in
 * order, and what that works out at per month. What the chart cannot show is
 * which categories the down-columns are made of; what the table cannot show is
 * when any of it happened.
 */

/**
 * The two figures a per-month cell is not.
 *
 * Kept here rather than in the hook because they are a caption rather than a
 * derivation: the hook already reports how many months it divided by, and this
 * is the sentence that says so where a reader will actually see it.
 */
function coverageNote(report) {
  if (report.averagedOverMonths === report.months.length) return null;
  return `Records start in ${formatPeriod(report.coverageStartPeriod)}, so per-month figures are divided by ${report.averagedOverMonths} rather than ${report.months.length}.`;
}

export default function ReportsPage() {
  const [rangeKey, setRangeKey] = useState(DEFAULT_REPORT_RANGE);
  // Read once, so the window's end and every month in it come from the same
  // reading of the calendar.
  const [endPeriod] = useState(currentPeriod);

  const report = useSpendingReport(endPeriod, rangeKey);
  const coverage = coverageNote(report);

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Spending reports"
        description="What came in, what went out, and where it went — read over a run of months rather than one. Per-month figures spread the whole window evenly, so a premium paid once a year sits beside the rent as the monthly rate it really is."
        actions={
          <SegmentedControl
            label="How far back the report reaches"
            options={REPORT_RANGES.map((range) => ({ value: range.key, label: range.label }))}
            value={rangeKey}
            onChange={setRangeKey}
          />
        }
      />

      {!report.hasLedger ? (
        <section className="border border-edge bg-panel">
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            Nothing has been recorded yet.{" "}
            <Link
              to="/transactions"
              className="text-azure underline underline-offset-2 hover:text-chalk"
            >
              Start the register
            </Link>{" "}
            — every report here is the ledger read back, so the first month of entries is the first
            month there is anything to say.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <ReportSummary report={report} />

          {(coverage || report.undatedCount > 0) && (
            <div className="space-y-2">
              {coverage && (
                <p className="border border-edge bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                  {coverage}
                </p>
              )}
              {/* Money the report cannot place. An undated record belongs to no
                  month, so putting it in one would invent the history the books
                  deliberately refuse to invent — but a figure missing from a
                  chart has to be visible as missing rather than left for the
                  reader to find against the register. */}
              {report.undatedCount > 0 && (
                <p className="border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
                  <span className="font-medium text-sulfur">
                    {report.undatedCount}{" "}
                    {report.undatedCount === 1 ? "record has" : "records have"} no date
                  </span>{" "}
                  — {formatCents(report.undatedSpentCents)} of spending and{" "}
                  {formatCents(report.undatedIncomeCents)} of income — so they are in no month and
                  in nothing below.{" "}
                  <Link
                    to="/transactions"
                    className="text-azure underline underline-offset-2 hover:text-chalk"
                  >
                    Date them on the register
                  </Link>{" "}
                  and they will appear here.
                </p>
              )}
            </div>
          )}

          <section className="border border-edge bg-panel">
            {/* No span of months in the corner, unlike the net-worth chart's
                header: there the summary above is one month and the chart is a
                window, so the window has to be named. Here the summary *is* the
                window, and printing the same two months a second time on the
                same screen makes a reader stop and check whether they differ. */}
            <div className="border-b border-edge px-4 py-3">
              <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                Month by month
              </h2>
            </div>

            <CashflowChart series={report.series} />

            {/* The chart's table twin. Every figure it draws is also readable
                here, which is what makes the colour encoding safe — and what
                stops the read-out being the only route to a value. A decade of
                rows scrolls inside the card rather than pushing the page down,
                so the header stays put and every column keeps its name. */}
            <details className="border-t border-edge">
              <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                Show these figures as a table
              </summary>
              <div className="max-h-[30rem] overflow-auto border-t border-edge">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-panel-raised px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                      >
                        Month
                      </th>
                      {["Income", "Spending", "Refunded", "Net"].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.series.map((month, index) => (
                      <tr
                        key={month.period}
                        className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                      >
                        <th
                          scope="row"
                          className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                        >
                          {formatPeriod(month.period)}
                        </th>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                          {formatCents(month.incomeCents)}
                        </td>
                        {/* Net of refunds, as the chart draws it — the gross
                            figure is the column beside it, so the row shows its
                            own arithmetic rather than asking to be trusted. */}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                          {formatCents(month.netSpentCents)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                          {month.refundCents === 0 ? "—" : formatCents(month.refundCents)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                            month.netCents < 0 ? "text-vermilion-ink" : "text-ink"
                          }`}
                        >
                          {formatCents(month.netCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-panel-raised">
                      <th
                        scope="row"
                        className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                      >
                        {report.months.length} months
                      </th>
                      {[
                        report.totalIncomeCents,
                        report.netSpentCents,
                        report.totalRefundCents,
                        report.netCents,
                      ].map((cents, index) => (
                        <td
                          key={index}
                          className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk"
                        >
                          {formatCents(cents)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          </section>

          <SpendingByCategoryTable report={report} />

          <Placeholder
            title="Still to come"
            items={[
              "Drill into a category to see the transactions behind its figure",
              "A category against its own history, month by month",
              "A custom start and end month, for a report that does not run to today",
              "Filter by whether a transaction is recurring",
              "Export the underlying rows as CSV",
            ]}
          />
        </div>
      )}
    </>
  );
}
