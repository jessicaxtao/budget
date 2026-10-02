import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import PayeeField from "./PayeeField";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { SCHEDULE_KINDS, useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { orderPayeesByUse } from "../payeeSearch";
import { DEFAULT_RECURRENCE, RECURRENCE_KEYS, RECURRENCES } from "../recurrence";
import { amountEditing, todayISO } from "../utils";

/**
 * Schedule a transaction, or edit one that exists.
 *
 * `schedule` decides which, the same way `account` does on `AddAccountModal` — the
 * fifth modal in the app to work that way, and for its reason: a schedule is a
 * handful of answers that are stated the same way whenever they are stated.
 *
 * **It asks the same questions `AddTransactionModal` asks, minus the ones a
 * prediction cannot answer.** No split — a receipt is divided when it is entered,
 * see `SchedulesContext` — and no transfer, since a transfer names no payee and
 * what it means to the budget is decided by a rule that lives in the entry form.
 * What it adds is the recurrence and the date the first one falls on.
 *
 * **The payee leads, through the shared `PayeeField`**, so a schedule cannot come
 * to disagree with the register about what a match is. Its default category seeds
 * the category select exactly as it does on the entry form — a schedule *is* an
 * entry form, one written in advance — but only while adding: on a schedule that
 * already exists the question has an answer, and correcting a name must not refile
 * the bill. That is the same line the register draws, one surface over.
 *
 * Uncontrolled and re-seeded on open, with the direction held in state because it
 * decides which other fields exist and `form.reset()` cannot reach it — the
 * entry form's first exception, for the entry form's reason.
 */
export default function AddScheduleModal({ show, schedule, handleClose }) {
  const formRef = useRef();
  const amountRef = useRef();
  const startDateRef = useRef();
  const endsOnRef = useRef();
  const accountIdRef = useRef();
  const budgetIdRef = useRef();
  const cadenceRef = useRef();
  const descriptionRef = useRef();
  const [error, setError] = useState(null);
  const [kind, setKind] = useState(TRANSACTION_KINDS.OUTFLOW);
  const [payeeId, setPayeeId] = useState(null);
  const [payeeName, setPayeeName] = useState("");
  // Whether the category question has a real answer behind it. `AddBudgetModal`'s
  // idiom: a choice already made is not a default. It starts answered when
  // editing, since the stored record *is* the answer.
  const chosenBudgetRef = useRef(false);

  const { addSchedule, updateSchedule } = useSchedules();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees, addPayee, findPayeeByName } = usePayees();
  const { transactions } = useTransactions();
  const orderedPayees = useMemo(
    () => orderPayeesByUse(payees, transactions),
    [payees, transactions]
  );

  const editing = schedule != null;
  const isOutflow = kind === TRANSACTION_KINDS.OUTFLOW;
  // Only accounts the budget spends through, the register's rule: nobody schedules
  // a movement inside a holding they do not log transaction by transaction.
  const spendable = accounts.filter(spendsThroughBudget);
  const blocked = spendable.length === 0 || (isOutflow && budgets.length === 0);

  useEffect(() => {
    if (!show) return;
    setError(null);
    setKind(SCHEDULE_KINDS.includes(schedule?.kind) ? schedule.kind : TRANSACTION_KINDS.OUTFLOW);
    setPayeeId(schedule?.payeeId ?? null);
    setPayeeName("");
    chosenBudgetRef.current = editing;
    // Absent while the modal is showing the "nothing to schedule against"
    // message, which renders in place of the form.
    if (!formRef.current) return;

    formRef.current.reset();
    // `amountEditing` rather than a bare `fromCents`, so a $1,250.50 premium does
    // not seed as "1250.5" — the defect that keeps every money field off
    // `type="number"`.
    amountRef.current.value = schedule ? amountEditing(schedule.amountCents) : "";
    // Today for a new one: the first occurrence of a bill somebody is writing down
    // now is almost always this month's, and a date in the past would be offered
    // as overdue the moment the form closed.
    startDateRef.current.value = schedule?.startDate ?? todayISO();
    endsOnRef.current.value = schedule?.endsOn ?? "";
    cadenceRef.current.value = schedule?.cadence ?? DEFAULT_RECURRENCE;
    descriptionRef.current.value = schedule?.description ?? "";
    // The stored account and category always win, even when the list would not
    // offer them — a `<select>` given a value it has no option for falls back to
    // its first, which would silently re-point the schedule by being looked at.
    accountIdRef.current.value = schedule?.accountId ?? spendable[0]?.id ?? "";
    if (budgetIdRef.current) {
      budgetIdRef.current.value =
        schedule?.budgetId ??
        (schedule?.kind === TRANSACTION_KINDS.INFLOW ? "" : budgets[0]?.id ?? "");
    }
    // `spendable` and `budgets` are rebuilt every render; depending on them would
    // re-seed the form out from under the user. Their contents are read at open,
    // which is when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, schedule]);

  /**
   * A payee named: an existing record, or a name that is not one yet.
   *
   * Seeds the category from the payee's default, which is what a default is for —
   * and the check that it names a live category happens here, where the list is in
   * hand, because a default pointing at a deleted one is inert rather than cleared.
   */
  function handlePayeeCommit({ payeeId: picked, name }) {
    setPayeeId(picked);
    setPayeeName(picked ? "" : name);
    setError(null);

    const preferred = picked ? payees.find((payee) => payee.id === picked)?.defaultBudgetId : null;
    if (!preferred || chosenBudgetRef.current) return;
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

    // The payee is resolved — and created where it is new — before the schedule is
    // written, because the schedule has to be able to name it. The residual is the
    // entry form's and is benign the same way: a refused schedule can leave a name
    // in a list the user was about to use anyway.
    let resolvedPayeeId = payeeId;
    if (!resolvedPayeeId && payeeName.trim()) {
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

    const fields = {
      kind,
      payeeId: resolvedPayeeId,
      amount: amountRef.current.value,
      accountId: accountIdRef.current.value,
      budgetId: budgetIdRef.current?.value ?? null,
      cadence: cadenceRef.current.value,
      startDate: startDateRef.current.value,
      endsOn: endsOnRef.current.value || null,
      description: descriptionRef.current.value,
    };

    const result = editing ? updateSchedule({ id: schedule.id, ...fields }) : addSchedule(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={editing ? "Edit schedule" : "Schedule a transaction"}
    >
      {/* Outside the form: it is a mode, not a field, and `form.reset()` would
          fight the state that drives it — the entry form's rule for the same
          control. */}
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
              onClick={() => {
                setKind(option.value);
                setError(null);
              }}
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
              No on-budget account yet. A scheduled transaction has to go through one —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add an account
              </Link>{" "}
              first.
            </p>
          ) : (
            <p>
              No categories yet. Money out is filed under one —{" "}
              <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
                add a category
              </Link>{" "}
              first.
            </p>
          )}
        </div>
      ) : (
        <form ref={formRef} onSubmit={handleSubmit}>
          <PayeeField
            // Keyed on the record and on `show`: this modal never unmounts, and
            // `PayeeField` holds what is typed in state of its own that
            // `form.reset()` cannot reach.
            key={`payee:${show}:${schedule?.id ?? "new"}`}
            label={isOutflow ? "Paid to" : "Received from"}
            payees={orderedPayees}
            value={payeeId}
            draftName={payeeName}
            describePayee={describePayee}
            onType={(text) => {
              setPayeeName(text);
              setPayeeId(null);
            }}
            onCommit={handlePayeeCommit}
          />
          <Field
            label="Amount"
            inputRef={amountRef}
            type="text"
            inputMode="decimal"
            placeholder="$0.00"
            required
          />
          <SelectField label="How often" selectRef={cadenceRef} required>
            {RECURRENCE_KEYS.map((key) => (
              <option key={key} value={key}>
                {RECURRENCES[key].label}
              </option>
            ))}
          </SelectField>
          {/* The anchor, and every later occurrence is computed from it — which is
              why the label says which one it is rather than "start date". A bill on
              the 31st is the 28th in February because of this field. */}
          <Field label="Date of the first one" inputRef={startDateRef} type="date" required />
          <Field label="Last one, if it ends (optional)" inputRef={endsOnRef} type="date" />
          <SelectField
            label={isOutflow ? "Paid from" : "Paid into"}
            selectRef={accountIdRef}
            required
          >
            {spendable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            {/* An account since deleted, or an off-budget one the list does not
                offer, still has an option — otherwise the select would show its
                first entry and the schedule would look re-pointed by being looked
                at, which is the register's rule for the same control. */}
            {schedule?.accountId != null &&
              !spendable.some((account) => account.id === schedule.accountId) && (
                <option value={schedule.accountId}>
                  {accounts.find((account) => account.id === schedule.accountId)?.name ??
                    "Unknown account"}
                </option>
              )}
          </SelectField>
          {budgets.length > 0 && (
            <SelectField
              // Keyed on the direction so switching remounts it and each direction
              // takes its own first option: the first category for money out, "no
              // category" for money in. Reusing the element would quietly turn a
              // scheduled paycheque into a recurring refund.
              key={`budget:${kind}`}
              label={isOutflow ? "Category" : "Refund to category"}
              selectRef={budgetIdRef}
              required={isOutflow}
              onChange={() => {
                chosenBudgetRef.current = true;
              }}
            >
              {!isOutflow && <option value="">None — income to assign</option>}
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
              {schedule?.budgetId != null &&
                !budgets.some((budget) => budget.id === schedule.budgetId) && (
                  <option value={schedule.budgetId}>Unknown category</option>
                )}
            </SelectField>
          )}
          <Field label="Note" inputRef={descriptionRef} type="text" placeholder="Optional" />

          <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
            Nothing is recorded automatically. What is due shows on the dashboard, and a
            transaction is written when you say it happened — so the amount can be whatever the
            statement actually said.
          </p>

          {error && (
            <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button variant="primary" type="submit">
              {editing ? "Save" : "Schedule it"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
