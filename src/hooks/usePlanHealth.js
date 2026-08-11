import { useMemo } from "react";
import { useBudgets } from "../contexts/BudgetsContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { toSections } from "../planLayout";

/**
 * Whether the standing configuration balances.
 *
 *   unplanned = expected income per month − Σ category estimates per month
 *
 * Both sides are monthly figures that hold until the user changes them. Nothing
 * here is scoped to a month, and nothing here reads the books: this says what
 * the user intends, and says it the same way in January as in August.
 *
 * Note what is deliberately absent. Not assignments — assigning money is an act
 * on the books, and a configuration that balances on paper says nothing about
 * whether this month's actual income has been given a job; that question belongs
 * to "to be assigned" on the Transactions page. Not recorded income either, for
 * the same reason: a figure from one particular month has no business sitting
 * next to figures that describe every month.
 */
export default function usePlanHealth() {
  const { groups, budgets } = useBudgets();
  const { incomeRows, expectedMonthlyCents } = useIncomePlan();

  return useMemo(() => {
    const sections = toSections(groups, budgets);
    const plannedCents = budgets.reduce((sum, budget) => sum + budget.plannedCents, 0);

    return {
      sections,
      incomeRows,
      expectedIncomeCents: expectedMonthlyCents,
      plannedCents,
      unplannedCents: expectedMonthlyCents - plannedCents,
      sourceCount: incomeRows.length,
      groupCount: groups.length,
      // A category with no estimate is not planned for at all, which is a
      // different state from one planned at zero and worth counting separately.
      categoryCount: budgets.length,
      estimatedCount: budgets.filter((budget) => budget.plannedCents > 0).length,
    };
  }, [groups, budgets, incomeRows, expectedMonthlyCents]);
}
