import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { useBudgetPlan } from "./BudgetPlanContext";
import { useAssignments } from "./AssignmentsContext";
import { UNCATEGORIZED_BUDGET_ID } from "./constants";
import { currentPeriod, isValidISODate, toCents, todayISO } from "../utils";

const BudgetsContext = React.createContext();

// Re-exported from its own module so AssignmentsContext can share it without
// importing this one back. See ./constants.js.
export { UNCATEGORIZED_BUDGET_ID };

export function useBudgets() {
  return useContext(BudgetsContext);
}

// `max` moved to BudgetPlanContext, which seeds a plan from it before this runs.
// Keyed on field presence, so it is safe to run repeatedly.
function migrateBudgets(stored) {
  const budgets = Array.isArray(stored) ? stored : [];
  return budgets.map(({ max, ...budget }) => ({ id: budget.id ?? uuidV4(), name: budget.name }));
}

function migrateExpenses(stored) {
  const expenses = Array.isArray(stored) ? stored : [];
  return expenses.map((expense) =>
    "amount" in expense
      ? {
          id: expense.id ?? uuidV4(),
          description: expense.description,
          amountCents: toCents(expense.amount) ?? 0,
          budgetId: expense.budgetId,
          // Genuinely unknown for records logged before dates existed. Left null
          // rather than backfilled with today's date, which would invent history.
          date: expense.date ?? null,
        }
      : expense
  );
}

export const BudgetsProvider = ({ children }) => {
  const [budgets, setBudgets] = useLocalStorage("budgets", [], migrateBudgets);
  const [expenses, setExpenses] = useLocalStorage("expenses", [], migrateExpenses);
  const { deleteBudgetPlans } = useBudgetPlan();
  const { reassignBudgetAssignments } = useAssignments();

  // One pass instead of a full scan per budget per render.
  const expensesByBudget = useMemo(() => {
    const grouped = new Map();
    for (const expense of expenses) {
      const bucket = grouped.get(expense.budgetId);
      if (bucket) bucket.push(expense);
      else grouped.set(expense.budgetId, [expense]);
    }
    return grouped;
  }, [expenses]);

  const totalsByBudget = useMemo(() => {
    const totals = new Map();
    for (const [budgetId, bucket] of expensesByBudget) {
      totals.set(
        budgetId,
        bucket.reduce((sum, expense) => sum + expense.amountCents, 0)
      );
    }
    return totals;
  }, [expensesByBudget]);

  const totalSpentCents = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
    [expenses]
  );

  const getBudgetExpenses = useCallback(
    (budgetId) => expensesByBudget.get(budgetId) ?? [],
    [expensesByBudget]
  );

  const getBudgetTotalCents = useCallback(
    (budgetId) => totalsByBudget.get(budgetId) ?? 0,
    [totalsByBudget]
  );

  // Amounts are validated here rather than in the forms: this is the boundary
  // every caller crosses, and NaN would otherwise reach storage, where
  // JSON.stringify silently records it as null.
  const addExpense = useCallback(
    ({ description, amount, amountCents, budgetId, date = todayISO() }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      if (!isValidISODate(date)) {
        return { ok: false, error: "Enter a valid date." };
      }

      setExpenses((prevExpenses) => [
        ...prevExpenses,
        { id: uuidV4(), description: description.trim(), amountCents: cents, budgetId, date },
      ]);
      return { ok: true };
    },
    [setExpenses]
  );

  // Returns a result rather than silently discarding the input: the caller has
  // to decide what to tell the user, and closing the modal as though a duplicate
  // had been saved is the one option that cannot be right.
  const addBudget = useCallback(
    ({ name }) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "Give the budget a name." };

      const clash = budgets.some(
        (budget) => budget.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        return { ok: false, error: `A budget named “${trimmed}” already exists.` };
      }

      const id = uuidV4();
      setBudgets((prevBudgets) => [...prevBudgets, { id, name: trimmed }]);
      return { ok: true, id };
    },
    [budgets, setBudgets]
  );

  // Expenses outlive their category — they are what actually happened — so they
  // are reassigned rather than deleted. The category's plan history goes with
  // it, since there is nothing left for it to describe; but its *funding*
  // follows the expenses onto Uncategorized, because that money was already
  // set aside and dropping it would ask the user to fund the same spend twice.
  //
  // One consequence worth knowing: because every envelope figure is derived
  // from current state, deleting a category also changes what past periods
  // read. There is no history to preserve it in.
  const deleteBudget = useCallback(
    ({ id }) => {
      setExpenses((prevExpenses) =>
        prevExpenses.map((expense) =>
          expense.budgetId === id ? { ...expense, budgetId: UNCATEGORIZED_BUDGET_ID } : expense
        )
      );
      setBudgets((prevBudgets) => prevBudgets.filter((budget) => budget.id !== id));
      deleteBudgetPlans(id);
      reassignBudgetAssignments({
        fromBudgetId: id,
        toBudgetId: UNCATEGORIZED_BUDGET_ID,
        period: currentPeriod(),
      });
    },
    [setExpenses, setBudgets, deleteBudgetPlans, reassignBudgetAssignments]
  );

  const deleteExpense = useCallback(
    ({ id }) => setExpenses((prevExpenses) => prevExpenses.filter((expense) => expense.id !== id)),
    [setExpenses]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      budgets,
      expenses,
      totalSpentCents,
      getBudgetExpenses,
      getBudgetTotalCents,
      addExpense,
      addBudget,
      deleteBudget,
      deleteExpense,
    }),
    [
      budgets,
      expenses,
      totalSpentCents,
      getBudgetExpenses,
      getBudgetTotalCents,
      addExpense,
      addBudget,
      deleteBudget,
      deleteExpense,
    ]
  );

  return <BudgetsContext.Provider value={value}>{children}</BudgetsContext.Provider>;
};
