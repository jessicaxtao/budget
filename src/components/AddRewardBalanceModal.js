import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import ProgramOptions from "./ProgramOptions";
import { useRewards } from "../contexts/RewardsContext";
import { CATALOG, isCashProgram } from "../domain/rewards";
import { amountEditing, todayISO } from "../utils";

/**
 * A points or miles balance — one program, one person — or an edit of one.
 *
 * `balance` decides which, as `goal` does on `AddSavingsGoalModal`. Uncontrolled
 * and re-seeded on open, the contract every add-modal in the app keeps. The
 * points field is text rather than a number input so "125,000" is taken as
 * written, the way a statement prints it.
 *
 * **"Cash back" is tracked in the same field, but it is money, not points** —
 * an issuer's own unredeemed balance, read and written like every other
 * money figure rather than a point count. `cash` mirrors which the selected
 * program is, the way `AddOfferModal` mirrors its kind select, so the one
 * field can swap what it asks for without becoming two fields.
 */
export default function AddRewardBalanceModal({ show, balance, onAdded, handleClose }) {
  const formRef = useRef();
  const programRef = useRef();
  const holderRef = useRef();
  const pointsRef = useRef();
  const asOfRef = useRef();
  const [cash, setCash] = useState(false);
  const [error, setError] = useState(null);

  const { addBalance, updateBalance } = useRewards();
  const editing = balance != null;

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    const programId = balance?.programId ?? CATALOG[0].id;
    programRef.current.value = programId;
    setCash(isCashProgram(programId));
    holderRef.current.value = balance?.holder ?? "";
    pointsRef.current.value = balance
      ? isCashProgram(programId)
        ? amountEditing(balance.points)
        : String(balance.points)
      : "";
    asOfRef.current.value = balance ? balance.asOf ?? "" : todayISO();
  }, [show, balance]);

  function handleSubmit(event) {
    event.preventDefault();
    const fields = {
      programId: programRef.current.value,
      holder: holderRef.current.value,
      points: pointsRef.current.value,
      asOf: asOfRef.current.value || null,
    };
    const result = editing ? updateBalance({ id: balance.id, ...fields }) : addBalance(fields);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!editing) onAdded?.(fields.programId);
    handleClose();
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={editing ? "Edit balance" : "New balance"}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <SelectField
          label="Program"
          selectRef={programRef}
          defaultValue={CATALOG[0].id}
          onChange={(event) => setCash(isCashProgram(event.target.value))}
        >
          <ProgramOptions />
        </SelectField>
        {cash ? (
          <Field
            label="Balance"
            inputRef={pointsRef}
            type="text"
            inputMode="decimal"
            placeholder="$0.00"
            required
          />
        ) : (
          <Field label="Points or miles" inputRef={pointsRef} type="text" inputMode="numeric" required />
        )}
        <Field label="Whose (optional)" inputRef={holderRef} type="text" placeholder="e.g. Alex" />
        <Field label="Balance as of" inputRef={asOfRef} type="date" />
        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            {editing ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
