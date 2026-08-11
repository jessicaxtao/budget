import { act, renderHook } from "@testing-library/react";
import AppProviders from "./AppProviders";
import { useBudgets, UNCATEGORIZED_BUDGET_ID, UNGROUPED_ID } from "./BudgetsContext";
import { useIncomePlan } from "./IncomePlanContext";
import { useIncome } from "./IncomeContext";
import { useAssignments } from "./AssignmentsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import { monthlyCents } from "../cadence";
import { toSections } from "../planLayout";
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

  test("a legacy budget's floating-point max becomes its standing estimate in cents", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries", max: 400 }]));

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets).toEqual([
      { id: "b1", name: "Groceries", plannedCents: 40000, groupId: UNGROUPED_ID },
    ]);
  });

  test("the last per-period plan folds into the estimate on the budget", () => {
    // The schema in between filed an estimate against each month. The standing
    // figure is the most recent one the user stated, not the earliest.
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem(
      "budgetPlans",
      JSON.stringify([
        { id: "p1", budgetId: "b1", period: "2026-01", plannedCents: 40000 },
        { id: "p2", budgetId: "b1", period: "2026-04", plannedCents: 50000 },
        { id: "p3", budgetId: "b1", period: "2026-02", plannedCents: 45000 },
      ])
    );

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets[0].plannedCents).toBe(50000);
  });

  test("a broken budgetPlans key costs the estimates, not the categories", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem("budgetPlans", "{ not json");

    const { result } = renderHook(() => useBudgets(), { wrapper });

    expect(result.current.budgets).toEqual([
      { id: "b1", name: "Groceries", plannedCents: 0, groupId: UNGROUPED_ID },
    ]);
  });

  test("migration is idempotent — a second mount does not re-read the old key", () => {
    localStorage.setItem("budgets", JSON.stringify([{ id: "b1", name: "Groceries" }]));
    localStorage.setItem(
      "budgetPlans",
      JSON.stringify([{ id: "p1", budgetId: "b1", period: "2026-01", plannedCents: 40000 }])
    );

    renderHook(() => useBudgets(), { wrapper }).unmount();
    // The estimate is on the record now, so the legacy key is not consulted
    // again — and editing it down to zero must not be undone by a remount.
    const { result } = renderHook(() => useBudgets(), { wrapper });
    act(() => {
      result.current.updateBudget({ id: "b1", plannedCents: 0 });
    });

    renderHook(() => useBudgets(), { wrapper }).unmount();
    const { result: remounted } = renderHook(() => useBudgets(), { wrapper });

    expect(remounted.current.budgets[0].plannedCents).toBe(0);
  });

  test("a legacy income source loses its anchor date and keeps its cadence", () => {
    localStorage.setItem(
      "incomeSources",
      JSON.stringify([
        {
          id: "s1",
          name: "Salary",
          amount: 1500,
          cadence: "biweekly",
          anchorDate: "2026-01-02",
          endDate: null,
        },
      ])
    );

    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    expect(result.current.sources).toEqual([
      { id: "s1", name: "Salary", amountCents: 150000, cadence: "biweekly" },
    ]);
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

describe("the estimate is one standing figure on the category", () => {
  test("it reads the same in every period, past and future alike", () => {
    const useAll = () => ({
      budgets: useBudgets(),
      past: useEnvelopes("2020-01"),
      later: useEnvelopes("2030-12"),
    });
    const { result } = renderHook(useAll, { wrapper });

    let id;
    act(() => {
      id = result.current.budgets.addBudget({ name: "Groceries", planned: "400" }).id;
    });

    // No carry-forward rule to get wrong: there is one figure, and it describes
    // the category rather than a month.
    expect(envelopeFor(result.current.past, id).plannedCents).toBe(40000);
    expect(envelopeFor(result.current.later, id).plannedCents).toBe(40000);
  });

  test("editing it restates the plan rather than adding a record", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let id;
    act(() => {
      id = result.current.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.updateBudget({ id, planned: "500" });
    });

    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.getPlannedCents(id)).toBe(50000);
    expect(result.current.totalPlannedCents).toBe(50000);
  });

  test("a category with no estimate stated reads as zero, and junk is refused", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let blank;
    let junk;
    act(() => {
      blank = result.current.addBudget({ name: "Undecided" });
      junk = result.current.addBudget({ name: "Nonsense", planned: "abc" });
    });

    expect(blank.ok).toBe(true);
    expect(result.current.getPlannedCents(blank.id)).toBe(0);
    expect(junk.ok).toBe(false);
    expect(result.current.budgets).toHaveLength(1);
  });

  test("renaming does not blank the estimate it was not asked about", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let id;
    act(() => {
      id = result.current.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.updateBudget({ id, name: "Food" });
    });

    expect(result.current.budgets[0]).toMatchObject({ name: "Food", plannedCents: 40000 });
  });
});

