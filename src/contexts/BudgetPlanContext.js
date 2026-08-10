import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { currentPeriod, toCents } from "../utils";

/**
 * Budget configuration over time, and the single source of truth for what a
 * category is allowed to spend.
 *
 * A plan is the limit for one budget in one period ("YYYY-MM"), so changing next
 * month's grocery limit does not rewrite what was planned last month. A period
 * with no plan of its own carries the most recent earlier one forward, which is
 * what makes a single stored limit sufficient — there is no second "default"
 * field on the budget to fall out of step with this one.
 */
const BudgetPlanContext = React.createContext();

export function useBudgetPlan() {
  return useContext(BudgetPlanContext);
}

/**
 * Budgets used to carry their own `max` in floating-point dollars. That was the
 * second source of truth for this number; fold it in here as the plan for the
 * current period, then BudgetsContext drops the field.
 *
 * Guarded end to end: this reads a key another store owns, and a failure here
 * must not cost the user their plan history.
 */
function seedFromLegacyBudgetMaxes(existingPlans) {
  try {
    const raw = localStorage.getItem("budgets");
    if (raw == null) return [];

    const budgets = JSON.parse(raw);
    if (!Array.isArray(budgets)) return [];

    const period = currentPeriod();
    return budgets
      .filter((budget) => budget && "max" in budget && budget.id)
      .filter((budget) => !existingPlans.some((plan) => plan.budgetId === budget.id))
      .map((budget) => ({
        id: uuidV4(),
        budgetId: budget.id,
        period,
        plannedCents: toCents(budget.max) ?? 0,
      }));
  } catch {
    return [];
  }
}

function migratePlans(stored) {
  const plans = Array.isArray(stored) ? stored : [];

  // Keyed on field presence rather than a version counter, so it is
  // self-describing and safe to run repeatedly.
  const upgraded = plans.map((plan) =>
    "planned" in plan
      ? {
          id: plan.id ?? uuidV4(),
          budgetId: plan.budgetId,
          period: plan.period,
          plannedCents: toCents(plan.planned) ?? 0,
        }
      : plan
  );

  return [...upgraded, ...seedFromLegacyBudgetMaxes(upgraded)];
}

export const BudgetPlanProvider = ({ children }) => {
  // The seed has to run through the default too, not just the migration: the
  // common case is a ledger that has budgets with a legacy `max` but has never
  // stored a plan, and a migration only ever sees keys that already exist.
  const [plans, setPlans] = useLocalStorage(
    "budgetPlans",
    () => seedFromLegacyBudgetMaxes([]),
    migratePlans
  );

  const getPeriodPlans = useCallback(
    (period) => plans.filter((plan) => plan.period === period),
    [plans]
  );

  const getPlan = useCallback(
    (budgetId, period) =>
      plans.find((plan) => plan.budgetId === budgetId && plan.period === period),
    [plans]
  );

  /**
   * The limit in force for a budget in a period: its own plan, or the most
   * recent earlier one carried forward. Returns 0 for a budget that has never
   * been planned, which callers read as "no limit set".
   */
  const getPlannedCents = useCallback(
    (budgetId, period) => {
      const applicable = plans
        .filter((plan) => plan.budgetId === budgetId && plan.period <= period)
        .sort((a, b) => a.period.localeCompare(b.period));
      return applicable.length ? applicable[applicable.length - 1].plannedCents : 0;
    },
    [plans]
  );

  // Upsert: one plan per (budgetId, period).
  const setPlannedAmount = useCallback(({ budgetId, period, planned, plannedCents }) => {
    const cents = plannedCents ?? toCents(planned);
    if (cents == null || cents < 0) {
      return { ok: false, error: "Enter a planned amount of zero or more." };
    }

    setPlans((prevPlans) => {
      const existing = prevPlans.find(
        (plan) => plan.budgetId === budgetId && plan.period === period
      );
      if (existing) {
        return prevPlans.map((plan) =>
          plan.id === existing.id ? { ...plan, plannedCents: cents } : plan
        );
      }
      return [...prevPlans, { id: uuidV4(), budgetId, period, plannedCents: cents }];
    });

    return { ok: true };
  }, [setPlans]);

  const deletePlan = useCallback(
    ({ id }) => setPlans((prevPlans) => prevPlans.filter((plan) => plan.id !== id)),
    [setPlans]
  );

  const deleteBudgetPlans = useCallback(
    (budgetId) => setPlans((prevPlans) => prevPlans.filter((plan) => plan.budgetId !== budgetId)),
    [setPlans]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      plans,
      getPeriodPlans,
      getPlan,
      getPlannedCents,
      setPlannedAmount,
      deletePlan,
      deleteBudgetPlans,
    }),
    [plans, getPeriodPlans, getPlan, getPlannedCents, setPlannedAmount, deletePlan, deleteBudgetPlans]
  );

  return <BudgetPlanContext.Provider value={value}>{children}</BudgetPlanContext.Provider>;
};
