import { act, renderHook } from "@testing-library/react";
import AppProviders from "./AppProviders";
import { useBudgets, UNCATEGORIZED_BUDGET_ID } from "./BudgetsContext";
import { useBudgetPlan } from "./BudgetPlanContext";
import { useIncome } from "./IncomeContext";
import { useAssignments } from "./AssignmentsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import {
  addMonths,
  currentPeriod,
  periodLTE,
  toCents,
  todayISO,
  toPeriod,
} from "../utils";

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

  test("its funding follows its expenses onto Uncategorized", () => {
    const { result } = renderHook(
      () => ({
        budgets: useBudgets(),
        assignments: useAssignments(),
        env: useEnvelopes(currentPeriod()),
      }),
      { wrapper }
    );

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries" }).id;
    });
    act(() => {
      result.current.assignments.setAssignedAmount({
        budgetId: id,
        period: currentPeriod(),
        amountCents: 50000,
      });
      result.current.budgets.addExpense({ description: "Shop", amount: "200", budgetId: id });
    });

    const before = result.current.env.toBeAssignedCents;
    expect(envelopeFor(result.current.env, id).availableCents).toBe(30000);

    act(() => {
      result.current.budgets.deleteBudget({ id });
    });

    // The balance moves rather than evaporating: dropping the assignment would
    // hand the money back to the pool while the spend landed on Uncategorized,
    // asking the user to fund the same purchase twice.
    expect(envelopeFor(result.current.env, UNCATEGORIZED_BUDGET_ID).availableCents).toBe(30000);
    expect(result.current.env.toBeAssignedCents).toBe(before);
  });
});

describe("period arithmetic", () => {
  test("stepping a month crosses the year boundary in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-08", 0)).toBe("2026-08");
    expect(addMonths("2026-01", 25)).toBe("2028-02");
  });

  test("a malformed date has no period rather than an arbitrary one", () => {
    // "2026-1-5" used to slice to "2026-1-", which sorts after "2026-08" but
    // before "2026-11" — so the record vanished, then reappeared months later.
    expect(toPeriod("2026-1-5")).toBeNull();
    expect(toPeriod("not a date")).toBeNull();
    expect(toPeriod("2026-08")).toBe("2026-08");
    expect(toPeriod("2026-08-10")).toBe("2026-08");
  });

  test("comparing periods does not fall for the null coercion", () => {
    // `null <= null` is true in JavaScript: both sides coerce to 0. Undated
    // records are counted deliberately elsewhere, never by accident here.
    expect(periodLTE(null, null)).toBe(false);
    expect(periodLTE(null, "2026-08")).toBe(false);
    expect(periodLTE("2026-08", null)).toBe(false);
    expect(periodLTE("2026-07", "2026-08")).toBe(true);
    expect(periodLTE("2026-08", "2026-08")).toBe(true);
    expect(periodLTE("2026-09", "2026-08")).toBe(false);
  });
});

describe("assignments", () => {
  test("one row per category per period, upserted", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 40000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 55000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-02", amountCents: 10000 });
    });

    expect(result.current.assignments).toHaveLength(2);
    expect(result.current.getAssignedCents("b1", "2026-01")).toBe(55000);
    expect(result.current.getAssignedCents("b1", "2026-02")).toBe(10000);
  });

  test("a negative assignment is allowed — it is how money comes back out", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setAssignedAmount({
        budgetId: "b1",
        period: "2026-02",
        amountCents: -5000,
      });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.getAssignedCents("b1", "2026-02")).toBe(-5000);
  });

  test("zero is pruned rather than stored", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 40000 });
    });
    act(() => {
      result.current.setAssignedAmount({ budgetId: "b1", period: "2026-01", amountCents: 0 });
    });

    expect(result.current.assignments).toHaveLength(0);
    expect(stored("assignments")).toEqual([]);
  });

  test("an unparseable amount is rejected, not stored as null", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setAssignedAmount({
        budgetId: "b1",
        period: "2026-01",
        amount: "abc",
      });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.assignments).toHaveLength(0);
  });

  test("a batch is all or nothing", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.setPeriodAssignments({
        period: "2026-01",
        entries: [
          { budgetId: "b1", amountCents: 10000 },
          { budgetId: "b2", amount: "nonsense" },
          { budgetId: "b3", amountCents: 30000 },
        ],
      });
    });

    // A form that funds eight categories and fails on the third must not leave
    // two of them committed — the user has no way to tell which.
    expect(outcome.ok).toBe(false);
    expect(result.current.assignments).toHaveLength(0);
  });

  test("a valid batch lands in one commit", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });

    act(() => {
      result.current.setPeriodAssignments({
        period: "2026-01",
        entries: [
          { budgetId: "b1", amountCents: 10000 },
          { budgetId: "b2", amountCents: 20000 },
        ],
      });
    });

    expect(result.current.assignments).toHaveLength(2);
    expect(stored("assignments")).toHaveLength(2);
  });
});

