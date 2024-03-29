import Container from 'react-bootstrap/Container';
import 'bootstrap/dist/css/bootstrap.min.css';
import {Button, Stack} from 'react-bootstrap';
import BudgetCard from './components/BudgetCard';
import IncomeBudgetCard from './components/IncomeBudgetCard'
import AddBudgetModal from './components/AddBudgetModal';
import AddExpenseModal from './components/AddExpenseModal';
import AddIncomeModal from './components/AddIncomeModal';
import {useState} from "react";
import { UNCATEGORIZED_BUDGET_ID, useBudgets } from './contexts/BudgetsContext';
import { useIncome } from './contexts/IncomeContext';
import UncategorizedBudgetCard from './components/UncategorizedBudgetCard';
import TotalBudgetCard from './components/TotalBudgetCard';
import ViewExpensesModal from './components/ViewExpensesModal';
import ViewIncomeModal from './components/ViewIncomeModal';

function App() {
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [ViewExpensesModalBudgetId, setViewExpensesModalBudgetId] = useState();
  const [showIncomeModal, setShowIncomeModal] = useState();
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false);
  const [addExpenseModalBudgetId, setAddExpenseModalBudgetId] = useState();
  const {budgets, getBudgetExpenses} = useBudgets();
  const {income} = useIncome();

  function openAddExpenseModal(budgetId) {
    setShowAddExpenseModal(true)
    setAddExpenseModalBudgetId(budgetId)
  }

  function openAddIncomeModal() {
    setShowAddIncomeModal(true)
  }

  function openViewIncomeModal() {
    setShowIncomeModal(true)
  }

  let totalIncome = 0
  income.map(i => {
    totalIncome = totalIncome + i.amount
  })

  return <>
  <Container className="my-4">
    <Stack direction="horizontal" gap="2" className="mb-4">
      <h1 className="me-auto">Budgets</h1>
      <Button variant="primary" onClick={() => setShowAddBudgetModal(true)}>Add Budget</Button>
      <Button variant="outline-primary" onClick={openAddExpenseModal}>Add Expense</Button>
      <Button variant="outline-primary" onClick={openAddIncomeModal}>Add Income</Button>
    </Stack>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem", alignItems:"flex-start"}}>
      <IncomeBudgetCard name={"Income"} amount={totalIncome} onAddIncomeClick={() => openAddIncomeModal()} onViewIncomeClick={() => openViewIncomeModal()}></IncomeBudgetCard>
      {budgets.map(budget => {
        const amount = getBudgetExpenses(budget.id).reduce((total, expense) => total + expense.amount, 0)
            return (<BudgetCard key={budget.id} name={budget.name} amount={amount} max={budget.max} onAddExpenseClick={() => openAddExpenseModal(budget.id)} 
            onViewExpensesClick={() => setViewExpensesModalBudgetId(budget.id)}/>)
})}
    <UncategorizedBudgetCard onAddExpenseClick={openAddExpenseModal} onViewExpensesClick={() => setViewExpensesModalBudgetId(UNCATEGORIZED_BUDGET_ID)}/>
    <TotalBudgetCard />
    </div>
  </Container>
  <AddBudgetModal show={showAddBudgetModal} handleClose={() => setShowAddBudgetModal(false)} />
  <AddExpenseModal show={showAddExpenseModal} defaultBudgetId = {addExpenseModalBudgetId} handleClose={() => setShowAddExpenseModal(false)} />
  <AddIncomeModal show={showAddIncomeModal} handleClose={() => setShowAddIncomeModal(false)} />
  <ViewExpensesModal budgetId={ViewExpensesModalBudgetId} handleClose={() => setViewExpensesModalBudgetId()} />
  <ViewIncomeModal show={showIncomeModal} handleClose={() => setShowIncomeModal(false)} />
  </>
}

export default App;
