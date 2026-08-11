import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useBudgets, UNGROUPED_ID } from "../contexts/BudgetsContext";

// The estimate used to be filed against a month, so this had to create the
// category and then write a plan against it — two writes, with a bad figure
// able to strand a category with nothing planned. It is one standing figure on
// the record now, so there is one write and `addBudget` does all the checking.
//
// `defaultGroupId` is the group the modal was opened from, so adding a category
// from a heading files it under that heading. Opened from the page header it is
// undefined, which reads as ungrouped.
export default function AddBudgetModal({ show, handleClose, defaultGroupId }) {
  const formRef = useRef();
  const nameRef = useRef();
  const plannedRef = useRef();
  const groupIdRef = useRef();
  const [error, setError] = useState(null);

  const { addBudget, groups } = useBudgets();

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens. The select is set explicitly rather than left
  // to `defaultValue`, which only ever applies on the first mount, when
  // `defaultGroupId` was still undefined.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    const known = groups.some((group) => group.id === defaultGroupId);
    groupIdRef.current.value = known ? defaultGroupId : "";
  }, [show, defaultGroupId, groups]);

  function handleSubmit(e) {
    e.preventDefault();

    // "" is what the ungrouped option is worth in the DOM; the store wants null.
    const groupId = groupIdRef.current.value || UNGROUPED_ID;
    const result = addBudget({
      name: nameRef.current.value,
      planned: plannedRef.current.value,
      groupId,
    });

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
    <Dialog show={show} handleClose={handleClose} title="New category">
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <Field
          label="Monthly estimate"
          inputRef={plannedRef}
          type="number"
          required
          min={0}
          step={0.01}
        />
        <SelectField label="Group" selectRef={groupIdRef}>
          <option value="">Ungrouped</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </SelectField>
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
