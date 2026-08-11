import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { CADENCE_KEYS, CADENCES, DEFAULT_CADENCE, monthlyCents } from "../cadence";
import { formatCents, toCents } from "../utils";

/**
 * A recurring source of income the plan should expect.
 *
 * Two fields and a cadence, and deliberately no date. This describes income in
 * general — what arrives, how often — not what lands in a named month, so
 * there is no payday to anchor to. The form shows the monthly average it works
 * out to as the user types, because that average is the surprising part: "every
 * 2 weeks" is 2.1667 payments a month, not two, and a figure the user did not
 * type has to show itself before it turns up in the plan.
 */
export default function AddIncomeSourceModal({ show, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const amountRef = useRef();
  const cadenceRef = useRef();
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(0);

  const { addIncomeSource } = useIncomePlan();

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens. The select is set explicitly rather than left to
  // `defaultValue`, which only ever applies on the first mount.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    cadenceRef.current.value = DEFAULT_CADENCE;
    setPreview(0);
  }, [show]);

  // One form-level handler rather than state per field: the preview is derived
  // from what is already in the DOM, and holding a copy of it in React would
  // give the form two ideas of what the user typed.
  function handleChange() {
    const cents = toCents(amountRef.current.value);
    setPreview(cents == null ? 0 : monthlyCents(cents, cadenceRef.current.value));
  }

  function handleSubmit(e) {
    e.preventDefault();

    const result = addIncomeSource({
      name: nameRef.current.value,
      amount: amountRef.current.value,
      cadence: cadenceRef.current.value,
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
      <form ref={formRef} onChange={handleChange} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field
          label="Amount per payment"
          inputRef={amountRef}
          type="number"
          required
          min={0}
          step={0.01}
        />
        <SelectField label="How often" selectRef={cadenceRef} defaultValue={DEFAULT_CADENCE}>
          {CADENCE_KEYS.map((cadence) => (
            <option key={cadence} value={cadence}>
              {CADENCES[cadence].label}
            </option>
          ))}
        </SelectField>
        <p role="status" className="-mt-3 mb-5 font-mono text-label uppercase text-chalk-soft">
          Adds{" "}
          <span className="font-medium text-verdant">{formatCents(preview)}</span> to expected
          income each month
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
