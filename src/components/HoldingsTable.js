import { Link } from "react-router-dom";
import { ACCOUNT_TYPES } from "../contexts/AccountsContext";
import { SortableList, useSortableItem } from "./Sortable";
import { HOLDING_CLASSES } from "../hooks/useNetWorth";
import { formatCents, formatPeriod } from "../utils";

/**
 * Every account and what it is worth at the selected month.
 *
 * Two columns and nothing else: a balance sheet is read down its figures, and a
 * column of prose beside every one of them — where the figure came from, how old
 * it is — competed with the money for the eye on every row while being the
 * answer to a question only a couple of rows actually raise. **Where a figure
 * came from is said where a figure is entered**, which is `UpdateBalancesModal`:
 * it prints `describeSource` under each account's figure in force, so a user
 * typing over the ledger can still see the claim they are contradicting, and the
 * page says out loud how many holdings are carrying an old figure forward.
 *
 * What survives here is the one row that has something to *do* — a statement and
 * a ledger figure for the same month that disagree. That is an action rather than
 * a description, it hangs under the account's own name, and it is the only route
 * to `FixDriftModal`.
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

function HoldingRow({ row, striped, onFixDrift, sortable }) {
  const item = useSortableItem(row.account.id, { disabled: !sortable });
  const owed = row.account.type === ACCOUNT_TYPES.LIABILITY;
  // The one row that has something to do: a statement and a ledger figure for
  // the same month that do not agree.
  const settleable = onFixDrift && row.driftCents != null && row.driftCents !== 0;

  return (
    <tr
      ref={item.ref}
      style={item.style}
      {...item.handle}
      className={striped ? "bg-sheet-alt" : "bg-sheet"}
    >
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {row.account.name}
        {/* Under the name rather than in a column of its own, because almost no
            row has one: a column every row carries to serve the few that can
            use it is width spent on blanks. */}
        {settleable && (
          <button
            type="button"
            onClick={() => onFixDrift(row)}
            aria-label={`Settle the ${formatCents(
              Math.abs(row.driftCents)
            )} difference on ${row.account.name}`}
            className="mt-0.5 block text-label uppercase text-vermilion-ink underline decoration-dotted underline-offset-4 transition-colors hover:decoration-solid"
          >
            {formatCents(row.driftCents)} vs ledger · settle
          </button>
        )}
      </th>
      {/* Aligned to the top rather than the middle: the one row that carries a
          settle line under its name is two lines tall, and a figure centred
          against it would sit between the account it belongs to and the note
          under it. Single-line rows are unaffected. */}
      <td
        data-label="Value"
        className="whitespace-nowrap px-3 py-2 align-top text-right font-mono text-row font-medium tabular-nums text-ink"
      >
        {/* Debts read as the amount owed, positive, as they do everywhere else
            the user enters or reads one. The sign lives in the maths, not on
            the page. */}
        {formatCents(owed ? -row.valueCents : row.valueCents)}
      </td>
    </tr>
  );
}

/**
 * Read-only but for one thing.
 *
 * Updating the month's figures is not offered here: it already sits in the page
 * header, and a second button with the same label further down the same screen
 * makes a reader stop and work out whether the two do the same thing. What *is*
 * offered is settling a disagreement this table is the only place to see — a row
 * reading "$20 vs ledger · settle" is the way to deal with the $20. Noticing the
 * gap and closing it are one thought, so they are one click, and the thing that
 * states the gap is the thing that closes it.
 */
/**
 * `onReorder`, where given, lets a row be dragged within its band. The order is
 * the accounts' own, so the chart's slices follow it too.
 */
export default function HoldingsTable({ rows, period, onFixDrift, onReorder }) {
  let stripe = 0;

  const sections = SECTIONS.map((section) => ({
    ...section,
    rows: rows.filter((row) => row.band === section.band),
  })).filter((section) => section.rows.length > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Holdings</h2>
        <span className="text-label uppercase text-chalk-soft">
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
        <div className="scroll-x">
          <table className="stack w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th scope="col" className="px-4 py-2 text-left text-label uppercase text-chalk">
                  Account
                </th>
                <th scope="col" className="px-3 py-2 text-right text-label uppercase text-chalk">
                  Value
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
                      className="px-4 py-1.5 text-left text-label uppercase text-ink"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 ${section.swatch}`} aria-hidden="true" />
                        {section.label}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink">
                      {formatCents(owed ? -subtotal : subtotal)}
                    </td>
                  </tr>
                  <SortableList
                    ids={section.rows.map((row) => row.account.id)}
                    onReorder={onReorder ?? (() => {})}
                  >
                    {section.rows.map((row) => (
                      <HoldingRow
                        key={row.account.id}
                        row={row}
                        striped={stripe++ % 2 === 1}
                        onFixDrift={onFixDrift}
                        sortable={onReorder != null}
                      />
                    ))}
                  </SortableList>
                </tbody>
              );
            })}

            {/* Back on the dark chrome, bookending the header: this is the
                page's total rather than another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th scope="row" className="px-4 py-2 text-left text-label uppercase text-chalk">
                  Net worth
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk">
                  {formatCents(rows.reduce((sum, row) => sum + row.valueCents, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
