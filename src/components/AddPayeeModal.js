import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";

/**
 * A payee stated up front, rather than named on the transaction that needed it.
 *
 * Add only, unlike `AddAccountModal` and `AddOrganizationModal`, which double as
 * their own edit form. Both of a payee's answers are editable on its row in
 * `PayeeList` — the name commits on blur, the default category on change — so a
 * modal that restated them would be a second door onto one field. What it is for
 * is the case the row cannot cover: a payee that does not exist yet, usually
 * because the household knows where it will be filed before the first
 * transaction to it arrives.
 *
 * Uncontrolled and re-seeded on open, like every other form here: the modal never
 * unmounts, so nothing clears the last entry and a `<select>`'s `defaultValue`
 * would only ever apply on the first mount.
 */
export default function AddPayeeModal({ show, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const budgetIdRef = useRef();
  const [error, setError] = useState(null);

  const { addPayee } = usePayees();
  const { budgets } = useBudgets();

  useEffect(() => {
    if (!show) return;
    setError(null);
    formRef.current?.reset();
  }, [show]);

  function handleSubmit(e) {
    e.preventDefault();
    const result = addPayee({
      name: nameRef.current.value,
      // "" is what the blank option is worth in the DOM, and the store reads it
      // as no default — which is the ordinary answer.
      defaultBudgetId: budgetIdRef.current?.value,
    });
    // Kept open on a rejection, so the typed name is still there to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New payee">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        {budgets.length > 0 && (
          <SelectField label="Usually filed under" selectRef={budgetIdRef}>
            {/* A prompt would be wrong here: no default is a real answer and the
                common one, so the blank is the first option rather than something
                the form insists on being replaced. */}
            <option value="">None</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </SelectField>
        )}
        <p className="-mt-1 mb-5 font-sans text-row text-chalk-soft">
          A category here is a starting point, not a rule: it is what the next transaction to this
          payee opens on, and it never changes what is already filed.
        </p>
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
