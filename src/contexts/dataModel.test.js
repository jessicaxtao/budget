import { act, renderHook } from "@testing-library/react";
import AppProviders from "./AppProviders";
import { useBudgets, UNCATEGORIZED_BUDGET_ID } from "./BudgetsContext";
import { useBudgetPlan } from "./BudgetPlanContext";
import { useIncome } from "./IncomeContext";
import { currentPeriod, toCents, todayISO, toPeriod } from "../utils";

const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

function stored(key) {
  return JSON.parse(localStorage.getItem(key));
}

describe("money helpers", () => {
  test("dollars convert to integer cents, including the awkward ones", () => {
    expect(toCents("4.50")).toBe(450);
    expect(toCents(0.1)).toBe(10);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0)).toBe(0);
  });

  test("unparseable amounts are rejected rather than becoming NaN", () => {
    expect(toCents("")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(NaN)).toBeNull();
    expect(toCents(Infinity)).toBeNull();
  });

  test("cents sum exactly where floating-point dollars would drift", () => {
    const dollars = [0.1, 0.2, 0.3];
    expect(dollars.reduce((a, b) => a + b, 0)).not.toBe(0.6);
    expect(dollars.map(toCents).reduce((a, b) => a + b, 0)).toBe(60);
  });

  test("dates use the local calendar, not UTC", () => {
    // toISOString() would report the previous day for anyone west of Greenwich
    // in the evening.
    const evening = new Date(2026, 0, 31, 23, 30);
    expect(todayISO(evening)).toBe("2026-01-31");
    expect(toPeriod(todayISO(evening))).toBe("2026-01");
  });
});

describe("migrating records written before the schema changed", () => {
  test("a legacy expense gains cents and an explicit unknown date", () => {
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e1", description: "Coffee", amount: 4.5, budgetId: "b1" }])
    );

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.expenses).toEqual([
      { id: "e1", description: "Coffee", amountCents: 450, budgetId: "b1", date: null },
    ]);
  });

  test("a legacy budget's max becomes this period's plan and leaves the budget", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries", max: 400 }]));

    const { result } = renderHook(
      () => ({ budgets: useBudgets(), plan: useBudgetPlan() }),
      { wrapper }
    );

    expect(result.current.budgets.budgets).toEqual([{ id: "b1", name: "Groceries" }]);
    expect(result.current.plan.getPlannedCents("b1", currentPeriod())).toBe(40000);
  });

  test("migration is idempotent — a second mount does not re-seed", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries", max: 400 }]));

    renderHook(() => useBudgetPlan(), { wrapper }).unmount();
    const { result } = renderHook(() => useBudgetPlan(), { wrapper });

    expect(result.current.plans).toHaveLength(1);
  });

  test("legacy income gains cents and an unknown date", () => {
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i1", description: "Salary", amount: 3000 }])
    );

    const { result } = renderHook(() => useIncome(), { wrapper });

    expect(result.current.income).toEqual([
      { id: "i1", description: "Salary", amountCents: 300000, date: null },
    ]);
    expect(result.current.totalIncomeCents).toBe(300000);
  });

  test("garbage in storage does not take the app down", () => {
    localStorage.setItem("expenses", "{ not json");
    localStorage.setItem("budgets", JSON.stringify("not even an array"));

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.expenses).toEqual([]);
    expect(result.current.budgets).toEqual([]);
  });
});

describe("amounts are validated at the context boundary", () => {
  test("a non-numeric expense amount is rejected, not stored as null", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addExpense({ description: "Bad", amount: "abc", budgetId: "x" });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.expenses).toHaveLength(0);
  });

  test("an invalid date is rejected", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addExpense({
        description: "Bad",
        amount: "5",
        budgetId: "x",
        date: "last tuesday",
      });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.expenses).toHaveLength(0);
  });

  test("a valid expense stores integer cents and today's date by default", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    act(() => {
      result.current.addExpense({ description: "Coffee", amount: "4.50", budgetId: "x" });
    });

    expect(result.current.expenses[0]).toMatchObject({
      description: "Coffee",
      amountCents: 450,
      date: todayISO(),
    });
    expect(stored("expenses")[0].amountCents).toBe(450);
  });
});

describe("plans are the single source of truth for a limit", () => {
  test("a period with no plan of its own carries the last one forward", () => {
    const { result } = renderHook(() => useBudgetPlan(), { wrapper });

    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-01", plannedCents: 40000 });
    });
    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-04", plannedCents: 50000 });
    });

    expect(result.current.getPlannedCents("b1", "2026-01")).toBe(40000);
    expect(result.current.getPlannedCents("b1", "2026-03")).toBe(40000);
    expect(result.current.getPlannedCents("b1", "2026-04")).toBe(50000);
    expect(result.current.getPlannedCents("b1", "2026-09")).toBe(50000);
  });

  test("a period before the first plan has no limit", () => {
    const { result } = renderHook(() => useBudgetPlan(), { wrapper });

    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-05", plannedCents: 40000 });
    });

    expect(result.current.getPlannedCents("b1", "2026-01")).toBe(0);
  });

  test("editing one period leaves the others intact", () => {
    const { result } = renderHook(() => useBudgetPlan(), { wrapper });

    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-01", plannedCents: 40000 });
    });
    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-02", plannedCents: 60000 });
    });
    act(() => {
      result.current.setPlannedAmount({ budgetId: "b1", period: "2026-02", plannedCents: 70000 });
    });

    expect(result.current.plans).toHaveLength(2);
    expect(result.current.getPlannedCents("b1", "2026-01")).toBe(40000);
    expect(result.current.getPlannedCents("b1", "2026-02")).toBe(70000);
  });
});

describe("deleting a budget", () => {
  test("reassigns its expenses and takes its plan history with it", () => {
    const { result } = renderHook(
      () => ({ budgets: useBudgets(), plan: useBudgetPlan() }),
      { wrapper }
    );

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries" }).id;
    });
    act(() => {
      result.current.plan.setPlannedAmount({
        budgetId: id,
        period: currentPeriod(),
        plannedCents: 40000,
      });
      result.current.budgets.addExpense({ description: "Coffee", amount: "4.50", budgetId: id });
    });

    expect(result.current.plan.plans).toHaveLength(1);

    act(() => {
      result.current.budgets.deleteBudget({ id });
    });

    expect(result.current.budgets.budgets).toHaveLength(0);
    expect(result.current.plan.plans).toHaveLength(0);
    // the expense survives — it is what actually happened
    expect(result.current.budgets.expenses).toHaveLength(1);
    expect(result.current.budgets.expenses[0].budgetId).toBe(UNCATEGORIZED_BUDGET_ID);
  });
});
