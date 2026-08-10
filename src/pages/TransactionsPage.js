import { useState } from "react";
import BudgetCard from "../components/BudgetCard";
import IncomeBudgetCard from "../components/IncomeBudgetCard";
import AddBudgetModal from "../components/AddBudgetModal";
import AddExpenseModal from "../components/AddExpenseModal";
import AddIncomeModal from "../components/AddIncomeModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import UncategorizedBudgetCard from "../components/UncategorizedBudgetCard";
import TotalBudgetCard from "../components/TotalBudgetCard";
import ViewExpensesModal from "../components/ViewExpensesModal";
import ViewIncomeModal from "../components/ViewIncomeModal";
import { UNCATEGORIZED_BUDGET_ID, useBudgets } from "../contexts/BudgetsContext";
import { useBudgetPlan } from "../contexts/BudgetPlanContext";
import { useIncome } from "../contexts/IncomeContext";
import { currentPeriod } from "../utils";

export default function TransactionsPage() {
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [viewExpensesModalBudgetId, setViewExpensesModalBudgetId] = useState();
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false);
  const [addExpenseModalBudgetId, setAddExpenseModalBudgetId] = useState();
  const { budgets, getBudgetTotalCents } = useBudgets();
  const { getPlannedCents } = useBudgetPlan();
  const { totalIncomeCents } = useIncome();

  const period = currentPeriod();

  function openAddExpenseModal(budgetId) {
    setShowAddExpenseModal(true);
    setAddExpenseModalBudgetId(budgetId);
  }

  function openAddIncomeModal() {
    setShowAddIncomeModal(true);
  }

  function openViewIncomeModal() {
    setShowIncomeModal(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Day to day"
        title="Transactions"
        description="Record income and expenses as they land, and see how each category is tracking this period."
        actions={
          <>
            <Button variant="primary" onClick={() => setShowAddBudgetModal(true)}>
              Add budget
            </Button>
            <Button variant="outline" onClick={() => openAddExpenseModal()}>
              Add expense
            </Button>
            <Button variant="outline" onClick={openAddIncomeModal}>
              Add income
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4">
        <IncomeBudgetCard
          name="Income"
          amountCents={totalIncomeCents}
          onAddIncomeClick={openAddIncomeModal}
          onViewIncomeClick={openViewIncomeModal}
        />
        {budgets.length === 0 && (
          <div className="border border-dashed border-edge bg-panel/60 p-4 font-sans text-row text-chalk-soft">
            Every category starts empty. Add a budget to start assigning your income.
          </div>
        )}
        {budgets.map((budget) => (
          <BudgetCard
            key={budget.id}
            name={budget.name}
            amountCents={getBudgetTotalCents(budget.id)}
            maxCents={getPlannedCents(budget.id, period)}
            onAddExpenseClick={() => openAddExpenseModal(budget.id)}
            onViewExpensesClick={() => setViewExpensesModalBudgetId(budget.id)}
          />
        ))}
        <UncategorizedBudgetCard
          onAddExpenseClick={openAddExpenseModal}
          onViewExpensesClick={() => setViewExpensesModalBudgetId(UNCATEGORIZED_BUDGET_ID)}
        />
        <TotalBudgetCard />
      </div>
      <AddBudgetModal show={showAddBudgetModal} handleClose={() => setShowAddBudgetModal(false)} />
      <AddExpenseModal
        show={showAddExpenseModal}
        defaultBudgetId={addExpenseModalBudgetId}
        handleClose={() => setShowAddExpenseModal(false)}
      />
      <AddIncomeModal show={showAddIncomeModal} handleClose={() => setShowAddIncomeModal(false)} />
      <ViewExpensesModal budgetId={viewExpensesModalBudgetId} handleClose={() => setViewExpensesModalBudgetId()} />
      <ViewIncomeModal show={showIncomeModal} handleClose={() => setShowIncomeModal(false)} />
    </>
  );
}
