import { useMemo } from "react";
import { useAssignments } from "../contexts/AssignmentsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useIncome } from "../contexts/IncomeContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { periodLTE, toPeriod } from "../utils";

/**
 * Every figure the envelope view needs, for one period.
 *
 * This is the only place that reads across stores. Each context references the
 * others by id and never reads them back, which is what keeps the provider
 * graph acyclic; the moment derived maths moves into a provider, that stops
 * being true. See src/contexts/AppProviders.js.
 *
 *   available(b, P) = Σ over p ≤ P of [ assigned(b,p) − spent(b,p) ]
 *   carriedIn(b, P) = the same sum over p < P
 *   toBeAssigned(P) = Σ over p ≤ P of [ income(p) − Σ over b of assigned(b,p) ]
 *
 * so that, at every period:
 *
 *   toBeAssigned + Σ available === cumulative income − cumulative spend
 *
 * which is cash on hand. That identity is the tripwire the tests assert after
 * every mutation. It holds only if the row set below covers *every* budgetId
 * that appears anywhere — including ids with no matching budget record — and
 * if both sides use the same period filter. Filtering what the grid displays
 * is fine; filtering what these sums cover is not.
 *
 * Undated records (date: null, from the migration that introduced dates) count
 * in every period's cumulative sums, so money never disappears from the books
 * just because its date was never recorded. On a row they fold into carriedIn
 * and never into spentCents, so the three displayed figures always add up to
 * the displayed balance. Future-dated records are excluded until their month
 * arrives.
 */
export default function useEnvelopes(period) {
  const { budgets, expenses } = useBudgets();
  const { assignments } = useAssignments();
  const { income } = useIncome();

  return useMemo(() => {
    // budgetId -> { before, current } in cents, for each of spend and assigned.
    const tally = new Map();
    const bucket = (budgetId) => {
      let entry = tally.get(budgetId);
      if (!entry) {
        entry = { spentBefore: 0, spentNow: 0, assignedBefore: 0, assignedNow: 0 };
        tally.set(budgetId, entry);
      }
      return entry;
    };

    for (const expense of expenses) {
      const expensePeriod = toPeriod(expense.date);
      const entry = bucket(expense.budgetId ?? UNCATEGORIZED_BUDGET_ID);
      if (expensePeriod === period) entry.spentNow += expense.amountCents;
      // Undated spend already happened, so it belongs behind us rather than in
      // this month's column.
      else if (expensePeriod == null || periodLTE(expensePeriod, period)) {
        entry.spentBefore += expense.amountCents;
      }
    }

    for (const assignment of assignments) {
      const entry = bucket(assignment.budgetId);
      if (assignment.period === period) entry.assignedNow += assignment.assignedCents;
      else if (periodLTE(assignment.period, period)) {
        entry.assignedBefore += assignment.assignedCents;
      }
    }

    const budgetsById = new Map(budgets.map((budget) => [budget.id, budget]));
    // The union, not `budgets`: an id with spend but no budget record still
    // holds real money, and dropping it from the sum breaks the identity above.
    const ids = new Set([
      ...budgets.map((budget) => budget.id),
      UNCATEGORIZED_BUDGET_ID,
      ...tally.keys(),
    ]);

    const rows = [...ids].map((budgetId) => {
      const entry = tally.get(budgetId) ?? {
        spentBefore: 0,
        spentNow: 0,
        assignedBefore: 0,
        assignedNow: 0,
      };
      const carriedInCents = entry.assignedBefore - entry.spentBefore;
      const budget = budgetsById.get(budgetId);
      const kind = budget
        ? "category"
        : budgetId === UNCATEGORIZED_BUDGET_ID
        ? "uncategorized"
        : "orphan";

      return {
        budgetId,
        kind,
        name: budget?.name ?? (kind === "uncategorized" ? "Uncategorized" : "Unknown category"),
        carriedInCents,
        assignedCents: entry.assignedNow,
        spentCents: entry.spentNow,
        availableCents: carriedInCents + entry.assignedNow - entry.spentNow,
        // The standing estimate from Configuration, which is the same figure in
        // every period — it says what this category is expected to need in a
        // month, not what one particular month was planned at.
        plannedCents: budget?.plannedCents ?? 0,
      };
    });

    // Configured categories first, in the order the user arranged them on the
    // Configuration page, then the catch-alls. Sort order is presentation only
    // — the sums cover every row.
    const order = { category: 0, uncategorized: 1, orphan: 2 };
    const positionById = new Map(budgets.map((budget, index) => [budget.id, index]));
    rows.sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        (positionById.get(a.budgetId) ?? 0) - (positionById.get(b.budgetId) ?? 0)
    );

    let periodIncomeCents = 0;
    let cumIncomeCents = 0;
    for (const entry of income) {
      const incomePeriod = toPeriod(entry.date);
      if (incomePeriod === period) periodIncomeCents += entry.amountCents;
      if (incomePeriod == null || periodLTE(incomePeriod, period)) {
        cumIncomeCents += entry.amountCents;
      }
    }

    const totals = rows.reduce(
      (sum, row) => ({
        carriedIn: sum.carriedIn + row.carriedInCents,
        periodAssigned: sum.periodAssigned + row.assignedCents,
        available: sum.available + row.availableCents,
        spent: sum.spent + row.spentCents,
      }),
      { carriedIn: 0, periodAssigned: 0, available: 0, spent: 0 }
    );

    const assignedThroughCents = [...tally.values()].reduce(
      (sum, entry) => sum + entry.assignedBefore + entry.assignedNow,
      0
    );
    const cumSpentCents = [...tally.values()].reduce(
      (sum, entry) => sum + entry.spentBefore + entry.spentNow,
      0
    );

    return {
      period,
      rows,
      toBeAssignedCents: cumIncomeCents - assignedThroughCents,
      totalAvailableCents: totals.available,
      totalCarriedInCents: totals.carriedIn,
      periodIncomeCents,
      periodAssignedCents: totals.periodAssigned,
      periodSpentCents: totals.spent,
      cumIncomeCents,
      cumSpentCents,
    };
  }, [budgets, expenses, assignments, income, period]);
}
