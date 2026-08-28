import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import { amountEditing } from "../utils";

/**
 * Add a medium-term savings goal — a camera, a wedding, a special event — or
 * edit one that exists.
 *
 * `goal` decides which, the same way `account` does on `AddAccountModal`:
 * absent, this adds one; present, it amends that one. Uncontrolled and
 * re-seeded on open, the contract every add-modal in the app keeps — the
 * modal stays mounted, so nothing else clears the previous entry.
 */
export default function AddSavingsGoalModal({ show, goal, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const targetRef = useRef();
  const targetDateRef = useRef();
  const [error, setError] = useState(null);

  const { addSavingsGoal, updateSavingsGoal } = useSavingsGoals();

  const editing = goal != null;

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = goal?.name ?? "";
    // `amountEditing`, not a bare `fromCents`: the raw-under-the-caret face
    // keeps both decimal places, so a $1,250.50 target does not seed as
    // "1250.5" — the exact defect that keeps every money field off `type=number`.
    targetRef.current.value = goal ? amountEditing(goal.targetCents) : "";
    targetDateRef.current.value = goal?.targetDate ?? "";
  }, [show, goal]);

  function handleSubmit(event) {
    event.preventDefault();

    const fields = {
      name: nameRef.current.value,
      target: targetRef.current.value,
      targetDate: targetDateRef.current.value || null,
    };
    const result = editing ? updateSavingsGoal({ id: goal.id, ...fields }) : addSavingsGoal(fields);

    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={editing ? "Edit savings goal" : "New savings goal"}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field
          label="Target amount"
          inputRef={targetRef}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          required
        />
        <Field
          label="Target date (optional)"
          inputRef={targetDateRef}
          type="date"
        />
        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add goal"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
