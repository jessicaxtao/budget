import { useState } from "react";
import Button from "./Button";
import { spendsThroughBudget } from "../contexts/AccountsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { amountAtRest, amountEditing, formatCents, formatPeriod, toCents } from "../utils";

/**
 * The ledger as a register: one row per movement of money, every field on it
 * editable where it sits.
 *
 * This is the shape a household already knows — the columns of a chequebook
 * stub, or of the spreadsheet this app replaced. Money in and money out get a
 * **column each** rather than one signed figure, which is how a register has
 * always told them apart, and it is also how the direction is edited: type a
 * figure into the other column and the row changes sides. Filing a paycheque as
 * an expense is the mistake that used to cost a delete and a full re-entry.
 *
 * Cells commit on **blur**, the same contract as `CategoryPlanner` and for the
 * same reason: a half-typed "1" on the way to "14" is a real figure, and
 * committing per keystroke would put it through the store. The two selects
 * commit on **change**, because there is nothing to type and the choice is made
 * the moment it is made — and they are controlled, so a value the store refuses
 * simply never appears. Everything else is uncontrolled and keyed on what is
 * stored, so a successful commit re-seeds the cell with what was actually saved
 * and a refused one is put back.
 *
 * Clearing a cell is an **abandoned edit, not a value**. A blank date does not
 * un-date a record and a blank amount is not a transaction of nothing; both put
 * the stored figure back. That is what leaves the keyboard free to select-all
 * and retype without the intermediate empty state meaning anything.
 *
 * Undated rows — the ones folded in from before the ledger tracked dates —
 * belong to no month, so a register that only ever showed one month would put
 * them out of reach forever. They get a band of their own, below the month, and
 * typing a date into one is what files it.
 */

// Header and body cells are driven off one list for the same reason
// `CategoryLedgerTable` does it: the two must not disagree about how many
// columns there are, which is what the band, footer and error rows span.
// Fixed widths, on a `table-fixed` layout, because a register's columns are
// the same width on every row of every month — a grid that resized itself to
// whatever happened to be typed in it would not be one. Each is sized to what
// the column actually holds: a date, a category name, an account name, a figure.
// Description names no width and so takes whatever is left.
const COLUMNS = [
  { key: "date", label: "Date", width: "w-36" },
  { key: "description", label: "Description" },
  { key: "budgetId", label: "Category", width: "w-40" },
  { key: "accountId", label: "Account", width: "w-36" },
  { key: "in", label: "In", width: "w-28", numeric: true },
  { key: "out", label: "Out", width: "w-28", numeric: true },
];

// Everything to the left of the two amount columns, which is what a subtotal
// label spans. Derived rather than written as a number, so reordering the list
// above cannot leave a stale colspan behind.
const LEAD_SPAN = COLUMNS.findIndex((column) => column.numeric);
// The remove button has a column of its own with no heading.
const FULL_SPAN = COLUMNS.length + 1;

