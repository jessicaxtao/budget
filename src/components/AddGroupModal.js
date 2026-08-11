import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field from "./Field";
import Button from "./Button";
import { useBudgets } from "../contexts/BudgetsContext";

/**
 * A heading to file categories under, or a rename of one that exists.
 *
 * A group is only a name, so both jobs are the same form. `group` decides
 * which: absent, this adds one; present, it renames that one. Renaming is a
 * modal rather than an inline edit because the name is the only thing a group
 * has, and a mis-click that half-commits it would leave a heading the user
 * cannot connect to anything.
 */
export default function AddGroupModal({ show, handleClose, group }) {
  const formRef = useRef();
  const nameRef = useRef();
  const [error, setError] = useState(null);

  const { addGroup, renameGroup } = useBudgets();
  const editing = group != null;

  // The modal stays mounted, so re-seed each time it opens — with the existing
  // name when renaming, since the user is editing it rather than typing it
  // fresh. `defaultValue` would only have applied on the first mount.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    nameRef.current.value = group?.name ?? "";
  }, [show, group]);

  function handleSubmit(e) {
    e.preventDefault();

    const name = nameRef.current.value;
    const result = editing ? renameGroup({ id: group.id, name }) : addGroup({ name });

    // Keep the modal open on a clash so the typed name is still there to edit.
    if (!result.ok) {
      setError(result.error);
      nameRef.current.focus();
      return;
    }

    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={editing ? "Rename group" : "New group"}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <Field label="Name" inputRef={nameRef} type="text" required />
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
