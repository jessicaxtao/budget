import { useCallback, useEffect, useMemo, useState } from "react";
import AddTransactionModal from "../components/AddTransactionModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import BulkEditBar from "../components/BulkEditBar";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import ToBeAssignedBar from "../components/ToBeAssignedBar";
import SplitTransactionModal from "../components/SplitTransactionModal";
import TransactionFilterBar from "../components/TransactionFilterBar";
import TransactionRegister from "../components/TransactionRegister";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useSavedFilters } from "../contexts/SavedFiltersContext";
import { isSplit, useTransactions } from "../contexts/TransactionsContext";
import { runningBalances } from "../hooks/useAccountBalances";
import useEnvelopes from "../hooks/useEnvelopes";
import { orderPayeesByUse } from "../payeeSearch";
import { formatTag, isTag, ledgerTags, readTag, withTag, withoutTag } from "../tags";
import { EMPTY_FILTER, FILTER_SPANS, filterTransactions } from "../transactionFilter";
import { currentPeriod, toPeriod } from "../utils";

/**
 * The books, a month at a time, as the register they are.
 *
 * This page used to be a grid of envelope cards. What each envelope holds is a
 * question about the *plan*, and it is answered on the dashboard, where the
 * same figures sit in one table beside everything else that is true today. What
 * this page is for is the other job — going through what actually happened,
 * line by line, against a statement — and that job wants rows and columns, with
 * every field reachable where it sits.
 *
 * One figure from the envelope side stays: what is left to assign. It is the
 * reason income is worth logging promptly, it moves as the register is worked
 * through, and the flow it opens has nowhere else to be reached from.
 *
 * **Two windows sit on this page and they answer different questions.** The
 * month in the header is the window on the *money*: the to-be-assigned bar is
 * read at it, and the assign form opens on it. The filter bar's own window is
 * the window on the *rows*, and it is the one a search widens — because finding
 * the receipt from the spring is not a question about this month at all. They are
 * kept apart rather than unified because unifying them would mean either a search
 * that could not leave the month or a pool figure that moved when you searched.
 *
 * **The page holds three pieces of view state and the store holds the rest.**
 * The month, the filter and which rows are ticked are facts about this screen,
 * so they live here and are not written anywhere. Undo is the opposite: it is a
 * fact about the ledger, so the stack lives in `TransactionsContext` where every
 * write to the books goes past it — see that file for why a stack kept on a page
 * could not be complete.
 */

/**
 * A batch that moved nothing, said rather than left silent.
 *
 * Choosing nine rows, picking a category and seeing the page sit there is the
 * one outcome a bulk control must not have: it is indistinguishable from a
 * button that is broken. The store is right to write nothing — every row
 * already read that way — so the saying is the page's job.
 */
const unchanged = (result) =>
  result.ok && result.count === 0
    ? { ...result, note: "Nothing to change — every entry chosen already reads that way." }
    : result;

