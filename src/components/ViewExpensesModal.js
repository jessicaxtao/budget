import Dialog from "./Dialog";
import Button from "./Button";
import LedgerList from "./LedgerList";
import { UNCATEGORIZED_BUDGET_ID, useBudgets } from "../contexts/BudgetsContext";

export default function ViewExpensesModal({ budgetId, handleClose }) {
  const { getBudgetExpenses, budgets, deleteBudget, deleteExpense } = useBudgets();

  const expenses = getBudgetExpenses(budgetId);
  const budget =
    UNCATEGORIZED_BUDGET_ID === budgetId
      ? { name: "Uncategorized", id: UNCATEGORIZED_BUDGET_ID }
      : budgets.find((b) => b.id === budgetId);

  return (
    <Dialog
      show={budgetId != null}
      handleClose={handleClose}
      title={
        <div className="flex flex-wrap items-center gap-3">
          <span>Expenses — {budget?.name ?? "Unknown category"}</span>
          {/* Guarded on the record, not just the sentinel: an id with expenses
              against it but no category to match has nothing to delete, and
              deleteBudget would destructure undefined. */}
          {budget && budgetId !== UNCATEGORIZED_BUDGET_ID && (
            <Button
              onClick={() => {
                deleteBudget(budget);
                handleClose();
              }}
              variant="danger"
              size="sm"
            >
              Delete category
            </Button>
          )}
        </div>
      }
    >
      <LedgerList
        entries={expenses}
        onDelete={deleteExpense}
        removeLabel="Remove expense"
        emptyMessage="No expenses logged in this category yet."
      />
    </Dialog>
  );
}
