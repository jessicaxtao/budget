import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import { currentPeriod, formatCents, todayISO } from "../utils";

/**
 * One form for every movement of money.
 *
 * There used to be two — Add expense and Add income — which asked for the same
 * five things and differed in one. They are one form with a direction toggle
 * now, so recording what happened is a single decision followed by a single
 * screen rather than a choice of doors made before the user has said anything.
 *
 * **Every field is answered here.** The transaction names the account it moved
 * through and, when money went out, the category it came from; neither can be
 * deferred. That is a deliberate constraint rather than an oversight: a ledger
 * that lets rows be saved half-finished grows a backlog the user has to come
 * back and clear, and every figure derived from it is provisional until they do.
 * The store enforces the same rule at its boundary — see TransactionsContext.
 *
 * Money in asks for a category too, and there the blank *is* an answer. No
 * category means income, which lands in the pool to be assigned; a category
 * means a refund against it — the friend paying back their half of dinner — and
 * the money goes back into that envelope rather than round the assigning loop a
 * second time. The two are genuinely different events and only the user knows
 * which one happened, so the field is offered rather than guessed at.
 *
 * Only on-budget accounts are offered. Off-budget holdings are tracked by their
 * worth over time on the Net worth page, not by transactions: nobody logs each
 * tick of a 401(k), and offering the choice would invite a ledger that is
 * complete for one account and meaningless for the next.
 *
 * Uncontrolled like every other form here, with one exception: the direction is
 * held in state, because it decides which fields exist. The value submitted is
 * that state rather than a hidden input, so there is only ever one copy of it.
 */
export default function AddTransactionModal({
  show,
  defaultKind = TRANSACTION_KINDS.OUTFLOW,
  defaultBudgetId,
  handleClose,
}) {
  const formRef = useRef();
  const descriptionRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const accountIdRef = useRef();
  const budgetIdRef = useRef();
  const [error, setError] = useState(null);
  const [kind, setKind] = useState(defaultKind);

  const { addTransaction } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  // Balances as they stand today, not at the period the page is showing: this
  // is a note about what the account can cover right now, and a user entering a
  // receipt while looking at March does not want March's figure.
  const { rows: balanceRows } = useAccountBalances(currentPeriod());

  const spendable = accounts.filter(spendsThroughBudget);
  const balanceById = new Map(balanceRows.map((row) => [row.account.id, row.balanceCents]));

  const isOutflow = kind === TRANSACTION_KINDS.OUTFLOW;
  // Nothing to book against. Said plainly, with the way out, rather than
  // presenting a form whose submit can only fail.
  const blocked = spendable.length === 0 || (isOutflow && budgets.length === 0);

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on a select only ever applies on the first
  // mount, when the defaults were still undefined. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    setError(null);
    setKind(defaultKind);
    // Absent while the modal is showing the "nothing to book against" message,
    // which renders in place of the form.
    if (!formRef.current) return;

    formRef.current.reset();
    dateRef.current.value = todayISO();
    accountIdRef.current.value = spendable[0]?.id ?? "";
    // Absent while there are no categories at all, which only money-in can
    // reach. Money out falls back to the first category; money in falls back to
    // none, because the common inflow is a paycheque and a refund is the one the
    // user has to say out loud.
    if (budgetIdRef.current) {
      const known = budgets.some((budget) => budget.id === defaultBudgetId);
      budgetIdRef.current.value = known
        ? defaultBudgetId
        : defaultKind === TRANSACTION_KINDS.OUTFLOW
        ? budgets[0]?.id ?? ""
        : "";
    }
    // `spendable` and `budgets` are rebuilt every render; depending on them
    // would re-seed the form out from under the user as they type elsewhere in
    // the app. Their contents are read at open, which is when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, defaultKind, defaultBudgetId]);

  function handleKindChange(next) {
    if (next === kind) return;
    setKind(next);
    setError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();

    const result = addTransaction({
      kind,
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      date: dateRef.current.value,
      accountId: accountIdRef.current?.value,
      // "" is the money-in form's "no category", which the store reads as
      // income. Sent as-is; it is the store's job to know what an empty choice
      // means, not the form's.
      budgetId: budgetIdRef.current?.value || null,
    });

    // Keep the modal open on a rejection so the typed details are still there
    // to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New transaction">
      {/* Outside the form: it is a mode, not a field, and putting it in the
          form would have `form.reset()` fighting the state that drives it. */}
      <div className="mb-5 grid grid-cols-2 border border-edge">
        {[
          { value: TRANSACTION_KINDS.OUTFLOW, label: "Money out", tone: "bg-vermilion" },
          { value: TRANSACTION_KINDS.INFLOW, label: "Money in", tone: "bg-verdant" },
        ].map((option) => {
          const active = kind === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => handleKindChange(option.value)}
              className={`px-3 py-2 font-sans text-sm font-medium tracking-wide transition-colors ${
                active
                  ? `${option.tone} text-panel`
                  : "bg-transparent text-chalk-soft hover:bg-panel-raised hover:text-chalk"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {blocked ? (
        <div className="font-sans text-row text-chalk-soft">
          {spendable.length === 0 ? (
            <p>
              No on-budget account yet. Money has to come from somewhere —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add an account and its starting balance
              </Link>{" "}
              first.
            </p>
          ) : (
            <p>
              No categories yet. Every expense is filed under one —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add a category on the budget plan
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <Field
            label={isOutflow ? "Paid to" : "Received from"}
            inputRef={descriptionRef}
            type="text"
            required
          />
          <Field label="Amount" inputRef={amountRef} type="text" inputMode="decimal" required />
          <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
          <SelectField
            label={isOutflow ? "Paid from" : "Paid into"}
            selectRef={accountIdRef}
            required
          >
            {spendable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} — {formatCents(balanceById.get(account.id) ?? 0)}
              </option>
            ))}
          </SelectField>
          {/* Keyed on the direction so switching remounts it, which is what
              makes each direction's default its own: a fresh select takes its
              first option, and the first option is the first category for money
              out and "no category" for money in. Without the key the element is
              reused and a category picked for an expense would silently turn the
              next paycheque into a refund. */}
          {(isOutflow || budgets.length > 0) && (
            <SelectField
              key={kind}
              label={isOutflow ? "Category" : "Refund to category"}
              selectRef={budgetIdRef}
              required={isOutflow}
            >
              {!isOutflow && <option value="">None — income to assign</option>}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </SelectField>
          )}
          {!isOutflow && (
            <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              Income lands in “to be assigned”, where you give it a job. Pick a category instead
              only if this is money coming back — a refund, or a share someone paid you back — and
              it will go straight back into that envelope.
            </p>
          )}
          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              Add
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
