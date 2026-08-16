import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useAssignments } from "../contexts/AssignmentsContext";
import useEnvelopes from "./useEnvelopes";
import useStartingBalances from "./useStartingBalances";
import { addMonths, currentPeriod, todayISO } from "../utils";

/**
 * Onboarding's door into envelope funding has to place an opening balance
 * where it will not read as this month's income — the whole point noted in
 * `useStartingBalances`'s own comment. These drive it through the real
 * providers, since what is under test is the interaction between an
 * account's own `openingDate` gate (which `AddAccountModal` defaults to
 * today) and `useEnvelopes`'s ordinary maths, not the hook in isolation.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

const PERIOD = currentPeriod();
const LAST_PERIOD = addMonths(PERIOD, -1);
const TODAY = todayISO();

// The default an account gets when added through AddAccountModal today — the
// exact shape that broke a period-from-opening-date approach.
const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 500000,
  openingDate: TODAY,
};

function seed({ accounts = [ACCOUNT], groups, budgets, transactions } = {}) {
  const write = (key, value) => value && localStorage.setItem(key, JSON.stringify(value));
  write("accounts", accounts);
  write("budgetGroups", groups);
  write("budgets", budgets);
  write("transactions", transactions);
  write("assignments", []);
}

test("with no ledger yet, the period is last month and the pool is the full opening balance", () => {
  seed();
  const { result } = renderHook(() => useStartingBalances(), { wrapper });

  expect(result.current.period).toBe(LAST_PERIOD);
  // The account opened today, so useEnvelopes' own gate would otherwise say
  // there is nothing to assign at last month — the override is what makes
  // the real balance available to place.
  expect(result.current.poolCentsOverride).toBe(500000);
});

test("the period sits before the earliest dated transaction, so it never collides with real activity", () => {
  const earlier = addMonths(PERIOD, -3);
  seed({
    transactions: [
      {
        id: "t1",
        kind: "outflow",
        accountId: ACCOUNT.id,
        budgetId: null,
        amountCents: 1000,
        date: `${earlier}-10`,
      },
    ],
  });
  const { result } = renderHook(() => useStartingBalances(), { wrapper });
  expect(result.current.period).toBe(addMonths(earlier, -1));
});

test("assigning the starting-balance pool does not show up as this month's assigned figure", () => {
  seed({ budgets: [{ id: "b1", name: "Groceries", groupId: null, plannedCents: 0, bucket: null }] });

  const { result: starting } = renderHook(() => useStartingBalances(), { wrapper });
  const { period, poolCentsOverride } = starting.current;
  expect(poolCentsOverride).toBe(500000);

  const { result: assignments } = renderHook(() => useAssignments(), { wrapper });
  act(() => {
    assignments.current.setPeriodAssignments({
      period,
      entries: [{ budgetId: "b1", amountCents: poolCentsOverride }],
    });
  });

  const { result: envelopes } = renderHook(() => useEnvelopes(PERIOD), { wrapper });
  // The money is available in the envelope...
  const row = envelopes.current.rows.find((r) => r.budgetId === "b1");
  expect(row.availableCents).toBe(500000);
  // ...but none of it reads as assigned *this* month, and the pool for this
  // month is empty rather than still holding the starting balance.
  expect(envelopes.current.periodAssignedCents).toBe(0);
  expect(envelopes.current.toBeAssignedCents).toBe(0);
});
