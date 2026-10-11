import { useRef, useState } from "react";
import Button from "./Button";
import PayeeField from "./PayeeField";
import { insideBudget, spendsThroughBudget } from "../contexts/AccountsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { isSplit, isTransfer, TRANSACTION_KINDS } from "../contexts/TransactionsContext";
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
 * **A transfer row is the one that does not work that way.** It has no direction
 * to change sides on — its direction is its pair of accounts — so it takes the Out
 * column, its In cell is a dash rather than an empty input, and both of its
 * accounts sit stacked in the Account cell where the other rows carry one. Whether
 * it has a category to file is not the user's choice either: only a transfer
 * leaving the budget comes out of an envelope, so the rest show a dash there too.
 * Both rules are read off `insideBudget`, the same predicate
 * `AddTransactionModal` and `budgetLegs` ask, so no two screens can disagree about
 * one row.
 *
 * **A split row is the other one that does not.** Its category is not one
 * answer but several, and its figure is whatever those add up to, so neither
 * cell can be edited where it sits: a part typed down on its own would leave the
 * division short of the whole, and the store would refuse it every time. Both
 * cells become buttons onto `SplitTransactionModal`, where the total and the
 * parts move together and commit at once. The column it is not in is a dash, for
 * the transfer's reason — a figure typed there would be asking for a direction
 * change the parts cannot follow.
 *
 * **The Payee column holds two fields, not one.** Who the money went to is the
 * row's subject and is named through `PayeeField`, which searches the payee list
 * as the letters go in and offers to create one that is not there yet; the note
 * beside it is what the single free-text column used to be, and is where every
 * row written before payees existed still carries its text. They share one column
 * because the six fixed widths already come to 712px and the grid has to stay
 * inside its container at 768px — the same arithmetic that put both ends of a
 * transfer in the Account cell. Naming a payee here **never** re-files the row's
 * category, even where the payee has a default one: that default seeds a new
 * transaction, and money already filed is not moved because a name was corrected.
 *
 * **Which of the two is drawn is `nameOf`'s own rule, applied to the layout.**
 * The note is a remark *beside* a name, not a second name, so where a payee
 * already names the row the note folds into one mark at the end of it: a comment
 * icon, drawn only when there is something to read, the note itself on hover, and
 * the field to edit it on a click. Sixty rows each carrying an empty second line
 * inviting a note is sixty invitations to write something nobody wanted to write,
 * and it costs the register the one-line row it is read in. **Where no payee names
 * the row the note is on the face of it**, as it always was — which is every row
 * written before payees existed, and every transfer, since a transfer moves money
 * between the household's own accounts and has no other end to name. That is the
 * same precedence `nameOf` reads, so what identifies a row and what is drawn on it
 * cannot come apart.
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
 *
 * **A tick box leads every row and a running balance can end it.** The first is
 * always there, because selecting rows is how forty of them are refiled at once
 * and a mode that had to be turned on first is a mode nobody finds; the header's
 * box ticks everything *shown*, which is the only thing it can honestly offer.
 * The second is drawn only when the rows are one account's — see `columnsFor` for
 * the arithmetic that makes those two columns a pair that trade places, and
 * `runningBalances` in `useAccountBalances.js` for why the figure is the ledger's
 * own order rather than the order on screen.
 */

// Header and body cells are driven off one list for the same reason
// `CategoryLedgerTable` does it: the two must not disagree about how many
// columns there are, which is what the band, footer and error rows span.
// Fixed widths, on a `table-fixed` layout, because a register's columns are
// the same width on every row of every month — a grid that resized itself to
// whatever happened to be typed in it would not be one. Each is sized to what
// the column actually holds: a date, a category name, an account name, a figure.
// Description names no width and so takes whatever is left.
/**
 * The columns, which is **almost** the same list on every row of every month.
 *
 * A function of one question rather than a constant, because the running balance
 * and the Account cell are the one pair that cannot both be on the grid: the six
 * fixed widths already come to 712px, the tick box takes 32 more, and another
 * `w-28` would put the sum past the 768px container the whole layout is sized to.
 *
 * **They are the pair to trade precisely because they are never both wanted.** A
 * running balance only means anything against one account — a column of figures
 * mixing a current account and a credit card is a column of nothing — so it is
 * drawn only when the filter names exactly one, which is the one case where the
 * Account cell is repeating on sixty rows what the filter bar already says once.
 * The cost is stated rather than worked around: while that column is on, a
 * transfer's two accounts cannot be re-pointed where they sit, and clearing the
 * account filter is what brings them back.
 *
 * The balance goes at the **far right**, after the two amount columns, because
 * that is where a chequebook stub carries it and where the eye adds down.
 */
