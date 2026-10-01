import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Elder, { ELDER_MOODS } from "./Elder";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import { budgetSide, indexAccounts } from "../ledger";
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
 * **Transfer is the third direction**: money moving between two of the
 * household's own accounts, which is neither earned nor spent. Whether it
 * touches the budget at all depends on the pair (`budgetSide`), so the category
 * field exists only when the pair crosses the budget's edge — and there it is
 * optional both ways, because "out of to-be-assigned" and "into to-be-assigned"
 * are real answers. Each case says in a line what it will do, since the same
 * form is moving money between envelopes in one case and nothing at all in the
 * next.
 *
 * Money in offers only on-budget accounts: off-budget holdings are tracked by
 * their worth over time on the Net worth page, not by transactions, and nobody
 * logs each tick of a 401(k). Money out offers every account, because spending
 * money that was set aside — the house bought out of savings — is the moment it
 * becomes spending, and there is nowhere else to record it. Transfers offer
 * every account at both ends.
 *
 * Uncontrolled like every other form here, with three exceptions, all held in
 * state because each decides which fields exist: the direction, and the two
 * accounts. The values submitted are that state rather than hidden inputs, so
 * there is only ever one copy of each.
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
  const budgetIdRef = useRef();
  const [error, setError] = useState(null);
  const [kind, setKind] = useState(defaultKind);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  const { addTransaction } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  // Balances as they stand today, not at the period the page is showing: this
  // is a note about what the account can cover right now, and a user entering a
  // receipt while looking at March does not want March's figure.
  const { rows: balanceRows } = useAccountBalances(currentPeriod());

  const spendable = accounts.filter(spendsThroughBudget);
  const balanceById = new Map(balanceRows.map((row) => [row.account.id, row.balanceCents]));
  const accountsById = indexAccounts(accounts);

  const isOutflow = kind === TRANSACTION_KINDS.OUTFLOW;
  const isTransfer = kind === TRANSACTION_KINDS.TRANSFER;
  // What each direction can name as the account the money left or arrived in.
  const fromOptions = kind === TRANSACTION_KINDS.INFLOW ? spendable : accounts;

  // Nothing to book against. Said plainly, with the way out, rather than
  // presenting a form whose submit can only fail.
  const blocker = isTransfer
    ? accounts.length < 2
      ? "two-accounts"
      : null
    : fromOptions.length === 0
    ? "account"
    : isOutflow && budgets.length === 0
    ? "category"
    : null;

  // Which way a transfer between the two picked accounts crosses the budget's
  // edge, if it does — the same question every figure in the app asks of it.
  const crossing = isTransfer
    ? budgetSide({ kind, accountId: fromId, toAccountId: toId }, accountsById)
    : null;
  // Money out of an off-budget account: spending, but out of no envelope.
  const fromAccount = accountsById.get(fromId);
  const spendingSetAside = isOutflow && fromAccount != null && !spendsThroughBudget(fromAccount);

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on a select only ever applies on the first
  // mount, when the defaults were still undefined. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    setError(null);
    setKind(defaultKind);
    seedAccounts(defaultKind);
    // Absent while the modal is showing the "nothing to book against" message,
    // which renders in place of the form.
    if (!formRef.current) return;

    formRef.current.reset();
    dateRef.current.value = todayISO();
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

  // The accounts a direction starts on: the first on-budget account wherever
  // there is one, since that is where most money moves, and for a transfer the
  // first account that is not that one.
  function seedAccounts(forKind) {
    const options = forKind === TRANSACTION_KINDS.INFLOW ? spendable : accounts;
    const from = spendable[0]?.id ?? options[0]?.id ?? "";
    setFromId(from);
    setToId(accounts.find((account) => account.id !== from)?.id ?? "");
  }

  function handleKindChange(next) {
    if (next === kind) return;
    setKind(next);
    setError(null);
    // An account picked for one direction stays picked for the next wherever
    // that direction offers it — but money in cannot arrive in an off-budget
    // account, and a transfer needs a second account to go to.
    const options = next === TRANSACTION_KINDS.INFLOW ? spendable : accounts;
    if (!options.some((account) => account.id === fromId)) seedAccounts(next);
    else if (next === TRANSACTION_KINDS.TRANSFER && (toId === "" || toId === fromId)) {
      setToId(accounts.find((account) => account.id !== fromId)?.id ?? "");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();

    const result = addTransaction({
      kind,
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      date: dateRef.current.value,
      accountId: fromId,
      toAccountId: isTransfer ? toId : null,
      // "" is the money-in form's "no category", which the store reads as
      // income. Sent as-is; it is the store's job to know what an empty choice
      // means, not the form's. A transfer that stays on one side of the budget
      // has no category field, so it sends none.
      budgetId: isTransfer && crossing == null ? null : budgetIdRef.current?.value || null,
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
      <div className="mb-5 grid grid-cols-3 border border-edge">
        {[
          { value: TRANSACTION_KINDS.OUTFLOW, label: "Money out", tone: "bg-vermilion" },
          { value: TRANSACTION_KINDS.INFLOW, label: "Money in", tone: "bg-verdant" },
          { value: TRANSACTION_KINDS.TRANSFER, label: "Transfer", tone: "bg-azure" },
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

      {blocker ? (
        <div className="flex items-start gap-4 font-sans text-row text-chalk-soft">
          <Elder mood={ELDER_MOODS.PONDERING} className="h-14 w-16" />
          {blocker === "two-accounts" ? (
            <p>
              A transfer moves money between two of your accounts, and there{" "}
              {accounts.length === 0 ? "are none yet" : "is only one so far"} —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add {accounts.length === 0 ? "your accounts" : "another account"}
              </Link>{" "}
              first.
            </p>
          ) : blocker === "account" ? (
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
            label={isTransfer ? "Description" : isOutflow ? "Paid to" : "Received from"}
            inputRef={descriptionRef}
            type="text"
            required={!isTransfer}
          />
          <Field label="Amount" inputRef={amountRef} type="text" inputMode="decimal" required />
          <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
          {/* Controlled, unlike the rest of the form: which account is picked
              decides which fields exist below, so it has to be state — and the
              re-seed effect sets that state on every open, which is the job a
              ref write does for the uncontrolled fields. */}
          <SelectField
            label={isTransfer ? "From" : isOutflow ? "Paid from" : "Paid into"}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            required
          >
            <AccountOptions accounts={fromOptions} balanceById={balanceById} />
          </SelectField>
          {isTransfer && (
            <SelectField label="To" value={toId} onChange={(e) => setToId(e.target.value)} required>
              <AccountOptions accounts={accounts} balanceById={balanceById} />
            </SelectField>
          )}
          {/* Keyed on the direction — and for a transfer, on which way it
              crosses — so switching remounts it, which is what makes each case's
              default its own: a fresh select takes its first option, and the
              first option is the first category for money out and "none" for
              everything else. Without the key the element is reused and a
              category picked for an expense would silently turn the next
              paycheque into a refund. */}
          {(isOutflow || (isTransfer ? crossing != null : budgets.length > 0)) && (
            <SelectField
              key={isTransfer ? `${kind}:${crossing}` : kind}
              label={
                isOutflow
                  ? "Category"
                  : isTransfer
                  ? crossing === TRANSACTION_KINDS.OUTFLOW
                    ? "Out of envelope"
                    : "Into envelope"
                  : "Refund to category"
              }
              selectRef={budgetIdRef}
              required={isOutflow}
            >
              {!isOutflow && (
                <option value="">
                  {!isTransfer
                    ? "None — income to assign"
                    : crossing === TRANSACTION_KINDS.OUTFLOW
                    ? "None — out of to be assigned"
                    : "None — to be assigned"}
                </option>
              )}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </SelectField>
          )}
          {isTransfer && (
            <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              {crossing === TRANSACTION_KINDS.OUTFLOW ? (
                <>
                  Money set aside off budget is saved, not spent: it leaves the envelope you pick, or
                  “to be assigned”, and counts as spending only when it is spent.
                </>
              ) : crossing === TRANSACTION_KINDS.INFLOW ? (
                <>
                  Money brought back onto the budget is your own, not income: it goes into the
                  envelope you pick, or into “to be assigned”.
                </>
              ) : (
                <>
                  Both accounts are on the same side of the budget, so no envelope moves — only the
                  two balances.
                </>
              )}
            </p>
          )}
          {spendingSetAside && (
            <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              Spent from an off-budget account: it counts as spending in your reports, but comes out
              of no envelope — the money left the budget when it was set aside.
            </p>
          )}
          {kind === TRANSACTION_KINDS.INFLOW && (
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

/**
 * The accounts a select offers, the ones the budget spends through first with
 * what each holds today, then any off-budget holdings under a heading of their
 * own — without a figure, since what the books derive for one is not what it is
 * worth (that is a statement, on the Net worth page).
 */
function AccountOptions({ accounts, balanceById }) {
  const onBudget = accounts.filter(spendsThroughBudget);
  const offBudget = accounts.filter((account) => !spendsThroughBudget(account));
  return (
    <>
      {onBudget.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} — {formatCents(balanceById.get(account.id) ?? 0)}
        </option>
      ))}
      {offBudget.length > 0 && (
        <optgroup label="Off budget">
          {offBudget.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
