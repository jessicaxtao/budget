import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import {
  DEFAULT_BUCKET,
  PLAN_BUCKET_LABELS,
  PLAN_BUCKET_ORDER,
  useBudgets,
  UNGROUPED_ID,
} from "../contexts/BudgetsContext";

// The estimate used to be filed against a month, so this had to create the
// category and then write a plan against it — two writes, with a bad figure
// able to strand a category with nothing planned. It is one standing figure on
// the record now, so there is one write and `addBudget` does all the checking.
//
// `defaultGroupId` is the group the modal was opened from, so adding a category
// from a heading files it under that heading. Opened from the page header it is
// undefined, which reads as ungrouped.

/** The bucket a category filed under `id` starts on. */
const bucketOf = (groups, id) =>
  groups.find((group) => group.id === id)?.bucket ?? DEFAULT_BUCKET;

export default function AddBudgetModal({ show, handleClose, defaultGroupId }) {
  const formRef = useRef();
  const nameRef = useRef();
  const plannedRef = useRef();
  const goalRef = useRef();
  const groupIdRef = useRef();
  const bucketRef = useRef();
  // Whether the user has answered the bucket question themselves. Until they do,
  // the field follows the group they pick — which is what "the group's default"
  // means now that it is a starting value rather than a standing arrangement.
  // Once they have, it stays put: a choice already made is not a default.
  const chosenRef = useRef(false);
  const [error, setError] = useState(null);

  const { addBudget, groups } = useBudgets();

  // The modal stays mounted, so clear the previous entry — and the previous
  // error — each time it opens. The selects are set explicitly rather than left
  // to `defaultValue`, which only ever applies on the first mount, when
  // `defaultGroupId` was still undefined.
  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    setError(null);
    const known = groups.some((group) => group.id === defaultGroupId);
    groupIdRef.current.value = known ? defaultGroupId : "";
    bucketRef.current.value = bucketOf(groups, known ? defaultGroupId : UNGROUPED_ID);
    chosenRef.current = false;
  }, [show, defaultGroupId, groups]);

  function handleGroupChange(e) {
    if (chosenRef.current) return;
    bucketRef.current.value = bucketOf(groups, e.target.value || UNGROUPED_ID);
  }

  function handleSubmit(e) {
    e.preventDefault();

    // "" is what the ungrouped option is worth in the DOM; the store wants null.
    const groupId = groupIdRef.current.value || UNGROUPED_ID;
    const result = addBudget({
      name: nameRef.current.value,
      planned: plannedRef.current.value,
      // Left blank by most categories, which is what no goal looks like. The
      // store reads the empty string as none rather than as zero.
      goal: goalRef.current.value,
      groupId,
      bucket: bucketRef.current.value,
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
        {/* Text, not `type="number"`, like every money field here: a number
            input refuses "$1,200" and "1,200" alike — the box looks filled and
            reads back empty — where `toCents` takes both. What it rejects is
            still rejected, by the store, which is where the figure has to be
            checked anyway. */}
        <Field
          label="Monthly estimate"
          inputRef={plannedRef}
          type="text"
          inputMode="decimal"
          required
        />
        {/* Optional, and the only field here that is: a goal is a balance the
            category is saving towards — $2,000 in the car fund — where the
            estimate above is what it needs in an ordinary month. Most
            categories have one figure and not the other, so this one is left
            blank rather than answered with a zero. */}
        <Field
          label="Goal (optional)"
          inputRef={goalRef}
          type="text"
          inputMode="decimal"
          placeholder="No goal"
        />
        <SelectField label="Group" selectRef={groupIdRef} onChange={handleGroupChange}>
          <option value="">Ungrouped</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="What it's for"
          selectRef={bucketRef}
          onChange={() => {
            chosenRef.current = true;
          }}
        >
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
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