describe("expected income is an average, never a month", () => {
  test("a cadence contributes its yearly total spread over twelve months", () => {
    // 26 fortnightly payments is 2.1667 a month, not two. Taking two would
    // leave the plan short by a month's pay every year.
    expect(monthlyCents(150000, "biweekly")).toBe(325000);
    expect(monthlyCents(150000, "semimonthly")).toBe(300000);
    expect(monthlyCents(150000, "monthly")).toBe(150000);
    expect(monthlyCents(120000, "annually")).toBe(10000);
  });

  test("an unknown cadence expects nothing rather than guessing", () => {
    expect(monthlyCents(150000, "fortnightly-ish")).toBe(0);
    expect(monthlyCents(150000, undefined)).toBe(0);
  });

  test("a source without a cadence is refused at the boundary", () => {
    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    let outcome;
    act(() => {
      outcome = result.current.addIncomeSource({ name: "Salary", amount: "1500" });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.sources).toHaveLength(0);
  });

  test("the expected total is the sum of the monthly averages", () => {
    const { result } = renderHook(() => useIncomePlan(), { wrapper });

    act(() => {
      result.current.addIncomeSource({ name: "Salary", amount: "1500", cadence: "biweekly" });
      result.current.addIncomeSource({ name: "Rent", amount: "800", cadence: "monthly" });
    });

    expect(result.current.expectedMonthlyCents).toBe(325000 + 80000);
  });
});

describe("groups are headings, not owners", () => {
  test("deleting one hands its categories back rather than taking them with it", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let groupId;
    let budgetId;
    act(() => {
      groupId = result.current.addGroup({ name: "Fixed" }).id;
    });
    act(() => {
      budgetId = result.current.addBudget({ name: "Rent", planned: "1200", groupId }).id;
    });

    expect(result.current.budgets[0].groupId).toBe(groupId);

    act(() => {
      result.current.deleteGroup({ id: groupId });
    });

    expect(result.current.groups).toHaveLength(0);
    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.budgets[0]).toMatchObject({
      id: budgetId,
      plannedCents: 120000,
      groupId: UNGROUPED_ID,
    });
  });

  test("a category filed under a group that never existed is not stranded", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    act(() => {
      result.current.addBudget({ name: "Rent", planned: "1200", groupId: "no-such-group" });
    });

    expect(result.current.budgets[0].groupId).toBe(UNGROUPED_ID);
  });

  test("clashing group names are refused, case-insensitively", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let outcome;
    act(() => {
      result.current.addGroup({ name: "Fixed" });
    });
    act(() => {
      outcome = result.current.addGroup({ name: "  fixed  " });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.groups).toHaveLength(1);
  });
});

describe("rearranging the categories", () => {
  function seedThree(result) {
    const ids = {};
    act(() => {
      ids.fixed = result.current.addGroup({ name: "Fixed" }).id;
    });
    act(() => {
      ids.rent = result.current.addBudget({ name: "Rent", planned: "1200" }).id;
      ids.food = result.current.addBudget({ name: "Food", planned: "400" }).id;
      ids.fuel = result.current.addBudget({ name: "Fuel", planned: "120" }).id;
    });
    return ids;
  }

  test("one commit changes both the group and the order", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent] },
        { groupId: null, budgetIds: [ids.fuel, ids.food] },
      ]);
    });

    expect(result.current.budgets.map((budget) => budget.name)).toEqual(["Rent", "Fuel", "Food"]);
    expect(result.current.budgets[0].groupId).toBe(ids.fixed);
    expect(result.current.budgets[1].groupId).toBe(UNGROUPED_ID);
  });

  test("a rearrangement never deletes a category it was not told about", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      // Fuel is missing, and one id is not a category at all.
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.food, "not-a-budget"] },
      ]);
    });

    expect(result.current.budgets).toHaveLength(3);
    expect(result.current.budgets.map((budget) => budget.name)).toEqual(["Food", "Rent", "Fuel"]);
  });

  test("the same category listed twice lands once", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent] },
        { groupId: null, budgetIds: [ids.rent, ids.food, ids.fuel] },
      ]);
    });

    expect(result.current.budgets).toHaveLength(3);
    expect(result.current.budgets[0].groupId).toBe(ids.fixed);
  });

  test("sections fold the two flat lists back into headings, ungrouped last", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });
    const ids = seedThree(result);

    act(() => {
      result.current.setCategoryLayout([
        { groupId: ids.fixed, budgetIds: [ids.rent, ids.food] },
        { groupId: null, budgetIds: [ids.fuel] },
      ]);
    });

    const sections = toSections(result.current.groups, result.current.budgets);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ groupId: ids.fixed, name: "Fixed", plannedCents: 160000 });
    expect(sections[0].budgets.map((budget) => budget.name)).toEqual(["Rent", "Food"]);
    // Always present, even when empty — it is the only place a category can be
    // dragged out to.
    expect(sections[1]).toMatchObject({ groupId: UNGROUPED_ID, plannedCents: 12000 });
  });
});

describe("deleting a budget", () => {
  test("reassigns its expenses and takes its estimate with it", () => {
    const { result } = renderHook(() => useBudgets(), { wrapper });

    let id;
    act(() => {
      id = result.current.addBudget({ name: "Groceries", planned: "400" }).id;
    });
    act(() => {
      result.current.addExpense({ description: "Coffee", amount: "4.50", budgetId: id });
    });

    expect(result.current.totalPlannedCents).toBe(40000);

    act(() => {
      result.current.deleteBudget({ id });
    });

    // The estimate goes with the record — there is nothing left for it to
    // describe.
    expect(result.current.budgets).toHaveLength(0);
    expect(result.current.totalPlannedCents).toBe(0);
    // the expense survives — it is what actually happened
    expect(result.current.expenses).toHaveLength(1);
    expect(result.current.expenses[0].budgetId).toBe(UNCATEGORIZED_BUDGET_ID);
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
