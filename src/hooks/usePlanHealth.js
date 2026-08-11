import { useMemo } from "react";
import { useBudgetPlan } from "../contexts/BudgetPlanContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import useEnvelopes from "./useEnvelopes";

/**
 * Whether the plan for one period balances.
 *
 *   unplanned(P) = expected income(P) − Σ over categories of estimate(b, P)
 *
 * The second cross-store derivation, alongside useEnvelopes, and kept out of the
 * providers for the same reason: the moment a store reads another one back, the
 * graph has a cycle. See src/contexts/AppProviders.js.
 *
 * Everything here is the *plan* — what the user intends to earn and intends to
 * spend — with one figure from the books alongside it: what has actually been
 * recorded this month, so the plan can be checked against reality without
 * leaving the page. That figure comes from useEnvelopes rather than
 * `totalIncomeCents`, which is all-time; mixing the two would put a period
 * figure next to a lifetime one with nothing on screen to say so.
 *
 * Note what is deliberately absent: nothing here reads assignments. Assigning
 * money is an act on the books, and a plan that balances on paper says nothing
 * about whether this month's actual income has been given a job. That question
 * belongs to "to be assigned" on the Transactions page.
 */
export default function usePlanHealth(period) {
  const { budgets } = useBudgets();
  const { getPlannedCents } = useBudgetPlan();
  const { getPeriodSources } = useIncomePlan();
  const { periodIncomeCents } = useEnvelopes(period);

  return useMemo(() => {
    const incomeRows = getPeriodSources(period);

    const expectedIncomeCents = incomeRows.reduce((sum, row) => sum + row.expectedCents, 0);
    const paymentCount = incomeRows.reduce((count, row) => count + row.dates.length, 0);

    const categoryRows = budgets.map((budget) => ({
      ...budget,
      plannedCents: getPlannedCents(budget.id, period),
    }));
    const plannedCents = categoryRows.reduce((sum, row) => sum + row.plannedCents, 0);

    return {
      period,
      incomeRows,
      categoryRows,
      expectedIncomeCents,
      plannedCents,
      unplannedCents: expectedIncomeCents - plannedCents,
      recordedIncomeCents: periodIncomeCents,
      outstandingIncomeCents: expectedIncomeCents - periodIncomeCents,
      paymentCount,
      sourceCount: incomeRows.length,
      // A category with no estimate is not planned for at all, which is a
      // different state from one planned at zero and worth counting separately.
      categoryCount: categoryRows.length,
      estimatedCount: categoryRows.filter((row) => row.plannedCents > 0).length,
    };
  }, [budgets, getPlannedCents, getPeriodSources, periodIncomeCents, period]);
}
