import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useIncome } from "../contexts/IncomeContext";
import { todayISO } from "../utils";

export default function AddIncomeModal({ show, handleClose }) {
  const formRef = useRef();
  const descriptionRef = useRef();
  const amountRef = useRef();
  const dateRef = useRef();
  const [error, setError] = useState(null);

  const { addIncome } = useIncome();

  // The modal stays mounted, so clear the previous entry each time it opens —
  // this also covers the case where the last visit was cancelled, not submitted.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    dateRef.current.value = todayISO();
  }, [show]);

  function handleSubmit(e) {
    e.preventDefault();
    const result = addIncome({
      description: descriptionRef.current.value,
      amount: amountRef.current.value,
      date: dateRef.current.value,
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New income">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Description" inputRef={descriptionRef} type="text" required />
        <Field label="Amount" inputRef={amountRef} type="number" required min={0} step={0.01} />
        <Field label="Date" inputRef={dateRef} type="date" required defaultValue={todayISO()} />
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
