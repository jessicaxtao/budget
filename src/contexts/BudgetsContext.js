import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
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

export const UNGROUPED_ID = null;

/**
 * The estimate used to live in a separate store, one plan per (budget, period),
 * so that editing next month left last month's figure intact. It is now a single
 * standing figure on the budget itself: the Configuration page describes what a
 * category is expected to need *in general*, not what one particular month was
 * planned at, and a per-period record has nothing left to say. Fold the last
 * plan each budget had into that figure.
 *
 * Guarded end to end: this reads a key this store does not own, and a failure
 * here must not cost the user their estimates. Periods are compared as strings
 * only after both sides are known to be strings — see periodLTE in utils for why
 * a bare comparison against a possibly-missing period is a trap.
 */
function legacyPlannedCentsById() {
  const latest = new Map();

  try {
    const raw = localStorage.getItem("budgetPlans");
    if (raw == null) return latest;

    const plans = JSON.parse(raw);
    if (!Array.isArray(plans)) return latest;

    for (const plan of plans) {
      if (!plan || !plan.budgetId) continue;
      const cents = plan.plannedCents ?? toCents(plan.planned);
      if (cents == null) continue;

      const period = typeof plan.period === "string" ? plan.period : "";
      const seen = latest.get(plan.budgetId);
      if (!seen || period >= seen.period) {
        latest.set(plan.budgetId, { period, plannedCents: cents });
      }
    }
  } catch {
    return new Map();
  }

  return new Map([...latest].map(([id, { plannedCents }]) => [id, plannedCents]));
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to run repeatedly: once `plannedCents` is on the
// record, neither legacy source is consulted again. The old `budgetPlans` key is
// left in storage rather than deleted — this store does not own it, and a
// migration that destroys another store's data has no way to undo itself.
function migrateBudgets(stored) {
  const budgets = Array.isArray(stored) ? stored : [];
  const needsLegacy = budgets.some((budget) => budget && !("plannedCents" in budget));
  const planned = needsLegacy ? legacyPlannedCentsById() : new Map();

  return budgets
    .filter((budget) => budget && budget.name != null)
    .map(({ max, ...budget }) => ({
      id: budget.id ?? uuidV4(),
      name: budget.name,
      // `max` was floating-point dollars on the budget itself, two schemas ago.
      plannedCents: budget.plannedCents ?? planned.get(budget.id) ?? toCents(max) ?? 0,
      // Absent and "in no group" are the same thing; store one of them.
      groupId: budget.groupId ?? UNGROUPED_ID,
    }));
}

function migrateGroups(stored) {
  const groups = Array.isArray(stored) ? stored : [];
  return groups
    .filter((group) => group && group.name != null)
    .map((group) => ({ id: group.id ?? uuidV4(), name: group.name }));
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

/**
 * Categories, the groups they are filed under, and the expenses booked against
 * them.
 *
 * Groups live here rather than in a store of their own on purpose. A group is
 * nothing but a heading over a set of categories: it holds no money, no figure
 * of its own, and deleting one has to hand its categories back without touching
 * them. Splitting it out would buy a cascade between two providers to express a
 * relationship that is one nullable field.
 *
 * **Array order is display order** for both lists. There is no `position` field
 * to drift out of step with the array it describes, and reordering is one
 * mutator — `setCategoryLayout` — that rewrites both lists at once, because a
 * drag can change a category's group and its position in the same gesture.
 */
export const BudgetsProvider = ({ children }) => {
  const [groups, setGroups] = useLocalStorage("budgetGroups", [], migrateGroups);
  const [budgets, setBudgets] = useLocalStorage("budgets", [], migrateBudgets);
  const [expenses, setExpenses] = useLocalStorage("expenses", [], migrateExpenses);
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

  const totalPlannedCents = useMemo(
    () => budgets.reduce((sum, budget) => sum + budget.plannedCents, 0),
    [budgets]
  );

  const getBudgetExpenses = useCallback(
    (budgetId) => expensesByBudget.get(budgetId) ?? [],
    [expensesByBudget]
  );

  const getBudgetTotalCents = useCallback(
    (budgetId) => totalsByBudget.get(budgetId) ?? 0,
    [totalsByBudget]
  );

  const getPlannedCents = useCallback(
    (budgetId) => budgets.find((budget) => budget.id === budgetId)?.plannedCents ?? 0,
    [budgets]
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
    ({ name, planned, plannedCents, groupId = UNGROUPED_ID }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the category a name." };

      const clash = budgets.some(
        (budget) => budget.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        return { ok: false, error: `A category named “${trimmed}” already exists.` };
      }

      // No estimate at all is a real state — a category the user has not made up
      // their mind about — and reads as zero. Junk is not.
      const cents = plannedCents ?? (planned == null || planned === "" ? 0 : toCents(planned));
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter a monthly estimate of zero or more." };
      }

      // A group that has since been deleted must not strand the category in a
      // heading nothing renders.
      const group = groups.some((entry) => entry.id === groupId) ? groupId : UNGROUPED_ID;

      const id = uuidV4();
      setBudgets((prevBudgets) => [
        ...prevBudgets,
        { id, name: trimmed, plannedCents: cents, groupId: group },
      ]);
      return { ok: true, id };
    },
    [budgets, groups, setBudgets]
  );

  /**
   * Rename a category, restate its estimate, or both. Fields left undefined are
   * left alone, so a caller editing one of them cannot blank the other by
   * omission.
   */
  const updateBudget = useCallback(
    ({ id, name, planned, plannedCents }) => {
      const existing = budgets.find((budget) => budget.id === id);
      if (!existing) return { ok: false, error: "That category no longer exists." };

      const patch = {};

      if (name !== undefined) {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: "Give the category a name." };

        const clash = budgets.some(
          (budget) =>
            budget.id !== id && budget.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (clash) {
          return { ok: false, error: `A category named “${trimmed}” already exists.` };
        }
        patch.name = trimmed;
      }

      if (planned !== undefined || plannedCents !== undefined) {
        const cents = plannedCents ?? (planned === "" ? 0 : toCents(planned));
        if (cents == null || cents < 0) {
          return { ok: false, error: "Enter a monthly estimate of zero or more." };
        }
        patch.plannedCents = cents;
      }

      setBudgets((prevBudgets) =>
        prevBudgets.map((budget) => (budget.id === id ? { ...budget, ...patch } : budget))
      );
      return { ok: true };
    },
    [budgets, setBudgets]
  );

  // Expenses outlive their category — they are what actually happened — so they
  // are reassigned rather than deleted. Its *funding* follows them onto
  // Uncategorized, because that money was already set aside and dropping it
  // would ask the user to fund the same spend twice. The estimate goes with the
  // record, since there is nothing left for it to describe.
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
      reassignBudgetAssignments({
        fromBudgetId: id,
        toBudgetId: UNCATEGORIZED_BUDGET_ID,
        period: currentPeriod(),
      });
    },
    [setExpenses, setBudgets, reassignBudgetAssignments]
  );

  const deleteExpense = useCallback(
    ({ id }) => setExpenses((prevExpenses) => prevExpenses.filter((expense) => expense.id !== id)),
    [setExpenses]
  );

  const addGroup = useCallback(
    ({ name }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the group a name." };

      const clash = groups.some(
        (group) => group.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) return { ok: false, error: `A group named “${trimmed}” already exists.` };

      const id = uuidV4();
      setGroups((prevGroups) => [...prevGroups, { id, name: trimmed }]);
      return { ok: true, id };
    },
    [groups, setGroups]
  );

  const renameGroup = useCallback(
    ({ id, name }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the group a name." };

      const clash = groups.some(
        (group) => group.id !== id && group.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) return { ok: false, error: `A group named “${trimmed}” already exists.` };

      setGroups((prevGroups) =>
        prevGroups.map((group) => (group.id === id ? { ...group, name: trimmed } : group))
      );
      return { ok: true };
    },
    [groups, setGroups]
  );

  /**
   * Removing a heading, not the categories under it. A group holds no money and
   * no estimate of its own, so there is nothing to cascade — its members come
   * back out ungrouped, with their figures and their history untouched.
   */
  const deleteGroup = useCallback(
    ({ id }) => {
      setBudgets((prevBudgets) =>
        prevBudgets.map((budget) =>
          budget.groupId === id ? { ...budget, groupId: UNGROUPED_ID } : budget
        )
      );
      setGroups((prevGroups) => prevGroups.filter((group) => group.id !== id));
    },
    [setBudgets, setGroups]
  );

  /**
   * The whole arrangement, in one commit: which group each category sits in and
   * what order everything appears in.
   *
   * `sections` is `[{ groupId, budgetIds }]` in display order, with `groupId`
   * null for the ungrouped section. One mutator rather than a reorder and a
   * regroup, because a single drag can do both and applying them in two writes
   * would put a frame of nonsense on screen between them.
   *
   * Anything the caller failed to mention survives: unknown ids are dropped,
   * groups and categories not listed keep their place at the end. A layout is a
   * rearrangement, and no rearrangement may delete a category.
   */
  const setCategoryLayout = useCallback(
    (sections) => {
      if (!Array.isArray(sections)) return { ok: false, error: "Invalid layout." };

      setGroups((prevGroups) => {
        const byId = new Map(prevGroups.map((group) => [group.id, group]));
        const ordered = [];
        for (const section of sections) {
          const group = byId.get(section?.groupId);
          if (group && !ordered.includes(group)) ordered.push(group);
        }
        for (const group of prevGroups) {
          if (!ordered.includes(group)) ordered.push(group);
        }
        return ordered;
      });

      setBudgets((prevBudgets) => {
        const byId = new Map(prevBudgets.map((budget) => [budget.id, budget]));
        const placed = new Set();
        const ordered = [];

        for (const section of sections) {
          const groupId = section?.groupId ?? UNGROUPED_ID;
          for (const budgetId of section?.budgetIds ?? []) {
            const budget = byId.get(budgetId);
            if (!budget || placed.has(budgetId)) continue;
            placed.add(budgetId);
            ordered.push(budget.groupId === groupId ? budget : { ...budget, groupId });
          }
        }
        for (const budget of prevBudgets) {
          if (!placed.has(budget.id)) ordered.push(budget);
        }
        return ordered;
      });

      return { ok: true };
    },
    [setBudgets, setGroups]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      groups,
      budgets,
      expenses,
      totalSpentCents,
      totalPlannedCents,
      getBudgetExpenses,
      getBudgetTotalCents,
      getPlannedCents,
      addExpense,
      addBudget,
      updateBudget,
      deleteBudget,
      deleteExpense,
      addGroup,
      renameGroup,
      deleteGroup,
      setCategoryLayout,
    }),
    [
      groups,
      budgets,
      expenses,
      totalSpentCents,
      totalPlannedCents,
      getBudgetExpenses,
      getBudgetTotalCents,
      getPlannedCents,
      addExpense,
      addBudget,
      updateBudget,
      deleteBudget,
      deleteExpense,
      addGroup,
      renameGroup,
      deleteGroup,
      setCategoryLayout,
    ]
  );

  return <BudgetsContext.Provider value={value}>{children}</BudgetsContext.Provider>;
};
