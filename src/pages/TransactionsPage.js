import { useState } from "react";
import { Link } from "react-router-dom";
import BudgetCard from "../components/BudgetCard";
import ToBeAssignedCard from "../components/ToBeAssignedCard";
import AddExpenseModal from "../components/AddExpenseModal";
import AddIncomeModal from "../components/AddIncomeModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import UncategorizedBudgetCard from "../components/UncategorizedBudgetCard";
import TotalBudgetCard from "../components/TotalBudgetCard";
import ViewExpensesModal from "../components/ViewExpensesModal";
import ViewIncomeModal from "../components/ViewIncomeModal";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/BudgetsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import { currentPeriod } from "../utils";

export default function TransactionsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [viewExpensesModalBudgetId, setViewExpensesModalBudgetId] = useState();
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [addExpenseModalBudgetId, setAddExpenseModalBudgetId] = useState();

  // Every figure on this page comes from one derivation at one period. The
  // all-time totals the contexts also expose are on a different clock — they
  // count future-dated records — and mixing the two would put two figures on
  // screen that disagree with nothing to explain why.
  const {
    rows,
    toBeAssignedCents,
    totalCarriedInCents,
    periodIncomeCents,
    periodAssignedCents,
    periodSpentCents,
  } = useEnvelopes(period);

  const categoryRows = rows.filter((row) => row.kind === "category");
  const uncategorizedRow = rows.find((row) => row.kind === "uncategorized");
  const orphanRows = rows.filter((row) => row.kind === "orphan");

  function openAddExpenseModal(budgetId) {
    setShowAddExpenseModal(true);
    setAddExpenseModalBudgetId(budgetId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Day to day"
        title="Transactions"
        description="Record income and expenses as they land, give every dollar a category, and see what each envelope has left."
        actions={
          <>
            <PeriodStepper period={period} onChange={setPeriod} />
            <Button variant="primary" onClick={() => setShowAssignModal(true)}>
              Assign income
            </Button>
            <Button variant="outline" onClick={() => openAddExpenseModal()}>
              Add expense
            </Button>
            <Button variant="outline" onClick={() => setShowAddIncomeModal(true)}>
              Add income
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4">
        <ToBeAssignedCard
          toBeAssignedCents={toBeAssignedCents}
          periodIncomeCents={periodIncomeCents}
          periodAssignedCents={periodAssignedCents}
          onAssignClick={() => setShowAssignModal(true)}
          onViewIncomeClick={() => setShowIncomeModal(true)}
        />
        {categoryRows.length === 0 && (
          <div className="border border-dashed border-edge bg-panel/60 p-4 font-sans text-row text-chalk-soft">
            Every category starts empty.{" "}
            <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
              Add one on the budget plan
            </Link>{" "}
            to start assigning your income.
          </div>
        )}
        {categoryRows.map((row) => (
          <BudgetCard
            key={row.budgetId}
            name={row.name}
            carriedInCents={row.carriedInCents}
            assignedCents={row.assignedCents}
            spentCents={row.spentCents}
            plannedCents={row.plannedCents}
            onAddExpenseClick={() => openAddExpenseModal(row.budgetId)}
            onViewExpensesClick={() => setViewExpensesModalBudgetId(row.budgetId)}
          />
        ))}
        <UncategorizedBudgetCard
          row={uncategorizedRow}
          onAddExpenseClick={() => openAddExpenseModal(UNCATEGORIZED_BUDGET_ID)}
          onViewExpensesClick={() => setViewExpensesModalBudgetId(UNCATEGORIZED_BUDGET_ID)}
        />
        {/* Ids with money against them but no category record. They count in
            every total, so they have to be visible somewhere too. */}
        {orphanRows.map((row) => (
          <BudgetCard
            key={row.budgetId}
            name={row.name}
            carriedInCents={row.carriedInCents}
            assignedCents={row.assignedCents}
            spentCents={row.spentCents}
            gray
            onAddExpenseClick={() => openAddExpenseModal(row.budgetId)}
            onViewExpensesClick={() => setViewExpensesModalBudgetId(row.budgetId)}
          />
        ))}
        <TotalBudgetCard
          carriedInCents={totalCarriedInCents}
          assignedCents={periodAssignedCents}
          spentCents={periodSpentCents}
        />
      </div>
      <AssignIncomeModal
        show={showAssignModal}
        period={period}
        handleClose={() => setShowAssignModal(false)}
      />
      <AddExpenseModal
        show={showAddExpenseModal}
        defaultBudgetId={addExpenseModalBudgetId}
        handleClose={() => setShowAddExpenseModal(false)}
      />
      <AddIncomeModal show={showAddIncomeModal} handleClose={() => setShowAddIncomeModal(false)} />
      <ViewExpensesModal
        budgetId={viewExpensesModalBudgetId}
        handleClose={() => setViewExpensesModalBudgetId()}
      />
      <ViewIncomeModal show={showIncomeModal} handleClose={() => setShowIncomeModal(false)} />
    </>
  );
}
