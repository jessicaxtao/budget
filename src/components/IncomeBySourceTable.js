import { Link } from "react-router-dom";
import { formatBps, formatCents } from "../utils";

function ShareBar({ cents, maxCents }) {
  const ratio = maxCents > 0 ? Math.max(0, cents) / maxCents : 0;
  return (
    <div className="h-1.5 w-full min-w-[3rem] bg-rule" aria-hidden="true">
      <div className="h-full bg-verdant" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

const headCell = "whitespace-nowrap px-3 py-2 text-right text-label uppercase text-chalk";
const figureCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";
const wideOnly = "hidden sm:table-cell";

function SourceRow({ source, name, maxCents, months, striped }) {
  const amortised = months > 1;

  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {name}
      </th>
      <td className={`${figureCell} font-medium text-ink`}>{formatCents(source.incomeCents)}</td>
      <td className={`w-[22%] px-3 py-2 ${wideOnly}`}>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-right font-mono text-row tabular-nums text-ink-soft">
            {source.shareBps == null ? "—" : formatBps(source.shareBps)}
          </span>
          <ShareBar cents={source.incomeCents} maxCents={maxCents} />
        </div>
      </td>
      {amortised && (
        <td className={`${figureCell} text-ink`}>{formatCents(source.averageCents)}</td>
      )}
    </tr>
  );
}

export default function IncomeBySourceTable({ report, payeeName }) {
  const { incomeSources, totalIncomeCents, averageIncomeCents, averagedOverMonths } = report;
  const maxCents = incomeSources.reduce((max, source) => Math.max(max, source.incomeCents), 0);
  const amortised = averagedOverMonths > 1;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Where the money came from
        </h2>
        <span className="text-label uppercase text-chalk-soft">
          {amortised
            ? `Per month is over ${averagedOverMonths} months of records`
            : "One month of records"}
        </span>
      </div>

      {incomeSources.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No income was recorded in this window.{" "}
          <Link
            to="/transactions"
            className="text-azure underline underline-offset-2 hover:text-chalk"
          >
            Record what has been coming in
          </Link>{" "}
          and it will be listed here.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left text-label uppercase text-chalk">
                  Source
                </th>
                <th scope="col" className={headCell}>
                  Received
                </th>
                <th
                  scope="col"
                  className={`px-3 py-2 text-left text-label uppercase text-chalk ${wideOnly}`}
                >
                  Share
                </th>
                {amortised && (
                  <th scope="col" className={headCell}>
                    Per month
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {incomeSources.map((source, index) => (
                <SourceRow
                  key={source.payeeId ?? "__null__"}
                  source={source}
                  name={payeeName(source.payeeId) ?? "No payer named"}
                  maxCents={maxCents}
                  months={averagedOverMonths}
                  striped={index % 2 === 1}
                />
              ))}
            </tbody>

            <tfoot>
              <tr className="bg-panel-raised">
                <th scope="row" className="px-4 py-2 text-left text-label uppercase text-chalk">
                  All income
                </th>
                <td className={`${figureCell} font-medium text-chalk`}>
                  {formatCents(totalIncomeCents)}
                </td>
                <td className={`px-3 py-2 ${wideOnly}`}>
                  <span className="block w-12 text-right font-mono text-row tabular-nums text-chalk-soft">
                    {totalIncomeCents > 0 ? formatBps(10000) : "—"}
                  </span>
                </td>
                {amortised && (
                  <td className={`${figureCell} font-medium text-chalk`}>
                    {formatCents(averageIncomeCents)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
