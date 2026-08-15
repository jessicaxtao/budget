import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import {
  DEFAULT_BUCKET,
  PLAN_BUCKET_LABELS,
  PLAN_BUCKET_ORDER,
  useBudgets,
} from "../contexts/BudgetsContext";

/**
 * A heading to file categories under, or an edit of one that exists.
 *
 * A group is a name and the bucket its categories fall back to, so both jobs are
 * the same form. `group` decides which: absent, this adds one; present, it edits
 * that one. Editing is a modal rather than an inline control because the two
 * fields are all a group has, and a mis-click that half-commits them would leave
 * a heading the user cannot connect to anything.
 *
 * The default is offered at creation rather than only afterwards: households
 * mostly group by purpose already, so "Fun" the group and Fun the bucket are one
 * decision, and making the user come back for the second half of it invites a
 * group full of categories quietly counted as essentials.
 */
export default function AddGroupModal({ show, handleClose, group }) {
  const formRef = useRef();
  const nameRef = useRef();
  const bucketRef = useRef();
  const [error, setError] = useState(null);

  const { addGroup, updateGroup } = useBudgets();
  const editing = group != null;

  // The modal stays mounted, so re-seed each time it opens — with the existing
  // values when editing, since the user is amending them rather than stating
  // them fresh. `defaultValue` would only have applied on the first mount.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = group?.name ?? "";
    bucketRef.current.value = group?.bucket ?? DEFAULT_BUCKET;
  }, [show, group]);

  function handleSubmit(e) {
    e.preventDefault();

    const fields = { name: nameRef.current.value, bucket: bucketRef.current.value };
    const result = editing ? updateGroup({ id: group.id, ...fields }) : addGroup(fields);

    // Keep the modal open on a clash so the typed name is still there to edit.
    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={editing ? "Edit group" : "New group"}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
        <SelectField label="Categories default to" selectRef={bucketRef}>
          {PLAN_BUCKET_ORDER.map((bucket) => (
            <option key={bucket} value={bucket}>
              {PLAN_BUCKET_LABELS[bucket]}
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
            {editing ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