const columnsFor = (showBalance) => [
  // No heading: a tick box in a header cell would want a name, and the name is
  // the control itself — see the select-all below.
  { key: "select", label: "", width: "w-8" },
  { key: "date", label: "Date", width: "w-36" },
  // Two fields in one column, which is the transfer's own precedent applied
  // again: the six fixed widths already come to 712px and the grid has to stay
  // inside its container at 768px, so a seventh column is not available. The
  // payee leads because it identifies the row; the note is the mark after it.
  { key: "payee", label: "Payee & note" },
  { key: "budgetId", label: "Category", width: "w-40" },
  ...(showBalance ? [] : [{ key: "accountId", label: "Account", width: "w-36" }]),
  { key: "in", label: "In", width: "w-28", numeric: true },
  { key: "out", label: "Out", width: "w-28", numeric: true },
  ...(showBalance ? [{ key: "balance", label: "Balance", width: "w-28", numeric: true }] : []),
];

// Everything to the left of the two amount columns, which is what a subtotal
// label spans, and everything to the right of them, which a subtotal has nothing
// to say about. Both derived rather than written as numbers, so moving a column
// cannot leave a stale colspan behind — and the balance column is deliberately
// in the second: a running balance is a figure about one row, not a sum of the
// rows above it, and a total drawn under it would be the one number on the grid
// that means nothing at all.
const spansOf = (columns) => {
  const lead = columns.findIndex((column) => column.numeric);
  // Every column but the lead and the two amounts — the balance, where it is
  // drawn, and the remove button, which has a column of its own with no heading.
  return { lead, trail: columns.length - lead - 2 + 1, full: columns.length + 1 };
};

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
// `truncate` is on the selects and deliberately not on `cellBase`: a fixed
// 144px column cannot hold "Everyday checking", and a select clips the
// overflow mid-glyph by default — "Everyday checkii", which reads as a
// rendering fault rather than as a name that did not fit. An input must not
// have it, since it scrolls its own content while the caret is in it.
const cellSelect = (index) => `${cellBase} ${rowBg(index)} truncate`;

/**
 * The mark that says this row carries a note.
 *
 * Filled where there is a note to read and an outline where there is not, so the
 * two states are told apart by weight rather than by presence alone — the empty
 * one is only on screen while the row is under the pointer, and a reader who
 * finds it there has to be able to see at a glance that it is an invitation
 * rather than something they have missed.
 */
