import { cadenceLabel } from "../recurrence";
import { formatCents, formatDayShort, formatPeriod, periodLTE, toPeriod } from "../utils";
import Button from "./Button";

/**
 * The paycheques the plan is built on, and how they compare with what has
 * actually been logged this month.
 *
 * Every row shows the paydays it found in this month rather than only a total,
 * because the total is the surprising part: a fortnightly source pays $3,000 in
 * most months and $4,500 in the two that hold a third payday, and a figure that
 * changes month to month has to show its working or it reads as a bug.
 */

/** Why a source has no payment this month. Only ever called for empty rows. */
function scheduleNote(row, period) {
  const startPeriod = toPeriod(row.anchorDate);
  const endPeriod = toPeriod(row.endDate);

  if (startPeriod && !periodLTE(startPeriod, period)) return `Starts ${row.anchorDate}`;
  if (endPeriod && periodLTE(endPeriod, period)) return `Ended ${row.endDate}`;
  return "No payment this month";
}

export default function ExpectedIncomeTable({
  period,
  rows,
  expectedIncomeCents,
  recordedIncomeCents,
  outstandingIncomeCents,
  onDelete,
}) {
  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Expected income
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {formatPeriod(period)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No income sources yet. Add the paycheques and other money you expect each month — the plan
          uses them to work out whether your estimates fit inside what you earn.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Source
                </th>
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Cadence
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-label uppercase text-chalk">
                  Per payment
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-label uppercase text-chalk">
                  This month
                </th>
                <th className="w-16 px-4 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const paying = row.dates.length > 0;

                return (
                  <tr key={row.id} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                    <td className="px-4 py-2">
                      <div className="font-sans text-row text-ink">{row.name}</div>
                      <div className="font-mono text-label uppercase text-ink-soft">
                        {paying
                          ? row.dates.map(formatDayShort).join(" · ")
                          : scheduleNote(row, period)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="font-sans text-row text-ink-soft">
                        {cadenceLabel(row.cadence)}
                      </div>
                      {/* A source with an end date still ahead of it explains a
                          drop in expected income months before it happens. */}
                      {row.endDate && paying && (
                        <div className="font-mono text-label uppercase text-ink-soft">
                          Ends {row.endDate}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-row tabular-nums text-ink-soft">
                      {formatCents(row.amountCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <div
                        className={`font-mono text-row tabular-nums ${
                          paying ? "font-medium text-ink" : "text-ink-soft"
                        }`}
                      >
                        {paying ? formatCents(row.expectedCents) : "—"}
                      </div>
                      {row.dates.length > 1 && (
                        <div className="font-mono text-label uppercase text-ink-soft">
                          {row.dates.length} payments
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="row"
                        size="sm"
                        aria-label={`Remove income source: ${row.name}`}
                        onClick={() => onDelete(row)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-band">
                <td colSpan={3} className="px-4 py-2 font-mono text-label uppercase text-ink">
                  Expected this month
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                  {formatCents(expectedIncomeCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* The plan against the books. Recorded income is period-scoped, from the
          same derivation the envelope figures come from, so the two sides of
          this comparison are on the same clock. */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-edge px-4 py-3">
          <span className="font-mono text-label uppercase text-chalk-soft">
            Recorded this month{" "}
            <span className="font-medium text-chalk">{formatCents(recordedIncomeCents)}</span>
          </span>
          <span
            className={`font-mono text-label uppercase ${
              outstandingIncomeCents > 0 ? "text-sulfur" : "text-verdant"
            }`}
          >
            {outstandingIncomeCents > 0
              ? `${formatCents(outstandingIncomeCents)} still expected`
              : outstandingIncomeCents < 0
              ? `${formatCents(-outstandingIncomeCents)} more than expected`
              : "All expected income has arrived"}
          </span>
        </div>
      )}
    </section>
  );
}
