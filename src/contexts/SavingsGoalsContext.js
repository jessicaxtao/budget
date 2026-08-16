import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { toCents } from "../utils";

/**
 * Medium-term savings: a camera, a wedding, a special event — a goal that is
 * expected to *exceed* the normal monthly budget, so it has to be planned
 * around rather than absorbed into an envelope's estimate.
 *
 * Independent of every other store, in both directions: nothing here moves
 * money, and nothing else references a goal's id. A goal is a standing
 * intention — { id, name, targetCents, targetDate } — with no link yet to a
 * category, an account, or any contribution toward it.
 */
const SavingsGoalsContext = React.createContext();

export function useSavingsGoals() {
  return useContext(SavingsGoalsContext);
}

const isAmount = (value) => Number.isInteger(value) && value > 0;
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migrateGoals(stored) {
  const goals = Array.isArray(stored) ? stored : [];
  return goals
    .filter((goal) => goal && typeof goal.name === "string" && isAmount(goal.targetCents))
    .map((goal) => ({
      id: goal.id ?? uuidV4(),
      name: goal.name,
      targetCents: goal.targetCents,
      // Optional: a goal without a date in mind is still a goal.
      targetDate: isDate(goal.targetDate) ? goal.targetDate : null,
    }));
}

export const SavingsGoalsProvider = ({ children }) => {
  const [goals, setGoals] = useLocalStorage("savingsGoals", [], migrateGoals);

  /**
   * Add a savings goal. Returns a result rather than throwing: the caller has
   * to decide what to tell the user.
   */
  const addSavingsGoal = useCallback(
    ({ name, target, targetCents, targetDate }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the goal a name." };

      const cents = targetCents !== undefined ? targetCents : toCents(target);
      if (!isAmount(cents)) {
        return { ok: false, error: "Enter a target amount greater than zero." };
      }

      const date = targetDate || null;
      if (date !== null && !isDate(date)) {
        return { ok: false, error: "Enter a valid target date, or leave it blank." };
      }

      const id = uuidV4();
      setGoals((previous) => [...previous, { id, name: trimmed, targetCents: cents, targetDate: date }]);
      return { ok: true, id };
    },
    [setGoals]
  );

  // Memoised so a change in any other store does not re-render every
  // consumer of this one.
  const value = useMemo(
    () => ({ goals, addSavingsGoal }),
    [goals, addSavingsGoal]
  );

  return <SavingsGoalsContext.Provider value={value}>{children}</SavingsGoalsContext.Provider>;
};
