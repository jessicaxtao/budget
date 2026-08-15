import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useDonations } from "../contexts/DonationsContext";

/**
 * Add an organization, or restate one already listed.
 *
 * One modal for both, on an `organization` prop — the third in the app to work
 * that way, after `AddGroupModal` and `AddAccountModal`, and for the same reason:
 * the record is a couple of answers that are stated the same way whenever they
 * are stated, so a separate edit form would be the same two fields with a
 * different heading.
 *
 * **The deductible answer is a default for the next gift, not a fact about the
 * gifts already recorded.** Each of those carries its own deductible figure, so
 * changing this cannot restate what was claimed in a year that may already have
 * been filed. The form says so, because a yes-or-no about tax is exactly the
 * field a reader would expect to reach backwards.
 */
export default function AddOrganizationModal({ show, organization, handleClose }) {
  const formRef = useRef();
  const nameRef = useRef();
  const deductibleRef = useRef();
  const [error, setError] = useState(null);

  const { addRecipient, updateRecipient } = useDonations();

  const editing = organization != null;
  // The select takes the same seed as its `defaultValue` rather than only being
  // written through the ref: it never unmounts here, but the pairing is what
  // `AddAccountModal` learned the hard way, and a form that seeds one way and
  // renders another is one refactor from being wrong.
  const seedDeductible = organization?.deductible === false ? "no" : "yes";

  // The modal stays mounted, so nothing clears the previous entry — and
  // `defaultValue` on a select only ever applies on the first mount, when the
  // record being edited was still undefined. Re-seed on every open.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = organization?.name ?? "";
    deductibleRef.current.value = organization?.deductible === false ? "no" : "yes";
  }, [show, organization]);

  function handleSubmit(event) {
    event.preventDefault();

    const fields = {
      name: nameRef.current.value,
      deductible: deductibleRef.current.value === "yes",
    };
    const result = editing
      ? updateRecipient({ id: organization.id, ...fields })
      : addRecipient(fields);

    // Keep the modal open on a rejection so the typed name is still there to
    // edit.
    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      title={editing ? "Edit organization" : "New organization"}
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <SelectField
          label="Gifts here are tax deductible"
          selectRef={deductibleRef}
          defaultValue={seedDeductible}
        >
          <option value="yes">Yes — a qualified charity</option>
          <option value="no">No</option>
        </SelectField>
        <p className="-mt-3 mb-5 font-sans text-row text-chalk-soft">
          This is what a new gift here starts on. Every gift already recorded keeps the deductible
          amount it was given, so changing this now cannot restate a year already filed.
        </p>
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