function NoteIcon({ filled }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <path
        d="M3.25 2.5H12.75A1.75 1.75 0 0 1 14.5 4.25V9.75A1.75 1.75 0 0 1 12.75 11.5H7.5L4.5 14V11.5H3.25A1.75 1.75 0 0 1 1.5 9.75V4.25A1.75 1.75 0 0 1 3.25 2.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The icon sits at the end of the payee's own line, so it takes the line's
// baseline and none of its width. A note to read keeps it on screen; an empty
// one appears with the pointer — and on a touch screen, where there is no
// pointer to appear with, it is simply always there. `invisible` would be the
// shorter way to hide it and the wrong one: a hidden element cannot be reached
// by the keyboard, and this is the only route to the note on a named row.
const noteMark =
  "shrink-0 self-center rounded-sm p-0.5 text-ink-soft transition-colors hover:text-ink focus-visible:text-ink";
const noteMarkQuiet = "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100";

/**
 * What a row is called when something has to be said about it out loud.
 *
 * The payee first, since that is what the row is *about*, and the note only where
 * there is no payee — which is every row written before payees existed, and every
 * transfer. Both are what a household would actually say to identify the line.
 */
const nameOf = (transaction, payeeById) =>
  payeeById?.get(transaction.payeeId)?.name || transaction.description || "untitled entry";

// Starting a split is an answer to the question the Category column asks — "which
// category did this come out of?", answered with "several" — so it lives in that
// select rather than in a control of its own. There is no width for another
// control on this grid, and a seventh column is the thing CLAUDE.md names as the
// mistake not to make. Picking it opens the editor; the select is controlled, so
// it snaps straight back to what the row actually says.
const START_SPLIT = "__split__";

/**
 * The two totals a set of rows adds up to, kept apart the way the columns are.
 *
 * **A transfer is in neither.** These footings are what came into the household
 * and what left it; a transfer did neither, and counting it would put a
 * credit-card payment in the same column as the groceries it paid for — the month
 * would read as having spent that money twice, and the total would reconcile
 * against nothing else in the app.
 */
function totalsOf(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      if (isTransfer(transaction)) return totals;
      return transaction.kind === TRANSACTION_KINDS.INFLOW
        ? { ...totals, inCents: totals.inCents + transaction.amountCents }
        : { ...totals, outCents: totals.outCents + transaction.amountCents };
    },
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
function AmountCell({ transaction, label, kind, onCommit, onSplit }) {
  const transfer = isTransfer(transaction);
  const split = isSplit(transaction);
  // **A transfer only ever uses the Out column**, because money leaving the
  // account the row names is what it is. The In cell is a dash rather than an
  // empty input, which is what stops a figure typed there from doing what it does
  // on every other row — turning the record into an inflow. A transfer's
  // direction is its pair of accounts, and that is edited in the Account cell.
  if (transfer && kind === TRANSACTION_KINDS.INFLOW) {
    return (
      <td
        data-label="In"
        className="px-3 py-1 text-right font-mono text-row text-ink-soft"
        aria-hidden="true"
      >
        —
      </td>
    );
  }

  const active = transfer || transaction.kind === kind;
  const column = kind === TRANSACTION_KINDS.INFLOW ? "In" : "Out";

  // A divided receipt's figure is the one its parts add up to, so it can only
  // move where they can move with it. The cell keeps the look of the ones around
  // it — the same rule under the pointer, the same azure box under the caret —
  // because it is still the way this row's figure is changed; it just opens the
  // editor rather than taking a number.
  if (split) {
    if (!active) {
      return (
        <td
          data-label={column}
          className="px-3 py-1 text-right font-mono text-row text-ink-soft"
          aria-hidden="true"
        >
          —
        </td>
      );
    }
    return (
      <td data-label={column} className="px-3 py-1">
        <button
          type="button"
          aria-label={`${column} for ${label} — open the split to change it`}
          onClick={() => onSplit(transaction)}
          className={`${cellBase} bg-transparent text-right font-mono tabular-nums`}
        >
          {amountAtRest(transaction.amountCents)}
        </button>
      </td>
    );
  }

  const display = active ? amountAtRest(transaction.amountCents) : "";
  const editable = active ? amountEditing(transaction.amountCents) : "";

  function handleBlur(e) {
    const raw = e.target.value.trim();
    const cents = raw === "" ? null : toCents(raw);

    // A blank is an abandoned edit, not a transaction of nothing, and a figure
    // the store already holds is not an edit at all.
    if (cents != null && !(active && cents === transaction.amountCents)) {
      // Naming the column's own direction is what turns an expense filed the
      // wrong way round into the refund it was, and back — but a transfer has no
      // direction to name, so its figure is sent alone.
      onCommit(transaction, transfer ? { amountCents: cents } : { kind, amountCents: cents });
    }
    // Whatever happened — committed, refused or abandoned — the cell goes back
    // to reading as money. A successful change remounts it anyway; this is what
    // covers the three cases that do not.
    e.target.value = display;
  }

  return (
    <td data-label={column} className="px-3 py-1">
      <input
        type="text"
        inputMode="decimal"
        key={`${transaction.kind}:${transaction.amountCents}`}
        defaultValue={display}
        aria-label={`${column} for ${label}`}
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

/**
 * One account cell's select: the accounts on offer, plus whatever this row
 * actually names.
 *
 * The current value **always** has an option, even when it is not one this list
 * would offer — an off-budget account, an account since deleted, the blank a
 * detached row carries. Without it the select would show its first option instead
 * and the row would appear to have been refiled by simply being looked at.
 */
function AccountSelect({ value, label, offered, accounts, index, onChange }) {
  const known = offered.some((account) => account.id === value);
  const held = accounts.find((account) => account.id === value);

  return (
    <select
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={cellSelect(index)}
    >
      {value == null && <option value="">— none</option>}
      {offered.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
      {value != null && !known && (
        <option value={value}>{held?.name ?? "Unknown account"}</option>
      )}
    </select>
  );
}

function RegisterRow({
  transaction,
  index,
  budgets,
  accounts,
  payees,
  payeeById,
  inside,
  error,
  spans,
  selected,
  onSelect,
  balanceCents,
  showBalance,
  onCommit,
  onPayeeCommit,
  onDelete,
  onSplit,
}) {
  const label = nameOf(transaction, payeeById);
  const transfer = isTransfer(transaction);
  const split = isSplit(transaction);
  const isInflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
  // A payee names the row, so the note beside it is a remark and folds into the
  // mark at the end of the name. With no payee the note is the row's name and
  // stays on the face of it — `nameOf`'s own precedence, read as a layout.
  const named = transaction.payeeId != null;
  const hasNote = transaction.description !== "" && transaction.description != null;
  // Open only while the note is being written, which is why it is state here and
  // not a field: a row's note is read far more often than it is edited.
  const [noteOpen, setNoteOpen] = useState(false);
  const noteMarkRef = useRef(null);

  // The current value always has an option, even when it is not one the form
  // would offer: an off-budget account, an account since deleted, or the
  // Uncategorized sentinel a deleted category left behind. Without it the
  // select would show its first option instead and the row would appear to have
  // been refiled by simply being looked at.
  const knownBudget = budgets.some((budget) => budget.id === transaction.budgetId);
  // A transfer may name a holding on either end — it is the one record that may,
  // for the reason `AddTransactionModal` gives. Every other row spends through the
  // budget or it is a legacy record, and neither wants the holdings on offer.
  const spendable = accounts.filter(spendsThroughBudget);
  const offered = transfer ? accounts : spendable;
  // Only a transfer that leaves the budget comes out of a category; the rest move
  // no plan money and have nothing to file. Same rule as the form, read off the
  // same predicate, so the two screens cannot ask different questions of one row.
  const crossesOut = transfer && inside(transaction.accountId) && !inside(transaction.toAccountId);
  const wantsCategory = !transfer || crossesOut;

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
      setNoteOpen(false);
      return;
    }
    const result = onCommit(transaction, { description: e.target.value });
    if (!result.ok) {
      // Refused, so the field stays where it is with the reason under the row —
      // the contract every panel outside a modal keeps. Closing it would take
      // away the thing the message is asking to have corrected.
      e.target.value = transaction.description;
      return;
    }
    setNoteOpen(false);
  }

  // Escape abandons the edit rather than committing it, and hands the keyboard
  // back to the mark it was opened from — the field is gone by then, so there is
  // nowhere else for focus to be.
  function handleNoteKeyDown(e) {
    if (e.key !== "Escape") return;
    e.target.value = transaction.description;
    setNoteOpen(false);
    noteMarkRef.current?.focus();
  }

  // One field, drawn either on the row or under the mark. The two differ by
  // where they sit and nothing else, so the editing contract cannot come apart
  // between them.
  const noteField = (opened) => (
    <input
      type="text"
      key={transaction.description}
      defaultValue={transaction.description}
      // A quiet invitation rather than a dash on a row that has no payee to name
      // it either: an empty field marked "—" reads as a value that is missing
      // instead of one that was never wanted. A transfer names nobody by
      // definition, so there is nothing to invite.
      placeholder={transfer ? "—" : "+ note"}
      aria-label={`Note on ${label}`}
      autoFocus={opened}
      onBlur={handleDescriptionBlur}
      onKeyDown={opened ? handleNoteKeyDown : undefined}
      className={`${cellInput} ${transfer ? "" : "text-ink-soft"}`}
    />
  );

  return (
    <>
      {/* `group` is what lets the note's mark appear with the pointer: it is the
          only thing on the row that is not drawn at rest. */}
      <tr className={`group ${rowBg(index)}`}>
        {/* Unlabelled in the stacked phone layout — `data-label` is what makes a
            cell a "LABEL … value" line there, and the tick belongs with the
            controls at the foot of the card rather than among the figures. */}
        <td className="px-1 py-1">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${label}`}
            onChange={() => onSelect(transaction.id)}
            className="h-3.5 w-3.5 shrink-0 accent-azure"
          />
        </td>
        <td data-label="Date" className="px-3 py-1">
          <input
            type="date"
            key={transaction.date ?? "undated"}
            defaultValue={transaction.date ?? ""}
            aria-label={`Date of ${label}`}
            onBlur={handleDateBlur}
            className={`${cellInput} font-mono`}
          />
        </td>
        {/* The payee, with the note as the mark after it — or the note alone,
            where no payee names the row. A transfer is always the second case: it
            moves money between the household's own accounts and has no other end
            to name, which is also what every row written before payees existed
            shows. The payee field is keyed on the stored payee so a commit
            re-seeds it with what actually landed. */}
        <td data-label="Payee & note" className="px-3 py-1">
          {transfer ? (
            noteField(false)
          ) : named ? (
            <>
              <div className="flex items-baseline gap-1">
                {/* `min-w-0` or the field's own content sets a floor the flex
                    row will not go below, and the mark is pushed out of a
                    144px-ish column. */}
                <div className="min-w-0 flex-1">
                  <PayeeField
                    surface="cell"
                    key={transaction.payeeId}
                    label={`Payee of ${label}`}
                    payees={payees}
                    value={transaction.payeeId}
                    placeholder="—"
                    inputClassName={cellInput}
                    onCommit={(committed) => onPayeeCommit(transaction, committed)}
                  />
                </div>
                <button
                  type="button"
                  ref={noteMarkRef}
                  // The note on hover, which is the whole point of folding it
                  // away: a native tooltip rather than one of our own, because
                  // the register scrolls on one axis and a box drawn inside a
                  // cell would be clipped on the other — the same trap
                  // `PayeeField` steps around with a fixed-positioned list.
                  title={hasNote ? transaction.description : "Add a note"}
                  // Said out loud as well as shown, or the note would be
                  // readable only by opening the field that writes it.
                  aria-label={
                    hasNote
                      ? `Note on ${label}: ${transaction.description}`
                      : `Add a note to ${label}`
                  }
                  aria-expanded={noteOpen}
                  // Open, deliberately not toggle: the field commits and closes
                  // on blur, so by the time a second click lands the field has
                  // already gone and a toggle would read as having done nothing.
                  // Escape is what closes it without leaving the keyboard.
                  onClick={() => setNoteOpen(true)}
                  className={`${noteMark} ${hasNote || noteOpen ? "" : noteMarkQuiet}`}
                >
                  <NoteIcon filled={hasNote} />
                </button>
              </div>
              {noteOpen && noteField(true)}
            </>
          ) : (
            <>
              <PayeeField
                surface="cell"
                key="nobody"
                label={`Payee of ${label}`}
                payees={payees}
                value={null}
                placeholder="—"
                inputClassName={cellInput}
                onCommit={(committed) => onPayeeCommit(transaction, committed)}
              />
              {noteField(false)}
            </>
          )}
        </td>
        <td data-label="Category" className="px-3 py-1">
          {wantsCategory && split ? (
            // Not a select: the answer is several categories, and the one control
            // that can state it is the editor. The count is on the face of it so
            // the row says how many without being opened.
            <button
              type="button"
              aria-label={`Split of ${label}, ${transaction.splits.length} parts`}
              onClick={() => onSplit(transaction)}
              className={`${cellBase} bg-transparent text-left`}
            >
              Split ({transaction.splits.length})
            </button>
          ) : wantsCategory ? (
            <select
              value={transaction.budgetId ?? ""}
              aria-label={`Category of ${label}`}
              onChange={(e) =>
                e.target.value === START_SPLIT
                  ? onSplit(transaction)
                  : onCommit(transaction, { budgetId: e.target.value })
              }
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
              {budgets.length > 0 && <option value={START_SPLIT}>Split between categories…</option>}
            </select>
          ) : (
            // A transfer inside the budget moves no envelope, so there is nothing
            // to file it under. A dash rather than an empty select, which would
            // offer a choice the figures would then ignore.
            <span className="font-mono text-row text-ink-soft" aria-hidden="true">
              —
            </span>
          )}
        </td>
        {/* Both ends of a transfer live here, stacked, rather than in a column of
            their own: another fixed width would push the grid past its container
            at 768px, and the two are one answer read top to bottom.

            Absent entirely while the running balance is drawn — see `columnsFor`
            for why those two are the pair that trade places. */}
        {!showBalance && (
          <td data-label="Account" className="px-3 py-1">
            <AccountSelect
              value={transaction.accountId}
              label={transfer ? `Transferred from, for ${label}` : `Account of ${label}`}
              offered={offered}
              accounts={accounts}
              index={index}
              onChange={(accountId) => onCommit(transaction, { accountId })}
            />
            {transfer && (
              <div className="flex items-baseline gap-1">
                <span aria-hidden="true" className="font-mono text-row text-ink-soft">
                  →
                </span>
                <AccountSelect
                  value={transaction.toAccountId}
                  label={`Transferred to, for ${label}`}
                  offered={accounts.filter((account) => account.id !== transaction.accountId)}
                  accounts={accounts}
                  index={index}
                  onChange={(toAccountId) => onCommit(transaction, { toAccountId })}
                />
              </div>
            )}
          </td>
        )}
        <AmountCell
          transaction={transaction}
          label={label}
          kind={TRANSACTION_KINDS.INFLOW}
          onCommit={onCommit}
          onSplit={onSplit}
        />
        <AmountCell
          transaction={transaction}
          label={label}
          kind={TRANSACTION_KINDS.OUTFLOW}
          onCommit={onCommit}
          onSplit={onSplit}
        />
        {/* What the account held once this row had been through it. Read-only,
            because it is not a field: it is the sum of everything above it, and
            the way to change it is to change one of those. No colour either way —
            a credit card is legitimately negative and a current account can be
            overdrawn, so red here would be the app's one definition of trouble
            borrowed for something that is not it. */}
        {showBalance && (
          <td
            data-label="Balance"
            className="whitespace-nowrap px-3 py-1 text-right font-mono text-row tabular-nums text-ink"
          >
            {balanceCents == null ? (
              <span aria-hidden="true" className="text-ink-soft">
                —
              </span>
            ) : (
              formatCents(balanceCents)
            )}
          </td>
        )}
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
          <td colSpan={spans.full} className="px-3 pb-2">
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
function Band({ name, totals, spans }) {
  return (
    <tr className="bg-band">
      <th
        scope="colgroup"
        colSpan={spans.lead}
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
      <td colSpan={spans.trail} />
    </tr>
  );
}

export default function TransactionRegister({
  period,
  transactions,
  budgets,
  accounts,
  payees,
  payeeById,
  // How many rows the window holds before the filter narrowed it, and whether
  // the window is every month. Both are the page's answers: this component is
  // handed its rows and has no idea what was left out, and a register that said
  // "12 entries" while a filter was quietly hiding thirty would be the one way
  // this screen could lie.
  shownOf,
  allMonths = false,
  balances = null,
  selected,
  onSelect,
  onSelectShown,
  onChange,
  onPayeeChange,
  onDelete,
  onAdd,
  onClearFilter,
  onSplit,
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

  /**
   * A payee named on a row: an existing one, a new one, or none at all.
   *
   * It goes through the page rather than through `onChange` because a payee that
   * does not exist yet has to be created before the row can point at it, and the
   * store that creates it is not this component's business. **The category is
   * deliberately left alone** — a payee's default category seeds a *new*
   * transaction, and re-filing money that is already filed because a name was
   * corrected is the one thing this app never does quietly.
   */
  function commitPayee(transaction, committed) {
    const result = onPayeeChange(transaction, committed);
    setError(result.ok ? null : { id: transaction.id, message: result.error });
    return result;
  }

  // Which side of the budget each account sits on, which is the only thing that
  // decides whether a transfer row has a category to file. Built once for the
  // whole grid rather than per row.
  const inside = insideBudget(accounts);

  const dated = transactions.filter((transaction) => transaction.date != null);
  const undated = transactions.filter((transaction) => transaction.date == null);
  const totals = totalsOf(dated);

  const showBalance = balances != null;
  const columns = columnsFor(showBalance);
  const spans = spansOf(columns);

  // The window the footing is a footing *of*. A register showing every month it
  // holds has no month to name, and naming the one the stepper happens to be on
  // would label a total that is not that month's.
  const windowName = allMonths ? "Every month" : formatPeriod(period);

  // Some, all or none of what is on screen — which is the whole of what a
  // select-all box can honestly say, since the rows it is not showing are not
  // the ones it would tick.
  const shownIds = transactions.map((transaction) => transaction.id);
  const pickedCount = shownIds.filter((id) => selected.has(id)).length;
  const allPicked = pickedCount > 0 && pickedCount === shownIds.length;

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
        payees={payees}
        payeeById={payeeById}
        inside={inside}
        error={error?.id === transaction.id ? error.message : null}
        spans={spans}
        selected={selected.has(transaction.id)}
        onSelect={onSelect}
        showBalance={showBalance}
        // `undefined` where the account never held this row, which cannot happen
        // while the filter names it — but a map that does not know a row is not a
        // row whose balance is zero, and a dash says so.
        balanceCents={balances?.get(transaction.id) ?? null}
        onCommit={commit}
        onPayeeCommit={commitPayee}
        onDelete={onDelete}
        onSplit={onSplit}
      />
    ));

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Register</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {/* "12 of 48" wherever a filter is narrowing, so what is missing is a
              figure on screen rather than something the reader has to notice. */}
          {shownOf != null && shownOf > transactions.length
            ? `${transactions.length} of ${shownOf} entries`
            : `${dated.length} ${dated.length === 1 ? "entry" : "entries"}`}{" "}
          {allMonths ? "across every month" : `in ${formatPeriod(period)}`}
        </span>
      </div>

      {transactions.length === 0 ? (
        // Two empty states, because they are two different facts and only one of
        // them is the user's to fix: an empty month wants an entry, and a filter
        // that matches nothing wants clearing. Offering "Add a transaction" to
        // somebody who has just searched for "costco" would answer a question
        // they did not ask.
        shownOf > 0 ? (
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            Nothing here matches that search.{" "}
            <button
              type="button"
              onClick={onClearFilter}
              className="text-azure underline underline-offset-2 hover:text-chalk"
            >
              Clear the filter
            </button>{" "}
            to see {shownOf === 1 ? "the one entry" : `all ${shownOf} entries`}{" "}
            {allMonths ? "on the books" : `in ${formatPeriod(period)}`}.
          </p>
        ) : (
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            Nothing recorded in {allMonths ? "the books yet" : formatPeriod(period)}.{" "}
            <button
              type="button"
              onClick={onAdd}
              className="text-azure underline underline-offset-2 hover:text-chalk"
            >
              Add a transaction
            </button>{" "}
            and it will appear here, editable where it sits.
          </p>
        )
      ) : (
        <div className="overflow-x-auto">
          {/* No `min-width` floor under the grid, tempting as one is: Chrome
              counts a table's min-width against the *document's* scroll width
              even inside an `overflow-x-auto` box, so a floor wide enough to
              keep six columns apart puts a scrollbar under the whole page. The
              fixed layout already holds the columns steady; below the width they
              need, they shrink together rather than the page sliding sideways. */}
          <table className="reflow w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-mono text-label uppercase text-chalk ${
                      column.width ?? ""
                    } ${column.numeric ? "text-right" : "text-left"}`}
                  >
                    {column.key === "select" ? (
                      <input
                        type="checkbox"
                        checked={allPicked}
                        // Partly ticked is a third state and the only honest one
                        // for "some of these": without it, a box drawn empty over
                        // nine ticked rows reads as a selection that has been
                        // lost. The DOM property is the only way to set it.
                        ref={(box) => {
                          if (box) box.indeterminate = pickedCount > 0 && !allPicked;
                        }}
                        aria-label={
                          allPicked ? "Clear the selection" : "Select every entry shown"
                        }
                        onChange={() => onSelectShown(allPicked ? [] : shownIds)}
                        className="h-3.5 w-3.5 shrink-0 accent-azure"
                      />
                    ) : (
                      column.label
                    )}
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
                <Band name="Undated" totals={totalsOf(undated)} spans={spans} />
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
                  colSpan={spans.lead}
                  className="px-3 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  {windowName}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-verdant">
                  {formatCents(totals.inCents)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-vermilion">
                  {formatCents(totals.outCents)}
                </td>
                <td colSpan={spans.trail} />
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