const rowBg = (index) => (index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt");

// No rule under a cell at rest. `CategoryPlanner` draws one because it holds
// three fields on a row and they have to read as fields; a register is sixty of
// them, and sixty underlines is a grid of noise laid over the figures the page
// exists to show. The rule appears under the pointer and turns azure under the
// caret, so editability is answered where it is being asked about.
const cellBase =
  "w-full min-w-0 border-0 border-b-2 border-transparent px-0 py-1 font-sans text-row text-ink outline-none transition-colors hover:border-rule focus:border-azure";

const cellInput = `${cellBase} bg-transparent placeholder:text-ink-soft/60`;

const figureInput = `${cellBase} bg-transparent text-right font-mono tabular-nums`;

// A `<select>` with a transparent background paints its option list against
// whatever is behind it — see `Field.js` — which on a zebra table means the
// row's own shade rather than the page's.
const cellSelect = (index) => `${cellBase} ${rowBg(index)}`;

/** What a row is called when something has to be said about it out loud. */
const nameOf = (transaction) => transaction.description || "untitled entry";

/** The two totals a set of rows adds up to, kept apart the way the columns are. */
function totalsOf(transactions) {
  return transactions.reduce(
    (totals, transaction) =>
      transaction.kind === TRANSACTION_KINDS.INFLOW
        ? { ...totals, inCents: totals.inCents + transaction.amountCents }
        : { ...totals, outCents: totals.outCents + transaction.amountCents },
    { inCents: 0, outCents: 0 }
  );
}

/**
 * One direction's amount for a row.
 *
 * Blank in the column that is not this row's direction — which is what makes
 * the register readable at a glance, and what makes typing into that blank the
 * gesture that moves the row across. Keyed on the direction *and* the figure so
 * a commit to either remounts both cells: after a row changes sides, whatever
 * was left in the column it came from has to go with it.
 *
 * **Formatted at rest, raw under the caret** — the spreadsheet's own contract
 * for a money column, and the app's, which is why the two faces come from
 * `amountAtRest` / `amountEditing` rather than from formatting written here. A
 * `<input type="number">` can wear neither: it refuses "$1,234.56" outright and
 * renders $78.40 as "78.4", so a column never lines up on its decimal point.
 * Text plus `inputMode` gets the numeric keypad without the rendering, and
 * `toCents` takes back whatever the field wrote — symbol, separators and all.
 */
function AmountCell({ transaction, kind, onCommit }) {
  const active = transaction.kind === kind;
  const display = active ? amountAtRest(transaction.amountCents) : "";
  const editable = active ? amountEditing(transaction.amountCents) : "";

  function handleBlur(e) {
    const raw = e.target.value.trim();
    const cents = raw === "" ? null : toCents(raw);

    // A blank is an abandoned edit, not a transaction of nothing, and a figure
    // the store already holds is not an edit at all.
    if (cents != null && !(active && cents === transaction.amountCents)) {
      // Naming the column's own direction is what turns an expense filed the
      // wrong way round into the refund it was, and back.
      onCommit(transaction, { kind, amountCents: cents });
    }
    // Whatever happened — committed, refused or abandoned — the cell goes back
    // to reading as money. A successful change remounts it anyway; this is what
    // covers the three cases that do not.
    e.target.value = display;
  }

  return (
    <td className="px-3 py-1">
      <input
        type="text"
        inputMode="decimal"
        key={`${transaction.kind}:${transaction.amountCents}`}
        defaultValue={display}
        aria-label={`${kind === TRANSACTION_KINDS.INFLOW ? "In" : "Out"} for ${nameOf(
          transaction
        )}`}
        onFocus={(e) => {
          e.target.value = editable;
          e.target.select();
        }}
        onBlur={handleBlur}
        className={figureInput}
      />
    </td>
  );
}

function RegisterRow({ transaction, index, budgets, accounts, error, onCommit, onDelete }) {
  const label = nameOf(transaction);
  const isInflow = transaction.kind === TRANSACTION_KINDS.INFLOW;

  // The current value always has an option, even when it is not one the form
  // would offer: an off-budget account, an account since deleted, or the
  // Uncategorized sentinel a deleted category left behind. Without it the
  // select would show its first option instead and the row would appear to have
  // been refiled by simply being looked at.
  const knownBudget = budgets.some((budget) => budget.id === transaction.budgetId);
  const spendable = accounts.filter(spendsThroughBudget);
  const knownAccount = spendable.some((account) => account.id === transaction.accountId);
  const heldAccount = accounts.find((account) => account.id === transaction.accountId);

  function handleDateBlur(e) {
    const next = e.target.value;
    if (next === (transaction.date ?? "")) return;
    if (next === "") {
      e.target.value = transaction.date ?? "";
      return;
    }
    const result = onCommit(transaction, { date: next });
    if (!result.ok) e.target.value = transaction.date ?? "";
  }

  function handleDescriptionBlur(e) {
    if (e.target.value.trim() === transaction.description) {
      e.target.value = transaction.description;
      return;
    }
    const result = onCommit(transaction, { description: e.target.value });
    if (!result.ok) e.target.value = transaction.description;
  }

  return (
    <>
      <tr className={rowBg(index)}>
        <td className="px-3 py-1">
          <input
            type="date"
            key={transaction.date ?? "undated"}
            defaultValue={transaction.date ?? ""}
            aria-label={`Date of ${label}`}
            onBlur={handleDateBlur}
            className={`${cellInput} font-mono`}
          />
        </td>
        <td className="px-3 py-1">
          <input
            type="text"
            key={transaction.description}
            defaultValue={transaction.description}
            placeholder="—"
            aria-label={`Description of ${label}`}
            onBlur={handleDescriptionBlur}
            className={cellInput}
          />
        </td>
        <td className="px-3 py-1">
          <select
            value={transaction.budgetId ?? ""}
            aria-label={`Category of ${label}`}
            onChange={(e) => onCommit(transaction, { budgetId: e.target.value })}
            className={cellSelect(index)}
          >
            {/* Offered on an inflow only, where the blank is a real answer:
                no category means income to assign, a category means a refund
                back into it. On an outflow the store refuses it, so putting it
                on screen would only offer a choice that cannot be made. */}
            {isInflow && <option value="">None — income</option>}
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
            {transaction.budgetId != null && !knownBudget && (
              <option value={transaction.budgetId}>
                {transaction.budgetId === UNCATEGORIZED_BUDGET_ID
                  ? "Uncategorized"
                  : "Unknown category"}
              </option>
            )}
          </select>
        </td>
        <td className="px-3 py-1">
          <select
            value={transaction.accountId ?? ""}
            aria-label={`Account of ${label}`}
            onChange={(e) => onCommit(transaction, { accountId: e.target.value })}
            className={cellSelect(index)}
          >
            {transaction.accountId == null && <option value="">— none</option>}
            {spendable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            {transaction.accountId != null && !knownAccount && (
              <option value={transaction.accountId}>{heldAccount?.name ?? "Unknown account"}</option>
            )}
          </select>
        </td>
        <AmountCell transaction={transaction} kind={TRANSACTION_KINDS.INFLOW} onCommit={onCommit} />
        <AmountCell
          transaction={transaction}
          kind={TRANSACTION_KINDS.OUTFLOW}
          onCommit={onCommit}
        />
        <td className="px-1 py-1 text-right">
          <Button
            variant="row"
            size="sm"
            aria-label={`Remove entry: ${label}`}
            onClick={() => onDelete(transaction)}
          >
            &times;
          </Button>
        </td>
      </tr>
      {/* Under the row rather than beside it, so a rejected edit does not
          change the width of a column the eye is reading down. */}
      {error && (
        <tr className={rowBg(index)}>
          <td colSpan={FULL_SPAN} className="px-3 pb-2">
            <p role="alert" className="font-sans text-row text-vermilion-ink">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/** A subtotal band across the sheet, on the same shade the group bands use. */
function Band({ name, totals }) {
  return (
    <tr className="bg-band">
      <th
        scope="colgroup"
        colSpan={LEAD_SPAN}
        className="px-3 py-1.5 text-left font-mono text-label uppercase text-ink"
      >
        {name}
      </th>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink">
        {formatCents(totals.inCents)}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink">
        {formatCents(totals.outCents)}
      </td>
      <td />
    </tr>
  );
}

export default function TransactionRegister({
  period,
  transactions,
  budgets,
  accounts,
  onChange,
  onDelete,
  onAdd,
}) {
  // One at a time, keyed on the row it belongs to: a rejection is a reply to
  // the edit just made, and a page of stale messages from earlier attempts
  // would say nothing about the cell the user is in.
  const [error, setError] = useState(null);

  function commit(transaction, patch) {
    const result = onChange({ id: transaction.id, ...patch });
    setError(result.ok ? null : { id: transaction.id, message: result.error });
    return result;
  }

  const dated = transactions.filter((transaction) => transaction.date != null);
  const undated = transactions.filter((transaction) => transaction.date == null);
  const totals = totalsOf(dated);

  // The zebra runs across the whole table rather than restarting under the
  // undated band, so two rows of the same shade never end up either side of it.
  let stripe = 0;

  const rowsFor = (entries) =>
    entries.map((transaction) => (
      <RegisterRow
        key={transaction.id}
        transaction={transaction}
        index={stripe++}
        budgets={budgets}
        accounts={accounts}
        error={error?.id === transaction.id ? error.message : null}
        onCommit={commit}
        onDelete={onDelete}
      />
    ));

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Register</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {dated.length} {dated.length === 1 ? "entry" : "entries"} in {formatPeriod(period)}
        </span>
      </div>

      {transactions.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          Nothing recorded in {formatPeriod(period)}.{" "}
          <button
            type="button"
            onClick={onAdd}
            className="text-azure underline underline-offset-2 hover:text-chalk"
          >
            Add a transaction
          </button>{" "}
          and it will appear here, editable where it sits.
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* No `min-width` floor under the grid, tempting as one is: Chrome
              counts a table's min-width against the *document's* scroll width
              even inside an `overflow-x-auto` box, so a floor wide enough to
              keep six columns apart puts a scrollbar under the whole page. The
              fixed layout already holds the columns steady; below the width they
              need, they shrink together rather than the page sliding sideways. */}
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-mono text-label uppercase text-chalk ${
                      column.width ?? ""
                    } ${column.numeric ? "text-right" : "text-left"}`}
                  >
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="w-10 px-1 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>

            <tbody>{rowsFor(dated)}</tbody>

            {/* Money that moved before the ledger recorded when. It belongs to
                no month, so it sits under every one of them rather than
                vanishing from all of them. */}
            {undated.length > 0 && (
              <tbody>
                <Band name="Undated" totals={totalsOf(undated)} />
                {rowsFor(undated)}
              </tbody>
            )}

            {/* Back on the dark chrome, bookending the header: this is the
                month's total, not another band inside the sheet. The two
                accents are the ones tuned for it — on the light rows above,
                the columns themselves carry the direction. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th
                  scope="row"
                  colSpan={LEAD_SPAN}
                  className="px-3 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  {formatPeriod(period)}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-verdant">
                  {formatCents(totals.inCents)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-vermilion">
                  {formatCents(totals.outCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {undated.length > 0 && (
        <p className="border-t border-edge px-4 py-2.5 font-sans text-row text-chalk-soft">
          Undated entries were logged before the ledger recorded dates. They count in every month's
          carried-in figure and in no month's activity — give one a date to file it.
        </p>
      )}
    </section>
  );
}
