import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";

/**
 * Add a medium-term savings goal — a camera, a wedding, a special event.
 * Uncontrolled and re-seeded on open, the same contract as every other
 * add-modal in the app: the modal stays mounted, so nothing else clears the
 * previous entry.
 */
export default function AddSavingsGoalModal({ show, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const targetRef = useRef();
  const targetDateRef = useRef();
  const [error, setError] = useState(null);

  const { addSavingsGoal } = useSavingsGoals();

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
  }, [show]);

  function handleSubmit(event) {
    event.preventDefault();

    const result = addSavingsGoal({
      name: nameRef.current.value,
      target: targetRef.current.value,
      targetDate: targetDateRef.current.value || null,
    });

    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New savings goal">
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
            Add goal
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
