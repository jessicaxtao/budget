import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import SplitParts, {
  blankPart,
  describeSplitProblem,
  partsFromSplits,
  partsToSplits,
} from "./SplitParts";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { isSplit, useTransactions } from "../contexts/TransactionsContext";
import { amountAtRest, amountEditing, formatDateMedium, toCents } from "../utils";

/**
 * One transaction already in the ledger, divided between categories.
 *
 * A modal rather than a row of cells, and that is the same call `AddAccountModal`
 * makes for the same reason: a split is several interlocking answers that are
 * only valid together. Every other cell on the register commits on its own, on
 * blur, because every other field means something on its own — but a part typed
 * down from $80 to $50 leaves the division $30 short of the whole, and a store
 * that accepted it would have the envelopes and the balance sheet reading two
 * different transactions. So the whole division commits at once or not at all,
 * which is the all-or-nothing rule `setPeriodBalances` and `setPeriodAssignments`
 * already keep for a window of figures.
 *
 * **The total is edited here too**, and it has to be: it is the one figure the
 * parts are checked against, so a register cell that changed it on its own could
 * only ever be refused. On a split row the register sends the user here instead.
 *
 * The consequence, stated rather than worked around: **a split row cannot change
 * direction.** Typing into the other amount column is what turns a misfiled
 * expense into a refund everywhere else, and a split row has no editable cell in
 * that column to type into. Undoing the split, flipping the row and splitting it
 * again is the way back, which is three steps for something rare — and far
 * better than a half-applied flip that left the parts describing the other
 * direction.
 */
export default function SplitTransactionModal({ show, transaction, handleClose }) {
  const [parts, setParts] = useState([]);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);

  const { budgets } = useBudgets();
  const { updateTransaction } = useTransactions();
  // Read directly rather than taken as a prop: this is a modal, and modals here
  // read the stores they need. What it wants is one name.
  const { payeeById } = usePayees();

  /** What to call the record in the title — who it was paid to, else its note. */
  const describeTransaction = (entry) =>
    payeeById.get(entry.payeeId)?.name || entry.description || "this entry";

  const totalCents = toCents(amount);
  const split = isSplit(transaction);

  // Seeded on open, and on the row changing underneath — the register opens this
  // same mounted modal on a different transaction without closing it in between,
  // the way `AddSavingsGoalModal` is opened on a different goal.
  //
  // Keyed on the **id** and not the record: the ledger hands out a fresh object
  // for every transaction whenever any of them is written, and depending on the
  // object would wipe a division halfway through being typed the moment another
  // device synced a change to an unrelated row.
  useEffect(() => {
    if (!show || !transaction) return;
    setError(null);
    setAmount(amountAtRest(transaction.amountCents));
    setParts(
      isSplit(transaction)
        ? partsFromSplits(transaction.splits)
        : // One part, holding the whole, filed where the record is filed now.
          // Not two: a second blank row would read as a question, and the honest
          // starting state is what the record already says. Typing this one down
          // is what makes the rest appear as "left to split".
          [{ ...blankPart(transaction.budgetId ?? ""), amount: amountAtRest(transaction.amountCents) }]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, transaction?.id]);

  function handleSubmit(e) {
    e.preventDefault();
    // Everything checked before the write, so a refusal leaves the form exactly
    // as it was rather than committing a total whose parts were then rejected.
    const problem = describeSplitProblem(parts, totalCents);
    if (problem) {
      setError(problem);
      return;
    }

    const result = updateTransaction({
      id: transaction.id,
      amountCents: totalCents,
      splits: partsToSplits(parts),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  /**
   * Back to one category, and the stored one — not whatever is typed above.
   *
   * Undoing is a reversal, so it reverses: it puts the record back the way the
   * ledger holds it, filed under the first category it was divided between. An
   * unsaved total half-typed into the field is not part of what is being undone.
   */
  function handleUndo() {
    const result = updateTransaction({
      id: transaction.id,
      budgetId: transaction.splits[0].budgetId,
      splits: null,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const fallbackName =
    split && budgets.find((budget) => budget.id === transaction.splits[0].budgetId)?.name;

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      wide
      title={transaction ? `Split ${describeTransaction(transaction)}` : "Split"}
    >
      {!transaction ? null : (
        <form onSubmit={handleSubmit}>
          <p className="mb-5 font-sans text-row text-chalk-soft">
            {transaction.date ? formatDateMedium(transaction.date) : "Undated"} — one movement of
            money, divided between the categories it actually came out of. The parts have to add
            up to the total.
          </p>

          <label className="mb-5 block">
            <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
              Total
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={(e) => {
                const cents = toCents(amount);
                const input = e.target;
                if (cents != null) setAmount(amountEditing(cents));
                queueMicrotask(() => input.select());
              }}
              onBlur={() => {
                const cents = toCents(amount);
                if (cents != null) setAmount(amountAtRest(cents));
              }}
              className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors focus:border-azure"
            />
          </label>

          <SplitParts
            parts={parts}
            budgets={budgets}
            totalCents={totalCents}
            onChange={setParts}
          />

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Only where there is a split to undo, and it says where the money
                lands so the button is not a surprise. */}
            {split ? (
              <Button variant="outline" type="button" onClick={handleUndo}>
                Undo the split — file it all under {fallbackName ?? "the first category"}
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" type="submit">
              Save the split
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
