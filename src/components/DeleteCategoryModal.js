import { useEffect, useRef } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { SelectField } from "./Field";
import { UNCATEGORIZED_BUDGET_ID, useBudgets } from "../contexts/BudgetsContext";

/**
 * The one confirmation a category's Remove button opens onto.
 *
 * Deleting a category does not delete what it paid for — `deleteBudget`
 * reassigns the spend and the funding rather than dropping either, the rule
 * `STORES.md` states for `BudgetsContext`. What used to be silent is the
 * household's own choice of *where* that lands: this always defaulted to
 * Uncategorized and still does, but a shop filed under "Groceries" for three
 * years is more often a duplicate of "Food" than it is nothing in particular,
 * and reassigning it by hand afterwards is the same cascade with extra steps.
 *
 * Uncontrolled and re-seeded on open like every other form here, even though
 * its one real field is a `<select>` with nothing to half-type: the category
 * being deleted can change between opens of a modal that never unmounts, and
 * the picker has to stop offering the row that is about to disappear.
 */
export default function DeleteCategoryModal({ show, handleClose, budget, categories }) {
  const formRef = useRef();
  const selectRef = useRef();
  const { deleteBudget } = useBudgets();

  useEffect(() => {
    if (!show) return;
    formRef.current.reset();
    selectRef.current.value = UNCATEGORIZED_BUDGET_ID;
  }, [show, budget]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!budget) return;
    deleteBudget({ id: budget.id, reassignToId: selectRef.current.value });
    handleClose();
  }

  // A category without its own row to be deleted out from under — the modal
  // stays mounted, so this guards the render between a close and the next
  // open rather than ever being shown.
  if (!budget) return null;

  const others = categories.filter((category) => category.id !== budget.id);

  return (
    <Dialog show={show} handleClose={handleClose} title={`Remove ${budget.name}?`}>
      <form ref={formRef} onSubmit={handleSubmit}>
        <p className="mb-5 font-sans text-row text-chalk-soft">
          Nothing it already paid for disappears with it — every transaction and every month
          already assigned to {budget.name} moves to the category chosen below.
        </p>
        <SelectField label="Move its transactions and funding to" selectRef={selectRef}>
          <option value={UNCATEGORIZED_BUDGET_ID}>Uncategorized</option>
          {others.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="danger" type="submit">
            Remove
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
