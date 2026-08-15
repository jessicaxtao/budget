import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import HoldingsTable from "../components/HoldingsTable";
import NetWorthChart from "../components/NetWorthChart";
import NetWorthSummary from "../components/NetWorthSummary";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import Placeholder from "../components/Placeholder";
import SegmentedControl from "../components/SegmentedControl";
import UpdateBalancesModal from "../components/UpdateBalancesModal";
import useNetWorth, { DEFAULT_CHANGE_RANGE } from "../hooks/useNetWorth";
import { currentPeriod, formatCents, formatPeriod } from "../utils";

/**
 * The balance-sheet view: what is owned, what is owed, and how the gap between
 * them moves.
 *
 * **This page has a month on it, and the dashboard deliberately does not.** The
 * dashboard answers "where am I right now" from figures that derive themselves;
 * half of what is on this page is typed in, once a month, and the month it was
 * typed for is the whole meaning of the figure. The stepper is therefore not
 * only a way of looking back — it is how a month gets entered late, which is
 * what "backfill" is here: step to March, update, step forward. There is no
 * separate mode, because a month entered late and a month entered on time are
 * the same record.
 *
 * **Three controls, three different questions, and none of them is the others.**
 * The stepper picks the month everything on the page is *as of*. The chart's
 * span picks how much history is drawn behind it. The summary's span picks how
 * far back the headline change measures. Tying any two together would be tidier
 * and wrong: a reader comparing this month against a decade ago is not asking
 * for a decade of columns, and one studying a year of detail still wants the
 * ten-year figure beside it.
 *
 * Allocation across asset classes is still a placeholder. The band split in the
 * summary — cash, investments, property, debt — is the coarse cut that answers
 * "what kind of money is this"; a target allocation with drift is a different
 * question and wants its own figures to compare against.
 */

/**
 * How much history the chart can draw.
 *
 * Years rather than months, because past a year nobody thinks in months — and
 * the steps are the ones a household measures itself in: this year, since the
 * car, since the mortgage, since the start. Ten is the ceiling because a
 * hundred and twenty columns is where a month stops being resolvable at the
 * width this card gets.
 */
const CHART_SPANS = [
  { value: 1, label: "1Y" },
  { value: 2, label: "2Y" },
  { value: 5, label: "5Y" },
  { value: 10, label: "10Y" },
];

export default function NetWorthPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [years, setYears] = useState(1);
  const [range, setRange] = useState(DEFAULT_CHANGE_RANGE);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const { chartSeries, slices, current, rows, tracked, changes, windowStartPeriod } = useNetWorth(
    period,
    { months: years * 12 }
  );

  const hasAccounts = rows.length > 0;

  // Holdings nobody has valued in the month on screen. The whole workflow this
  // page serves is a monthly pass over these, so being one short is the thing
  // worth saying out loud rather than leaving the user to spot in a table.
  //
  // Only the hand-valued ones can be short: an everyday account with no figure
  // for the month is not waiting on one, it is answered by the books. That is
  // `needsUpdate`, decided in the hook so this page and the form agree.
  const staleCount = tracked.filter((row) => row.needsUpdate).length;

  return (
    <>
      <PageHeader
        eyebrow="Position"
        title="Net worth"
        description="What you own, what you owe, and how the gap between them moves. Record what each account was worth at the end of the month; anything you leave blank falls back to the ledger for the accounts you spend through, and to its last figure for the ones you value by hand. Step back a month to fill in one you missed, or fill in a run of past months on the budget plan."
        actions={
          <>
            <PeriodStepper period={period} onChange={setPeriod} />
            <Button
              variant="primary"
              disabled={tracked.length === 0}
              onClick={() => setShowUpdateModal(true)}
            >
              Update balances
            </Button>
          </>
        }
      />

      {!hasAccounts ? (
        <section className="border border-edge bg-panel">
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            No accounts yet.{" "}
            <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
              Add them on the budget plan
            </Link>{" "}
            — the everyday accounts you spend from, then the off-budget ones you want valued here:
            a 401(k), a brokerage, the house, the mortgage against it.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <NetWorthSummary
            period={period}
            current={current}
            changes={changes}
            range={range}
            onRangeChange={setRange}
          />

          {staleCount > 0 && (
            <p className="border border-sulfur/50 bg-panel px-4 py-3 font-sans text-row text-chalk-soft">
              <span className="font-medium text-sulfur">
                {staleCount} {staleCount === 1 ? "holding has" : "holdings have"} no figure for{" "}
                {formatPeriod(period)}.
              </span>{" "}
              They are carrying their previous value forward until you update them.
            </p>
          )}

          <section className="border border-edge bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
              <div>
                <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                  Over time
                </h2>
                <span className="font-mono text-label uppercase text-chalk-soft">
                  {formatPeriod(windowStartPeriod)} – {formatPeriod(period)}
                </span>
              </div>
              <SegmentedControl
                label="How far back the chart reaches"
                options={CHART_SPANS}
                value={years}
                onChange={setYears}
              />
            </div>

            <NetWorthChart series={chartSeries} slices={slices} />

            {/* The chart's table twin. Every figure it draws is also readable
                here, which is what makes the colour encoding safe — and what
                stops the tooltip being the only route to a value. A decade of
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
                      {slices.map((slice) => (
                        <th
                          key={slice.key}
                          scope="col"
                          className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                        >
                          {slice.label}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 text-right font-mono text-label uppercase text-chalk"
                      >
                        Net worth
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartSeries.map((entry, index) => (
                      <tr key={entry.period} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                        <th
                          scope="row"
                          className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
                        >
                          {formatPeriod(entry.period)}
                        </th>
                        {/* Signed, unlike everywhere else a debt is read: these
                            columns are terms in the sum at the end of the row,
                            and a mortgage printed as a positive figure would
                            leave the row not adding up to the net worth beside
                            it — which is the one thing this table is for. The
                            colour is what carries "this one subtracts". */}
                        {slices.map((slice) => {
                          const cents = entry.values[slice.key] ?? 0;
                          return (
                            <td
                              key={slice.key}
                              className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
                                cents < 0 ? "text-vermilion-ink" : "text-ink"
                              }`}
                            >
                              {formatCents(cents)}
                            </td>
                          );
                        })}
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums ${
                            entry.netCents < 0 ? "text-vermilion-ink" : "text-ink"
                          }`}
                        >
                          {formatCents(entry.netCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <HoldingsTable rows={rows} period={period} />

          <Placeholder
            title="Asset allocation"
            items={[
              "Current allocation across asset classes, finer than the bands above",
              "Target allocation with drift from target",
              "Allocation mix over time",
            ]}
          />
        </div>
      )}

      <UpdateBalancesModal
        show={showUpdateModal}
        period={period}
        tracked={tracked}
        handleClose={() => setShowUpdateModal(false)}
      />
    </>
  );
}
