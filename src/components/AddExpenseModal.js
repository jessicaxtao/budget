import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useBudgets, UNCATEGORIZED_BUDGET_ID } from "../contexts/BudgetsContext";
import { todayISO } from "../utils";

export default function AddExpenseModal({ show, handleClose, defaultBudgetId }) {
  const formRef = useRef();
  const descriptionRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const budgetIdRef = useRef();
  const [error, setError] = useState(null);

  const { addExpense, budgets } = useBudgets();

  // The modal never unmounts — it is toggled by `show` — so nothing clears the
  // last entry, and `defaultValue` on the select only ever applied on the first
  // mount, when defaultBudgetId was still undefined. Re-seed the form each time
  // it opens instead.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    dateRef.current.value = todayISO();
    const known = budgets.some((budget) => budget.id === defaultBudgetId);
    budgetIdRef.current.value = known ? defaultBudgetId : UNCATEGORIZED_BUDGET_ID;
  }, [show, defaultBudgetId, budgets]);

  function handleSubmit(e) {
    e.preventDefault();
    const result = addExpense({
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      budgetId: budgetIdRef.current.value,
      date: dateRef.current.value,
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New expense">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Description" inputRef={descriptionRef} type="text" required />
        <Field label="Amount" inputRef={amountRef} type="number" required min={0} step={0.01} />
        <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
        <label className="mb-5 block">
          <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">Budget</span>
          <select
            ref={budgetIdRef}
            className="w-full border-0 border-b-2 border-edge bg-panel px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors focus:border-azure"
          >
            <option value={UNCATEGORIZED_BUDGET_ID}>Uncategorized</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </select>
        </label>
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
    </Dialog>
  );
}
