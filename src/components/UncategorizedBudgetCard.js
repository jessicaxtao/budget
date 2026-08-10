import { UNCATEGORIZED_BUDGET_ID, useBudgets } from "../contexts/BudgetsContext";
import BudgetCard from "./BudgetCard";

export default function UncategorizedBudgetCard(props) {
  const { getBudgetTotalCents } = useBudgets();
  const amountCents = getBudgetTotalCents(UNCATEGORIZED_BUDGET_ID);

  if (amountCents === 0) return null;

  return <BudgetCard name="Uncategorized" amountCents={amountCents} gray {...props} />;
}