/** A tick box's worth of state, as the one operation it performs. */
const togglePicked = (picked, id) => {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export default function TransactionsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [picked, setPicked] = useState(() => new Set());
  // What the last thing the page did came to, said once. An undo or a bulk edit
  // can move rows that are nowhere near the pointer — or none at all — so the
  // gesture has to report itself somewhere, and a refusal has to be surfaced
  // rather than swallowed.
  const [notice, setNotice] = useState(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // The row being divided, held as an **id** rather than as the record: the
  // ledger hands out fresh objects on every write, and the modal has to go on
  // pointing at the same transaction across one.
  const [splitTargetId, setSplitTargetId] = useState(null);

  const {
    transactions,
    updateTransaction,
    updateTransactions,
    deleteTransaction,
    deleteTransactions,
    undo,
    redo,
    undoLabel,
    redoLabel,
  } = useTransactions();
  const { accounts } = useAccounts();
  const { groups, budgets } = useBudgets();
  const { payees, payeeById, addPayee, findPayeeByName } = usePayees();
  const { savedFilters, saveFilter, updateSavedFilter, deleteSavedFilter } = useSavedFilters();
  // Most recently used first, which is the order the register's payee cells offer
  // before a letter is typed. Built off the whole ledger rather than the month on
  // screen: which payees the household deals with is not a fact about March.
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);

  // Only the pool figures now — the per-category rows this page used to draw
  // are the dashboard's job. Read at the period on screen, so stepping back
  // reports what was unassigned then rather than what is unassigned now.
  const {
    toBeAssignedCents,
    periodIncomeCents,
    periodAssignedCents,
    emergencyReservedCents,
    assignedAheadCents,
  } = useEnvelopes(period);

  const allMonths = filter.span === FILTER_SPANS.ALL;

  // The rows the window holds before the filter narrows it, which is what lets
  // the register say "12 of 48" and offer to clear rather than to add. Undated
  // rows are in every window, the same rule the register's own band keeps.
  const windowCount = useMemo(
    () =>
      transactions.filter((transaction) => {
        if (allMonths) return true;
        const at = toPeriod(transaction.date);
        return at == null || at === period;
      }).length,
    [transactions, allMonths, period]
  );

  // The month's rows, newest first, plus every undated one — those belong to no
  // month, and a register that dropped them would leave money on the books with
  // nowhere to correct it. The register bands them separately.
  const rows = useMemo(() => {
    const matching = filterTransactions(transactions, filter, { payeeById, period });
    // Stable, so entries sharing a date stay in the order they were logged.
    return [...matching].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [transactions, filter, payeeById, period]);

  /**
   * The tags the ledger carries, for the filter bar's picker.
   *
   * Off the whole ledger rather than the rows on screen: a tag the household
   * uses does not stop existing because this month has none of it, and a picker
   * whose options appeared and vanished as the filter moved could not be used to
   * move the filter.
   */
  const tags = useMemo(() => ledgerTags(transactions), [transactions]);

  /**
   * The ticked rows, narrowed to what is actually on screen.
   *
   * Derived rather than pruned by an effect, which is what makes a selection
   * survive a glance at another month: the ids are kept, and only the ones in
   * front of the user count towards an action. A bulk edit that reached rows
   * nobody could see would be the worst button on the page.
   */
  const selected = useMemo(() => {
    const shown = new Set();
    for (const row of rows) if (picked.has(row.id)) shown.add(row.id);
    return shown;
  }, [rows, picked]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);

  /**
   * One account's running balance, where the filter names exactly one.
   *
   * Over the **whole ledger** for that account rather than over the rows on
   * screen, because that is what makes the figure the same number the balance
   * sheet shows — see `runningBalances`. Naming two accounts has no running
   * balance to show: a column mixing a current account and a credit card would
   * be a column of nothing.
   */
  const balances = useMemo(() => {
    if (filter.accountIds.length !== 1) return null;
    const account = accounts.find((candidate) => candidate.id === filter.accountIds[0]);
    return account ? runningBalances(account, transactions) : null;
  }, [filter.accountIds, accounts, transactions]);

  const splitTarget = transactions.find((entry) => entry.id === splitTargetId) ?? null;

  /**
   * Say what a store handed back, once, where the user is looking — and hand
   * the result on to whoever asked, since a control still has to know whether
   * to clear itself.
   *
   * One line for the whole page rather than one per control. A bulk edit, an
   * undo and a saved filter all answer the same question — what just happened —
   * and two places answering it means a note from the last bulk edit sitting
   * under its buttons while an undo has since walked the ledger out from under
   * it. `note` is the thing only a batch can report: that it deliberately left
   * some of the chosen rows alone.
   */
  const report = useCallback((result) => {
    if (!result) return result;
    if (!result.ok) setNotice({ ok: false, text: result.error });
    else setNotice(result.note ? { ok: true, text: result.note } : null);
    return result;
  }, []);

  const walk = useCallback(
    (direction) => {
      const result = direction === "undo" ? undo() : redo();
      if (!result.ok) {
        setNotice({ ok: false, text: result.error });
        return;
      }
      // Said out loud on success as well, because the row that moved may be in
      // another month entirely — an undo nobody can see is indistinguishable
      // from an undo that did nothing.
      setNotice({
        ok: true,
        text: direction === "undo" ? `Undone — ${result.label}.` : `Done again — ${result.label}.`,
      });
    },
    [undo, redo]
  );

  /**
   * Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y), on the page rather than on the window
   * at large: the stack is the ledger's, and this is the screen the ledger is
   * worked on.
   *
   * **A text field keeps its own undo.** Inside one, the gesture means the
   * typing, and taking it over would be worse than not offering it — the caret
   * is in a half-typed figure and nobody pressing Ctrl+Z there is asking about
   * last Tuesday's groceries. Everywhere else on the page it means the books, and
   * the header's button — which names what it will put back — is the route that
   * is always available.
   */
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      const target = event.target;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      event.preventDefault();
      walk(key === "y" || event.shiftKey ? "redo" : "undo");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [walk]);

  function changeFilter(next) {
    setNotice(null);
    setFilter(next);
  }

  /**
   * A payee named on a register row, created first where it is new.
   *
   * The register cannot do this itself: it is handed its rows as props and has no
   * store. **Creating on blur is the rule here and the opposite of the entry
   * form's**, which holds a typed name as a draft until submit — a cell has no
   * submit to wait for, so the moment the user leaves it is the only moment there
   * is. That does mean a mistyped name becomes a payee, which is exactly what the
   * merge on the plan page is for.
   *
   * The payee is created before the row is repointed, for `AddTransactionModal`'s
   * reason: the row has to be able to name it, and a payee with nothing filed under
   * it yet is a far better residual than a row pointing at nothing.
   */
  function handlePayeeChange(transaction, { payeeId, name }) {
    if (payeeId) return updateTransaction({ id: transaction.id, payeeId });

    const trimmed = (name ?? "").trim();
    if (!trimmed) return updateTransaction({ id: transaction.id, payeeId: null });

    // A payee added on another device since this page rendered is the same payee,
    // not a duplicate to be refused.
    const existing = findPayeeByName(trimmed);
    if (existing) return updateTransaction({ id: transaction.id, payeeId: existing.id });

    const created = addPayee({ name: trimmed });
    if (!created.ok) return created;
    return updateTransaction({ id: transaction.id, payeeId: created.id });
  }

  /**
   * Refile every ticked row, **except the divided ones**.
   *
   * A division is an answer of its own to the question this select asks, and the
   * store would keep it in force while quietly storing a new `budgetId` behind
   * it — so the row would read as refiled while its money went on going where
   * its parts say. Left alone and said out loud instead, which is the one thing
   * a batch can do that a single edit cannot.
   */
  function refile(budgetId) {
    if (!budgetId) return { ok: true };
    const divided = selectedRows.filter(isSplit);
    const plain = selectedRows.filter((row) => !isSplit(row));
    if (plain.length === 0) {
      return {
        ok: false,
        error: "Every entry chosen is a divided receipt — open one to change where its parts go.",
      };
    }

    const result = unchanged(updateTransactions(plain.map((row) => ({ id: row.id, budgetId }))));
    if (!result.ok || divided.length === 0) return result;
    return {
      ...result,
      note: `${divided.length === 1 ? "One divided receipt was" : `${divided.length} divided receipts were`} left alone — open a split to change where its parts go.`,
    };
  }

  function moveTo(accountId) {
    if (!accountId) return { ok: true };
    return unchanged(updateTransactions(selectedRows.map((row) => ({ id: row.id, accountId }))));
  }

  /**
   * Put a tag on every ticked row's note, or take it off.
   *
   * The arithmetic is `src/tags.js`'s and the write is one batch: a tag is a word
   * in the note, so tagging forty rows is forty different notes, each with a word
   * appended. Rows that already say it are not changed — `updateTransactions`
   * drops the ones nothing moves — which is what makes tagging a mixed selection
   * safe to do twice.
   */
  function tagWith(write, typed, verb) {
    // Without the `#` somebody may have typed in front of it: the hash is how a
    // tag is written, not part of its name, and keeping it would have the note
    // read "##holiday" the moment the tag was written back out.
    const tag = readTag(typed);
    if (!isTag(tag)) {
      return {
        ok: false,
        error: "A tag is one word — letters, digits, hyphens or underscores, as in #holiday.",
      };
    }

    const patches = selectedRows.map((row) => ({
      id: row.id,
      description: write(row.description, tag),
    }));
    const result = updateTransactions(patches);
    if (!result.ok) return result;

    const untouched = selectedRows.length - result.count;
    return {
      ...result,
      note:
        untouched === 0
          ? `${formatTag(tag)} ${verb} ${result.count} ${result.count === 1 ? "entry" : "entries"}.`
          : `${formatTag(tag)} ${verb} ${result.count} of ${selectedRows.length} — the rest already read that way.`,
    };
  }

  function removeSelected() {
    const result = deleteTransactions(selectedRows.map((row) => row.id));
    if (result.ok) setPicked(new Set());
    return result;
  }

  return (
    <>
      <PageHeader
        eyebrow="Day to day"
        title="Transactions"
        description="Every movement of money, a month at a time. Each row names the account it moved through and the category it came out of, and every cell is editable where it sits."
        // No "Add transaction" of its own: the header carries that door on every
        // page, and a second button with the same label on the same screen makes
        // a reader stop and work out whether the two do the same thing.
        actions={
          <>
            {/* Named by what they will put back, so the gesture is not a guess —
                and disabled rather than hidden, because a control that comes and
                goes is one the eye has to find again every time. */}
            <Button
              variant="outline"
              size="sm"
              disabled={!undoLabel}
              title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
              aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
              onClick={() => walk("undo")}
            >
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!redoLabel}
              title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
              aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
              onClick={() => walk("redo")}
            >
              Redo
            </Button>
            <PeriodStepper period={period} onChange={setPeriod} />
          </>
        }
      />

      <ToBeAssignedBar
        toBeAssignedCents={toBeAssignedCents}
        periodIncomeCents={periodIncomeCents}
        periodAssignedCents={periodAssignedCents}
        reservedCents={emergencyReservedCents}
        assignedAheadCents={assignedAheadCents}
        onAssignClick={() => setShowAssignModal(true)}
      />

      <TransactionFilterBar
        filter={filter}
        onChange={changeFilter}
        groups={groups}
        budgets={budgets}
        accounts={accounts}
        tags={tags}
        savedFilters={savedFilters}
        onSaveFilter={(name) => saveFilter({ name, filter })}
        onUpdateSavedFilter={(id) => report(updateSavedFilter({ id, filter }))}
        onDeleteSavedFilter={deleteSavedFilter}
      />

      {selected.size > 0 && (
        <BulkEditBar
          count={selected.size}
          shownCount={rows.length}
          budgets={budgets}
          accounts={accounts}
          onRefile={(budgetId) => report(refile(budgetId))}
          onMove={(accountId) => report(moveTo(accountId))}
          onTag={(typed) => report(tagWith(withTag, typed, "is now on"))}
          onUntag={(typed) => report(tagWith(withoutTag, typed, "came off"))}
          onDelete={() => report(removeSelected())}
          onClear={() => setPicked(new Set())}
        />
      )}

      {/* Under the bar that caused it and above the rows it is about, which is
          where it lands whether the bar is on screen or not. */}
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={`mb-4 font-sans text-row ${notice.ok ? "text-chalk-soft" : "text-vermilion"}`}
        >
          {notice.text}
        </p>
      )}

      <TransactionRegister
        period={period}
        transactions={rows}
        shownOf={windowCount}
        allMonths={allMonths}
        balances={balances}
        selected={selected}
        onSelect={(id) => setPicked((previous) => togglePicked(previous, id))}
        onSelectShown={(ids) => setPicked(new Set(ids))}
        budgets={budgets}
        accounts={accounts}
        payees={orderedPayees}
        payeeById={payeeById}
        onChange={updateTransaction}
        onPayeeChange={handlePayeeChange}
        onDelete={deleteTransaction}
        onAdd={() => setShowAddModal(true)}
        onClearFilter={() => changeFilter(EMPTY_FILTER)}
        onSplit={(transaction) => setSplitTargetId(transaction.id)}
      />

      <AssignIncomeModal
        show={showAssignModal}
        period={period}
        handleClose={() => setShowAssignModal(false)}
      />
      <AddTransactionModal show={showAddModal} handleClose={() => setShowAddModal(false)} />
      {/* Shown off the record rather than off the id, so a row deleted while the
          editor is open closes it rather than leaving an empty dialog behind. */}
      <SplitTransactionModal
        show={splitTarget != null}
        transaction={splitTarget}
        handleClose={() => setSplitTargetId(null)}
      />
    </>
  );
}
