import { useBudgets } from "../contexts/BudgetsContext";
import { useBudgetPlan } from "../contexts/BudgetPlanContext";
import { currentPeriod } from "../utils";
import BudgetCard from "./BudgetCard";

export default function TotalBudgetCard() {
  const { budgets, totalSpentCents } = useBudgets();
  const { getPlannedCents } = useBudgetPlan();

  const period = currentPeriod();
  const maxCents = budgets.reduce((total, budget) => total + getPlannedCents(budget.id, period), 0);

  if (maxCents === 0) return null;

  return <BudgetCard name="Total" amountCents={totalSpentCents} gray maxCents={maxCents} hideButtons />;
}
