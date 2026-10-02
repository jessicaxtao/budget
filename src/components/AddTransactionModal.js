import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Elder, { ELDER_MOODS } from "./Elder";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import PayeeField from "./PayeeField";
import SplitParts, {
  blankPart,
  describeSplitProblem,
  partsToSplits,
} from "./SplitParts";
import { insideBudget, spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import { orderPayeesByUse } from "../payeeSearch";
import { amountAtRest, currentPeriod, formatCents, toCents, todayISO } from "../utils";

/**
 * One form for every movement of money.
 *
 * There used to be two — Add expense and Add income — which asked for the same
 * five things and differed in one. They are one form with a direction toggle
 * now, so recording what happened is a single decision followed by a single
 * screen rather than a choice of doors made before the user has said anything.
 * A transfer is the third direction on that same toggle for the same reason: it
 * is the same five questions with the account asked twice.
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
 * **A transfer is the one place an off-budget account is offered.** Elsewhere only
 * on-budget accounts are, because nobody logs each tick of a 401(k) and offering
 * the choice would invite a ledger that is complete for one account and
 * meaningless for the next. A contribution *into* that 401(k) is the exception
 * that proves it: the household knows exactly when it moved that money and how
 * much, so naming both ends is recording a fact rather than pretending to track
 * one. Whether such a transfer needs a category is not a preference — it is
 * decided by which side of the budget each account sits on (see `budgetLegs`), and
 * this form is where that rule is enforced, because the store is mounted above
 * the account store and cannot see a scope.
 *
 * **One receipt can be divided between categories as it is entered**, which is
 * the other thing the category question can be answered with. The editor is
 * `SplitParts`, shared with the modal that divides a row already in the ledger,
 * so the two cannot come to disagree about what a valid division is — and the
 * whole of it is checked before `addTransaction` is called, since a transaction
 * that landed with a division the store then refused would be worse than one
 * that did not land at all.
 *
 * Uncontrolled like every other form here, with three exceptions, and the first
 * two are fields that **decide which other fields exist**: the direction, and the
 * two accounts. The third is the split, whose rows the user adds and removes —
 * see `SplitParts` for why a list of fields cannot be uncontrolled the way a
 * fixed set of them can. A transfer out of the budget asks for a category and one inside it
 * has nothing to ask, so the accounts have to be readable during a render rather
 * than only on submit. They are mirrored in state the way `AddAccountModal`
 * mirrors its kind — `defaultValue` plus an `onChange`, keyed so a remount takes
 * the seed — and submit reads the state, so there is only ever one copy of the
 * answer.
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
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [parts, setParts] = useState([]);
  // The payee, as either an existing record or a name that is not one yet. Held
  // in state rather than in a ref because `PayeeField` is controlled and because
  // picking one can seed the category select below it — both of which need a
  // render. **Nothing is written to the payee store until submit**: a form
  // abandoned half-typed must not leave a payee behind, which is the rule the
  // register's cell cannot keep and this one can.
  const [payeeId, setPayeeId] = useState(null);
  const [payeeName, setPayeeName] = useState("");
  // Whether the user has answered the category question themselves. A payee's
  // default is a *default*, so it stops applying the moment there is a real
  // answer to overwrite — `AddBudgetModal`'s rule for a bucket following a group,
  // and its reason: a choice already made is not a default.
  const chosenBudgetRef = useRef(false);
  // The amount as it stands while it is being typed, which the split editor
  // needs to say how much of it is still unplaced. Read from the field's own
  // `onChange` rather than from a ref, since a ref cannot make anything
  // re-render; the ref is still what submit reads, so there is one answer.
  const [totalCents, setTotalCents] = useState(null);

  const { addTransaction, transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees, addPayee, findPayeeByName } = usePayees();
  // Most recently transacted with first, which is what the list shows before a
  // single letter has been typed — the payee somebody wants is usually one of the
  // last few they used.
  const orderedPayees = useMemo(() => orderPayeesByUse(payees, transactions), [payees, transactions]);
  // Balances as they stand today, not at the period the page is showing: this
  // is a note about what the account can cover right now, and a user entering a
  // receipt while looking at March does not want March's figure.
  const { rows: balanceRows } = useAccountBalances(currentPeriod());

  const spendable = accounts.filter(spendsThroughBudget);
  const balanceById = new Map(balanceRows.map((row) => [row.account.id, row.balanceCents]));

  const isTransfer = kind === TRANSACTION_KINDS.TRANSFER;
  const isInflow = kind === TRANSACTION_KINDS.INFLOW;
  const isOutflow = kind === TRANSACTION_KINDS.OUTFLOW;
  // Every account for a transfer, on-budget only for the other two.
  const sources = isTransfer ? accounts : spendable;
  const destinations = accounts.filter((account) => account.id !== fromAccountId);

  const inside = insideBudget(accounts);
  // Money leaving the budget for a holding is real spending and comes out of a
  // category, exactly as it did when the only way to record it was an outflow
  // filed under "Savings". Every other pairing moves no budget money at all, so
  // there is no category to ask for — asking anyway would invite the user to fund
  // a credit-card payment twice.
  const crossesOut = isTransfer && inside(fromAccountId) && !inside(toAccountId);
  const needsCategory = isOutflow || crossesOut;
  // Wherever a category is asked for, "several" is one of the answers — on money
  // in as much as money out, since a refund can cover more than one envelope.
  const canSplit = (needsCategory || isInflow) && budgets.length > 0;

  // Nothing to book against. Said plainly, with the way out, rather than
  // presenting a form whose submit can only fail.
  const blocked =
    (isTransfer ? accounts.length < 2 : spendable.length === 0) ||
    (isOutflow && budgets.length === 0);

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on a select only ever applies on the first
  // mount, when the defaults were still undefined. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    setError(null);
    setKind(defaultKind);
    setSplitting(false);
    setParts([]);
    setTotalCents(null);
    setPayeeId(null);
    setPayeeName("");
    chosenBudgetRef.current = false;
    // A spending account wherever there is one: it is where money comes from and
    // where a transfer almost always starts. The destination is whatever else
    // exists, since a transfer to the account it came from is no movement at all.
    const from = spendable[0]?.id ?? accounts[0]?.id ?? "";
    setFromAccountId(from);
    setToAccountId(accounts.find((account) => account.id !== from)?.id ?? "");
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
    // `spendable`, `accounts` and `budgets` are rebuilt every render; depending on
    // them would re-seed the form out from under the user as they type elsewhere
    // in the app. Their contents are read at open, which is when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, defaultKind, defaultBudgetId]);

  function handleKindChange(next) {
    if (next === kind) return;
    setKind(next);
    setError(null);
    // An off-budget account picked for a transfer is not on offer to the other
    // two directions, so a switch away from one would leave the select showing a
    // name that is no longer in its own list.
    const stillOffered = spendable.some((account) => account.id === fromAccountId);
    if (next !== TRANSACTION_KINDS.TRANSFER && !stillOffered) {
      setFromAccountId(spendable[0]?.id ?? "");
    }
  }

  function handleFromChange(next) {
    setFromAccountId(next);
    // The two ends cannot be the same account, and the store refuses one where
    // they are. Moving the destination out of the way is the only answer that
    // does not silently discard the choice just made.
    if (next === toAccountId) {
      setToAccountId(accounts.find((account) => account.id !== next)?.id ?? "");
    }
  }

  /**
   * Into and out of dividing this receipt between categories.
   *
   * Turning it on carries the answer already given across — the category picked,
   * and the whole amount against it — so the first thing to do is type that part
   * down, which is what makes the rest appear as "left to split". Turning it off
   * abandons the division and the single select comes back on its own default,
   * exactly as a fresh form would show it.
   */
  function handleSplitToggle() {
    if (splitting) {
      setSplitting(false);
      setParts([]);
      return;
    }
    const seeded = toCents(amountRef.current?.value ?? "");
    setParts([
      {
        ...blankPart(budgetIdRef.current?.value ?? ""),
        amount: seeded == null ? "" : amountAtRest(seeded),
      },
    ]);
    setSplitting(true);
    setError(null);
  }

  /**
   * A payee named: either an existing record, or a name that is not one yet.
   *
   * Picking one **seeds the category**, which is the whole point of a payee
   * knowing where it is usually filed — but only while the user has not answered
   * that question themselves, and only when the default still names a live
   * category. A default pointing at a category since deleted is inert rather than
   * cleared (see `PayeesContext`), so it is checked here, where the live list is
   * in hand, exactly as `defaultBudgetId` is checked in the re-seed effect above.
   */
  function handlePayeeCommit({ payeeId: picked, name }) {
    setPayeeId(picked);
    // The draft is only what to show when there is no record yet; a picked payee
    // carries its own name.
    setPayeeName(picked ? "" : name);
    setError(null);

    const preferred = picked ? payees.find((payee) => payee.id === picked)?.defaultBudgetId : null;
    if (!preferred || chosenBudgetRef.current || splitting) return;
    if (!budgets.some((budget) => budget.id === preferred)) return;
    if (budgetIdRef.current) budgetIdRef.current.value = preferred;
  }

  /** Where a payee is usually filed, as the option's second line. */
  function describePayee(payee) {
    const budget = budgets.find((entry) => entry.id === payee.defaultBudgetId);
    return budget ? budget.name : null;
  }

  function handleSubmit(e) {
    e.preventDefault();

    // Checked before the write, never after: a transaction that landed and then
    // had its division refused would be a receipt in the ledger filed under
    // nothing. The message is `SplitParts`' own, so the two forms that can write
    // a division word one problem the same way.
    if (splitting) {
      const problem = describeSplitProblem(parts, toCents(amountRef.current.value));
      if (problem) {
        setError(problem);
        return;
      }
    }

    // The one rule the store cannot check, checked where the scopes are in hand —
    // the same split as a donation's "no more than the gift itself". Without it a
    // contribution with no category would land under Uncategorized, which is a
    // correct place for stray money and a poor place to leave a known figure.
    // A division answers it, since every part of one names a category.
    if (crossesOut && !splitting && !budgetIdRef.current?.value) {
      setError("Money leaving the budget comes out of a category. Choose the one it came from.");
      return;
    }

    // The payee is resolved — and created, where it is new — before the ledger
    // write, because the transaction has to be able to name it. That is the one
    // place the "ledger first" order cannot be kept, and the residual is benign
    // in a way the other order would not be: a refused transaction can leave a
    // payee with nothing filed under it yet, which is a name in a list the user
    // was about to use anyway, where a transaction naming a payee that was never
    // created would be a row pointing at nothing.
    let resolvedPayeeId = isTransfer ? null : payeeId;
    if (!isTransfer && !resolvedPayeeId && payeeName.trim()) {
      // Checked against the store rather than trusted from the field: a payee
      // added on another device since this form opened is the same payee, not a
      // duplicate to be refused.
      const existing = findPayeeByName(payeeName);
      if (existing) {
        resolvedPayeeId = existing.id;
      } else {
        const created = addPayee({ name: payeeName });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        resolvedPayeeId = created.id;
      }
    }

    const result = addTransaction({
      kind,
      // A transfer moves money between the household's own accounts, so there is
      // nobody it went *to*. Kept in state rather than cleared, the rule a
      // switched-away-from field follows everywhere here — flip back to money out
      // and the payee typed before is still there.
      payeeId: resolvedPayeeId,
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      date: dateRef.current.value,
      accountId: fromAccountId,
      toAccountId: isTransfer ? toAccountId : null,
      // "" is the money-in form's "no category", which the store reads as
      // income. Sent as-is; it is the store's job to know what an empty choice
      // means, not the form's. A transfer that moves no budget money has no
      // category field on screen at all, so there is nothing to send.
      // Null while the parts carry the answer: the record's own category is what
      // a division falls back to when it is undone, and there is nothing to fall
      // back to on one that was never filed under a single category.
      budgetId: splitting
        ? null
        : (isTransfer && !crossesOut ? "" : budgetIdRef.current?.value) || null,
      splits: splitting ? partsToSplits(parts) : null,
    });

    // Keep the modal open on a rejection so the typed details are still there
    // to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  const describe = (account) => `${account.name} — ${formatCents(balanceById.get(account.id) ?? 0)}`;

  /** What this pairing does to the plan, in the words the rest of the app uses. */
  function transferNote() {
    if (crossesOut) {
      return "This money is leaving the budget for a holding, so it comes out of a category the same way spending does — and the holding is credited for it.";
    }
    if (inside(fromAccountId) && inside(toAccountId)) {
      return "Both of these are accounts the budget spends through, so no envelope moves. Paying a card off costs the plan nothing — that money was budgeted on its way out through the card.";
    }
    if (inside(toAccountId)) {
      return "This money is arriving from outside the budget, so it lands in “to be assigned” alongside your income.";
    }
    return "Both of these are off budget, so this moves a holding without touching the plan.";
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New transaction">
      {/* Outside the form: it is a mode, not a field, and putting it in the
          form would have `form.reset()` fighting the state that drives it. */}
      <div className="mb-5 grid grid-cols-3 border border-edge">
        {[
          { value: TRANSACTION_KINDS.OUTFLOW, label: "Money out", tone: "bg-vermilion" },
          { value: TRANSACTION_KINDS.INFLOW, label: "Money in", tone: "bg-verdant" },
          // Neither of the two accents that mean spending or earning, because a
          // transfer is neither and wearing one of them would say it was.
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

      {blocked ? (
        <div className="flex items-start gap-4 font-sans text-row text-chalk-soft">
          <Elder mood={ELDER_MOODS.PONDERING} className="h-14 w-16" />
          {isTransfer && accounts.length < 2 ? (
            <p>
              A transfer moves money between two accounts, and there is only one so far —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add another account
              </Link>{" "}
              first.
            </p>
          ) : spendable.length === 0 ? (
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
          {/* The payee leads, because it is the first thing anybody knows about a
              transaction and because what it is filed under can follow from it. A
              transfer has no payee at all — it moves money between the
              household's own accounts, so there is nobody on the other end — and
              keeps a plain note in its place. */}
          {!isTransfer && (
            <PayeeField
              // Keyed on `show`, which is what re-seeds it: this modal never
              // unmounts, and `PayeeField` holds the letters being typed in state
              // of its own that `form.reset()` cannot reach — the same problem the
              // direction and the two accounts have, answered the same way.
              key={`payee:${show}`}
              label={isOutflow ? "Paid to" : "Received from"}
              payees={orderedPayees}
              value={payeeId}
              draftName={payeeName}
              describePayee={describePayee}
              // Typing away from a payee means the row is no longer that payee,
              // so the id drops and the text stands on its own until an answer is
              // given — at which point `handlePayeeCommit` resolves it.
              onType={(text) => {
                setPayeeName(text);
                setPayeeId(null);
              }}
              onCommit={handlePayeeCommit}
            />
          )}
          <Field
            label="Amount"
            inputRef={amountRef}
            type="text"
            inputMode="decimal"
            required
            onChange={(e) => setTotalCents(toCents(e.target.value))}
          />
          <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
          {/* Keyed on the direction, because the option list is not the same one:
              a transfer may name an off-budget holding and the other two may not,
              so a reused element could be left showing an account no longer on
              offer. */}
          <SelectField
            key={`from:${kind}`}
            label={isTransfer ? "From" : isOutflow ? "Paid from" : "Paid into"}
            defaultValue={fromAccountId}
            onChange={(e) => handleFromChange(e.target.value)}
            required
          >
            {sources.map((account) => (
              <option key={account.id} value={account.id}>
                {describe(account)}
              </option>
            ))}
          </SelectField>
          {isTransfer && (
            // Keyed on the source, since that is what its option list excludes —
            // a remount is how it picks up the destination `handleFromChange`
            // moved out of the way.
            <SelectField
              key={`to:${fromAccountId}`}
              label="To"
              defaultValue={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              required
            >
              {destinations.map((account) => (
                <option key={account.id} value={account.id}>
                  {describe(account)}
                </option>
              ))}
            </SelectField>
          )}
          {/* Keyed on the direction so switching remounts it, which is what
              makes each direction's default its own: a fresh select takes its
              first option, and the first option is the first category for money
              out and "no category" for money in. Without the key the element is
              reused and a category picked for an expense would silently turn the
              next paycheque into a refund. Keyed on whether a category is wanted
              as well, so re-pointing a transfer across the boundary asks the
              question fresh rather than carrying a stale answer into it. */}
          {canSplit && splitting && (
            <SplitParts
              parts={parts}
              budgets={budgets}
              totalCents={totalCents}
              onChange={setParts}
            />
          )}
          {(needsCategory || isInflow) && budgets.length > 0 && !splitting && (
            <SelectField
              key={`budget:${kind}:${needsCategory}`}
              label={isTransfer ? "Comes out of" : isOutflow ? "Category" : "Refund to category"}
              selectRef={budgetIdRef}
              required={needsCategory}
              // An answer given here is an answer, so a payee picked afterwards
              // stops seeding it. Tracked in a ref rather than state because
              // nothing on screen depends on it.
              onChange={() => {
                chosenBudgetRef.current = true;
              }}
            >
              {/* A transfer out of the budget has no sensible default — which
                  savings category a contribution comes from is exactly what the
                  app cannot guess — so its blank is a prompt rather than an
                  answer, and `required` is what makes it one. */}
              {crossesOut && <option value="">Choose a category</option>}
              {isInflow && <option value="">None — income to assign</option>}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </SelectField>
          )}
          {canSplit && (
            <div className="-mt-2 mb-5">
              <Button variant="outline" size="sm" type="button" onClick={handleSplitToggle}>
                {splitting ? "File it all under one category" : "Split it between categories"}
              </Button>
            </div>
          )}
          {/* Last of the fields, and after the category, because that is the order
              the questions are actually answered in: who, how much, when, from
              where, what for — and then anything else worth remembering about it.
              On a transfer it is the only text field, since there is no payee. */}
          <Field
            label={isTransfer ? "Description" : "Note"}
            inputRef={descriptionRef}
            type="text"
            placeholder={isTransfer ? undefined : "Optional"}
          />
          {isInflow && !splitting && (
            <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
              Income lands in “to be assigned”, where you give it a job. Pick a category instead
              only if this is money coming back — a refund, or a share someone paid you back — and
              it will go straight back into that envelope.
            </p>
          )}
          {isTransfer && (
            <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">{transferNote()}</p>
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
