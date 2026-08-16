import { useMemo } from "react";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import useEnvelopes from "./useEnvelopes";

const ZERO_ROW = { carriedInCents: 0, assignedCents: 0, availableCents: 0 };

/**
 * Every goal, joined to what has actually been put toward it — the same join
 * useDashboard performs for categories, and for the same reason: useEnvelopes
 * knows the money, SavingsGoalsContext knows the goal, and neither should
 * read the other directly.
 *
 * `availableCents` is the goal's cumulative assignment (see useEnvelopes'
 * goalRows), `remainingCents` is what is left to reach the target, floored at
 * zero so a goal met — or overshot, from a later withdrawal that has not
 * happened yet — never reads as owing money back.
 */
export default function useSavingsGoalEnvelopes(period) {
  const { goals } = useSavingsGoals();
  const { goalRows } = useEnvelopes(period);

  return useMemo(() => {
    const byId = new Map(goalRows.map((row) => [row.goalId, row]));

    return goals.map((goal) => {
      const row = byId.get(goal.id) ?? ZERO_ROW;
      return {
        goalId: goal.id,
        name: goal.name,
        targetCents: goal.targetCents,
        targetDate: goal.targetDate,
        carriedInCents: row.carriedInCents,
        assignedCents: row.assignedCents,
        availableCents: row.availableCents,
        remainingCents: Math.max(goal.targetCents - row.availableCents, 0),
      };
    });
  }, [goals, goalRows]);
}
