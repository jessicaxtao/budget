import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { CADENCE_KEYS, CADENCES, DEFAULT_CADENCE } from "../recurrence";
import { todayISO } from "../utils";

/**
 * A recurring source of income the plan should expect.
 *
 * "First payment" is a real date rather than a day of the month because that is
 * what a fortnightly schedule needs: without a day on the calendar there is no
 * way to know whether a given month holds two payments or three. For the
 * monthly cadences only its day-of-month matters.
 */
export default function AddIncomeSourceModal({ show, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const amountRef = useRef();
  const cadenceRef = useRef();
  const anchorDateRef = useRef();
  const endDateRef = useRef();
  const [error, setError] = useState(null);

  const { addIncomeSource } = useIncomePlan();

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens. The select is set explicitly rather than left to
  // `defaultValue`, which only ever applies on the first mount.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    cadenceRef.current.value = DEFAULT_CADENCE;
    anchorDateRef.current.value = todayISO();
    endDateRef.current.value = "";
  }, [show]);

  function handleSubmit(e) {
    e.preventDefault();

    const result = addIncomeSource({
      name: nameRef.current.value,
      amount: amountRef.current.value,
      cadence: cadenceRef.current.value,
      anchorDate: anchorDateRef.current.value,
      endDate: endDateRef.current.value,
    });

    // Keep the modal open on a rejection so the typed figures are still there
    // to correct.
    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="New income source">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field
          label="Amount per payment"
          inputRef={amountRef}
          type="number"
          required
          min={0}
          step={0.01}
        />
        <label className="mb-5 block">
          <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">
            How often
          </span>
          <select
            ref={cadenceRef}
            defaultValue={DEFAULT_CADENCE}
            className="w-full border-0 border-b-2 border-edge bg-panel px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors focus:border-azure"
          >
            {CADENCE_KEYS.map((cadence) => (
              <option key={cadence} value={cadence}>
                {CADENCES[cadence].label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="First payment"
          inputRef={anchorDateRef}
          type="date"
          required
          defaultValue={todayISO()}
        />
        {/* Optional, and worth having: retiring a source keeps the months it did
            pay out intact, where deleting it would rewrite them. */}
        <Field label="Last payment (optional)" inputRef={endDateRef} type="date" />
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
