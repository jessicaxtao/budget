import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useBudgets } from "../contexts/BudgetsContext";
import { useBudgetPlan } from "../contexts/BudgetPlanContext";
import { currentPeriod, toCents } from "../utils";

// `period` is the month the estimate is filed under — the one the plan page is
// currently showing, which is not necessarily the current one.
export default function AddBudgetModal({ show, handleClose, period }) {
  const formRef = useRef();
  const nameRef = useRef();
  const maxRef = useRef();
  const [error, setError] = useState(null);

  const { addBudget } = useBudgets();
  const { setPlannedAmount } = useBudgetPlan();

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
  }, [show]);

  function handleSubmit(e) {
    e.preventDefault();

    // Checked before the budget is created so a bad figure cannot leave a
    // category behind with no estimate against it.
    const cents = toCents(maxRef.current.value);
    if (cents == null || cents < 0) {
      setError("Enter a monthly estimate of zero or more.");
      maxRef.current.focus();
      return;
    }

    const result = addBudget({ name: nameRef.current.value });

    // Keep the modal open on a clash so the typed name is still there to edit.
    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    // The estimate lives with the plan for this period, not on the budget, so
    // changing it next month leaves this month's history intact.
    setPlannedAmount({ budgetId: result.id, period: period ?? currentPeriod(), plannedCents: cents });
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New category">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field label="Monthly estimate" inputRef={maxRef} type="number" required min={0} step={0.01} />
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
