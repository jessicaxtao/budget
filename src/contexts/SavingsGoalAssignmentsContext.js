import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { toCents, toPeriod } from "../utils";

/**
 * What the user actually put into each savings goal, month by month — the
 * other half of SavingsGoalsContext, on the same split BudgetsContext and
 * AssignmentsContext keep: a goal's target is the *estimate*, this is the
 * money actually handed over.
 *
 * A goal draws from the same "to be assigned" pool a category does — a
 * dollar diverted to the wedding fund is a dollar that cannot also fund
 * groceries, because it is the same paycheck. useEnvelopes is where that
 * shared pool lives, so it reads this store too and folds a goal's
 * cumulative assignment into the same toBeAssignedCents it computes for
 * budgets; see the comment there.
 *
 * One record per (goalId, period), the same shape AssignmentsContext keeps
 * for budgets. Zero-valued rows are pruned rather than stored — "assigned
 * nothing" and "never assigned" spend the same. No seed-from-existing-spend:
 * a goal has no ledger of its own to have already spent from, so a ledger
 * that predates this feature has nothing to seed here.
 */
const SavingsGoalAssignmentsContext = React.createContext();

export function useSavingsGoalAssignments() {
  return useContext(SavingsGoalAssignmentsContext);
}

const keyOf = (goalId, period) => `${goalId} ${period}`;

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migrateAssignments(stored) {
  const assignments = Array.isArray(stored) ? stored : [];
  return assignments
    .filter((assignment) => assignment && assignment.goalId != null)
    .map((assignment) => ({
      id: assignment.id ?? uuidV4(),
      goalId: assignment.goalId,
      period: assignment.period,
      assignedCents: assignment.assignedCents ?? 0,
    }));
}

/** Upsert one (goalId, period) row, pruning it when it lands on zero. */
function upsert(assignments, goalId, period, cents) {
  const rest = assignments.filter(
    (assignment) => !(assignment.goalId === goalId && assignment.period === period)
  );
  if (cents === 0) return rest;

  const existing = assignments.find(
    (assignment) => assignment.goalId === goalId && assignment.period === period
  );
  return [...rest, { id: existing?.id ?? uuidV4(), goalId, period, assignedCents: cents }];
}

export const SavingsGoalAssignmentsProvider = ({ children }) => {
  const [assignments, setAssignments] = useLocalStorage(
    "savingsGoalAssignments",
    [],
    migrateAssignments
  );

  const assignedByKey = useMemo(() => {
    const index = new Map();
    for (const assignment of assignments) {
      index.set(keyOf(assignment.goalId, assignment.period), assignment.assignedCents);
    }
    return index;
  }, [assignments]);

  const getAssignedCents = useCallback(
    (goalId, period) => assignedByKey.get(keyOf(goalId, period)) ?? 0,
    [assignedByKey]
  );

  /**
   * Negative amounts are allowed, on the same rule as a category's
   * assignment: pulling money back out of a goal that was over-funded in an
   * earlier month is the only way to move it, and refusing that would leave
   * the user with money they can see and cannot reach.
   */
  const setAssignedAmount = useCallback(
    ({ goalId, period, amount, amountCents }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null) return { ok: false, error: "Enter an amount." };
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      setAssignments((prevAssignments) => upsert(prevAssignments, goalId, period, cents));
      return { ok: true };
    },
    [setAssignments]
  );

  /**
   * The whole batch is validated before anything is written — the same
   * all-or-nothing rule setPeriodAssignments keeps for budgets, so that
   * AssignIncomeModal can commit categories and goals off one submit without
   * a bad figure in the ninth goal landing after the first eight already
   * wrote.
   */
  const setPeriodAssignments = useCallback(
    ({ period, entries }) => {
      if (toPeriod(period) == null) return { ok: false, error: "Enter a valid period." };

      const validated = [];
      for (const entry of entries) {
        const cents = entry.amountCents ?? toCents(entry.amount);
        if (cents == null) {
          return { ok: false, error: `Enter a valid amount for ${entry.label ?? "every goal"}.` };
        }
        validated.push({ goalId: entry.goalId, cents });
      }

      setAssignments((prevAssignments) =>
        validated.reduce(
          (next, { goalId, cents }) => upsert(next, goalId, period, cents),
          prevAssignments
        )
      );
      return { ok: true };
    },
    [setAssignments]
  );

  // Memoised so a change in any other store does not re-render every
  // consumer of this one.
  const value = useMemo(
    () => ({ assignments, getAssignedCents, setAssignedAmount, setPeriodAssignments }),
    [assignments, getAssignedCents, setAssignedAmount, setPeriodAssignments]
  );

  return (
    <SavingsGoalAssignmentsContext.Provider value={value}>
      {children}
    </SavingsGoalAssignmentsContext.Provider>
  );
};
