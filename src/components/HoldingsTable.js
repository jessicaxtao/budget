import { Link } from "react-router-dom";
import { ACCOUNT_TYPES } from "../contexts/AccountsContext";
import { describeSource, HOLDING_CLASSES } from "../hooks/useNetWorth";
import { formatCents, formatPeriod } from "../utils";

/**
 * Every account, what it is worth at the selected month, and where that figure
 * came from.
 *
 * The last column is the point of the table. Some of these figures are derived
 * from the ledger and cannot go stale; others were typed in, and one typed in
 * eight months ago is a number the user should not be reading as today's. Saying
 * which is which — and how old the typed ones are, and where a typed one differs
 * from what the books say — is the difference between a balance sheet and a wall
 * of plausible figures.
 *
 * Grouped by band rather than by account scope, because this table sits under
 * the chart and answers "what is inside that green block". The scope split has
 * its own screen: `AccountList`, on Configuration, which is where accounts are
 * added and removed. Nothing is editable here — the one action is to update a
 * month's figures, and it belongs to the page.
 */

const SECTIONS = [
  { band: HOLDING_CLASSES.CASH, label: "Cash", swatch: "bg-verdant" },
  { band: HOLDING_CLASSES.INVESTED, label: "Investments", swatch: "bg-invested" },
  { band: HOLDING_CLASSES.PROPERTY, label: "Property & other", swatch: "bg-property" },
  { band: HOLDING_CLASSES.DEBT, label: "Owed", swatch: "bg-vermilion" },
];

function HoldingRow({ row, period, striped }) {
  // Shared with the update form rather than written twice: the two screens are
  // read against each other, and a figure called current in one and carried
  // forward in the other is worse than either description alone.
  const { text, stale } = describeSource(row, period);
  const owed = row.account.type === ACCOUNT_TYPES.LIABILITY;

  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {row.account.name}
      </th>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
        {/* Debts read as the amount owed, positive, as they do everywhere else
            the user enters or reads one. The sign lives in the maths, not on
            the page. */}
        {formatCents(owed ? -row.valueCents : row.valueCents)}
      </td>
      <td
        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase ${
          stale ? "text-vermilion-ink" : "text-ink-soft"
        }`}
      >
        {text}
      </td>
    </tr>
  );
}

/**
 * Read-only, deliberately. The one action this table could carry — update the
 * month's figures — already sits in the page header, and a second button with
 * the same label further down the same screen makes a reader stop and work out
 * whether the two do the same thing.
 */
export default function HoldingsTable({ rows, period }) {
  let stripe = 0;

  const sections = SECTIONS.map((section) => ({
    ...section,
    rows: rows.filter((row) => row.band === section.band),
  })).filter((section) => section.rows.length > 0);

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Holdings</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {formatPeriod(period)}
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No accounts yet.{" "}
          <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
            Add one on the budget plan
          </Link>{" "}
          — an everyday account, then the retirement and brokerage accounts you want tracked here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Account
                </th>
                <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                  Value
                </th>
                <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                  Source
                </th>
              </tr>
            </thead>

            {sections.map((section) => {
              const subtotal = section.rows.reduce((sum, row) => sum + row.valueCents, 0);
              const owed = section.band === HOLDING_CLASSES.DEBT;
              return (
                <tbody key={section.band}>
                  <tr className="bg-band">
                    <th
                      scope="colgroup"
                      className="px-4 py-1.5 text-left font-mono text-label uppercase text-ink"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 ${section.swatch}`} aria-hidden="true" />
                        {section.label}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink">
                      {formatCents(owed ? -subtotal : subtotal)}
                    </td>
                    <td />
                  </tr>
                  {section.rows.map((row) => (
                    <HoldingRow
                      key={row.account.id}
                      row={row}
                      period={period}
                      striped={stripe++ % 2 === 1}
                    />
                  ))}
                </tbody>
              );
            })}

            {/* Back on the dark chrome, bookending the header: this is the
                page's total rather than another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th scope="row" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                  Net worth
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk">
                  {formatCents(rows.reduce((sum, row) => sum + row.valueCents, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