describe("the day-one seed", () => {
  const LEGACY = [
    { id: "e1", description: "Shop", amount: 20, budgetId: "b1", date: "2026-01-04" },
    { id: "e2", description: "Fuel", amount: 30, budgetId: "b2", date: null },
  ];

  test("every envelope opens at zero rather than at its lifetime spend", () => {
    localStorage.setItem("expenses", JSON.stringify(LEGACY));
    localStorage.setItem(
      "budgets",
      JSON.stringify([
        { id: "b1", name: "Groceries" },
        { id: "b2", name: "Fuel" },
      ])
    );
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i1", description: "Pay", amount: 100, date: "2026-01-02" }])
    );

    const { result } = renderHook(() => useEnvelopes(currentPeriod()), { wrapper });

    // Seeding what was already spent invents no history: money the user spent
    // was money the user had.
    for (const row of result.current.rows) {
      expect(row.availableCents).toBe(0);
    }
    // What is left over is cash on hand, waiting to be given a job.
    expect(result.current.toBeAssignedCents).toBe(10000 - 5000);
  });

  test("a second mount does not seed again", () => {
    localStorage.setItem("expenses", JSON.stringify(LEGACY));

    renderHook(() => useAssignments(), { wrapper }).unmount();
    const { result } = renderHook(() => useAssignments(), { wrapper });

    expect(result.current.assignments).toHaveLength(2);
  });

  test("nothing is seeded for a ledger that has never logged an expense", () => {
    const { result } = renderHook(() => useAssignments(), { wrapper });
    expect(result.current.assignments).toHaveLength(0);
  });
});

/**
 * The tripwire.
 *
 *   toBeAssigned + Σ available === cumulative income − cumulative spend
 *
 * Money is either sitting in an envelope or waiting to be put in one; it is
 * never in both places and never in neither. The assignment terms cancel, so
 * this does not check the arithmetic — what it catches is a row set that stops
 * covering every budgetId, or a cascade that drops one side of a delete. Those
 * are the failures nothing else in the suite would notice.
 */
function expectBalanced(env) {
  const available = env.rows.reduce((sum, row) => sum + row.availableCents, 0);
  expect(env.toBeAssignedCents + available).toBe(env.cumIncomeCents - env.cumSpentCents);
}

function envelopeFor(env, budgetId) {
  return env.rows.find((row) => row.budgetId === budgetId);
}

describe("the books balance after every mutation", () => {
  const useLedger = () => ({
    budgets: useBudgets(),
    income: useIncome(),
    assignments: useAssignments(),
    past: useEnvelopes("2026-01"),
    now: useEnvelopes("2026-08"),
    later: useEnvelopes("2030-12"),
  });

  function expectAllBalanced(current) {
    expectBalanced(current.past);
    expectBalanced(current.now);
    expectBalanced(current.later);
  }

  test("through creation, funding, spending and every kind of delete", () => {
    // Undated records, from before dates existed, on both sides of the books.
    localStorage.setItem(
      "income",
      JSON.stringify([{ id: "i0", description: "Old", amount: 100 }])
    );
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e0", description: "Old", amount: 20, budgetId: "b1" }])
    );
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));

    const { result } = renderHook(useLedger, { wrapper });
    expectAllBalanced(result.current);

    let fuelId;
    act(() => {
      fuelId = result.current.budgets.addBudget({ name: "Fuel" }).id;
    });
    expectAllBalanced(result.current);

    act(() => {
      result.current.income.addIncome({ description: "June", amount: "500", date: "2026-06-15" });
      result.current.income.addIncome({ description: "Aug", amount: "700", date: "2026-08-05" });
      // Dated ahead: real, but not spendable until its month comes round.
      result.current.income.addIncome({ description: "Sep", amount: "900", date: "2026-09-20" });
    });
    expectAllBalanced(result.current);

    // A future-dated paycheck stays out of the pool until its month arrives.
    expect(result.current.now.toBeAssignedCents).toBeLessThan(
      result.current.later.toBeAssignedCents
    );

    act(() => {
      result.current.assignments.setPeriodAssignments({
        period: "2026-08",
        entries: [
          { budgetId: "b1", amountCents: 40000 },
          { budgetId: fuelId, amountCents: 20000 },
        ],
      });
    });
    expectAllBalanced(result.current);

    act(() => {
      result.current.budgets.addExpense({
        description: "Shop",
        amount: "150",
        budgetId: "b1",
        date: "2026-08-09",
      });
      result.current.budgets.addExpense({
        description: "Older shop",
        amount: "60",
        budgetId: "b1",
        date: "2026-06-02",
      });
      // An id with money against it and no category record. It still holds real
      // money, so every total has to keep covering it.
      result.current.budgets.addExpense({
        description: "Ghost",
        amount: "99",
        budgetId: "never-a-budget",
        date: "2026-08-01",
      });
    });
    expectAllBalanced(result.current);
    expect(envelopeFor(result.current.now, "never-a-budget").kind).toBe("orphan");

    act(() => {
      result.current.budgets.deleteBudget({ id: fuelId });
    });
    expectAllBalanced(result.current);

    act(() => {
      const [first] = result.current.income.income;
      result.current.income.deleteIncome({ id: first.id });
    });
    expectAllBalanced(result.current);

    act(() => {
      const past = result.current.budgets.expenses.find((e) => e.date === "2026-06-02");
      result.current.budgets.deleteExpense({ id: past.id });
    });
    expectAllBalanced(result.current);

    act(() => {
      result.current.assignments.setAssignedAmount({
        budgetId: "b1",
        period: "2026-09",
        amountCents: -15000,
      });
    });
    expectAllBalanced(result.current);
  });

  test("undated money is counted once, in every period", () => {
    localStorage.setItem(
      "expenses",
      JSON.stringify([{ id: "e0", description: "Old", amount: 20, budgetId: "b1" }])
    );
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));

    const { result } = renderHook(useLedger, { wrapper });

    // Undated spend sits behind every period rather than inside one, so the
    // balance moves between months only by that month's dated activity.
    expect(result.current.past.cumSpentCents).toBe(2000);
    expect(result.current.later.cumSpentCents).toBe(2000);
    expect(envelopeFor(result.current.past, "b1").spentCents).toBe(0);
    expect(envelopeFor(result.current.past, "b1").carriedInCents).toBe(-2000);
    expectAllBalanced(result.current);
  });
});
