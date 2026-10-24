import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useSchedules } from "../contexts/SchedulesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useUpcoming from "./useUpcoming";
import useAccountBalances from "./useAccountBalances";
import { useSchedulePaymentMatches } from "./useScheduleSuggestions";

const TODAY = "2026-03-20";
const schedule = { id: "s", kind: "outflow", payeeId: "p", accountId: "a", budgetId: "b",
  amountCents: 10000, cadence: "weekly", startDate: "2026-03-06", endsOn: null, enteredThrough: null };
const payment = { id: "t", kind: "outflow", payeeId: "p", accountId: "a", budgetId: "b",
  amountCents: 10000, date: TODAY };
const stored = (key) => JSON.parse(localStorage.getItem(key));
function seed(schedules = [schedule]) {
  localStorage.clear();
  for (const [key, value] of Object.entries({ schedules, transactions: [payment],
    payees: [{ id: "p", name: "Gym" }], budgets: [{ id: "b", name: "Fitness", plannedCents: 0 }],
    accounts: [{ id: "a", name: "Checking", type: "asset", scope: "on-budget", assetClass: "Cash", openingBalanceCents: 50000 }] })) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}
function renderStore() {
  return renderHook(() => {
    const upcoming = useUpcoming(TODAY);
    return { ...useSchedules(), ledger: useTransactions(), upcoming,
      matching: useSchedulePaymentMatches(upcoming.rows, TODAY), balances: useAccountBalances("2026-03") };
  }, { wrapper: AppProviders });
}

test("matching a newer payment leaves older reminders and all ledger figures untouched, including after reload", () => {
  seed();
  const mounted = renderStore();
  const before = stored("transactions");
  const balances = mounted.result.current.balances;
  const row = mounted.result.current.upcoming.rows.find((entry) => entry.date === TODAY);
  let outcome;
  act(() => { outcome = mounted.result.current.matching.confirmMatch(row, "t"); });
  expect(outcome.ok).toBe(true);
  expect(mounted.result.current.upcoming.rows.map((entry) => entry.date)).toEqual(expect.arrayContaining(["2026-03-06", "2026-03-13"]));
  expect(mounted.result.current.upcoming.rows.some((entry) => entry.date === TODAY)).toBe(false);
  expect(stored("transactions")).toEqual(before);
  expect(mounted.result.current.balances).toEqual(balances);
  expect(stored("schedules")[0].enteredThrough).toBeNull();
  mounted.unmount();
  const reloaded = renderStore();
  expect(reloaded.result.current.upcoming.rows.some((entry) => entry.date === TODAY)).toBe(false);
  expect(reloaded.result.current.schedules[0].occurrenceDecisions[TODAY]).toEqual({ status: "recorded", transactionId: "t" });
});

test("repeated clicks and competing occurrences cannot reuse one transaction, even within one event", () => {
  seed([schedule, { ...schedule, id: "other" }]);
  const { result } = renderStore();
  let first, second, repeated;
  act(() => {
    first = result.current.resolveOccurrence({ id: "s", date: TODAY, status: "recorded", transactionId: "t" });
    second = result.current.resolveOccurrence({ id: "other", date: TODAY, status: "recorded", transactionId: "t" });
    repeated = result.current.resolveOccurrence({ id: "s", date: TODAY, status: "recorded", transactionId: "t" });
  });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(false);
  expect(repeated.ok).toBe(false);
  expect(result.current.matching.matches.get(`other:${TODAY}`)).toEqual([]);
});

test("edited or deleted payments do not reopen reminders; explicit reopening preserves the ledger", () => {
  seed();
  const { result } = renderStore();
  act(() => { result.current.resolveOccurrence({ id: "s", date: TODAY, status: "recorded", transactionId: "t" }); });
  act(() => { result.current.ledger.updateTransaction({ id: "t", date: "2026-03-19" }); });
  expect(result.current.upcoming.rows.some((row) => row.date === TODAY)).toBe(false);
  act(() => { result.current.ledger.deleteTransaction({ id: "t" }); });
  expect(result.current.upcoming.rows.some((row) => row.date === TODAY)).toBe(false);
  act(() => { result.current.reopenOccurrence({ id: "s", date: TODAY }); });
  expect(result.current.upcoming.rows.some((row) => row.date === TODAY)).toBe(true);
  expect(stored("transactions")).toEqual([]);
});

test("legacy history stays handled, invalid decisions fail, and stale matches are revalidated", () => {
  seed([{ ...schedule, enteredThrough: "2026-03-13" }]);
  const { result } = renderStore();
  expect(result.current.schedules[0].occurrenceDecisions).toEqual({});
  expect(result.current.upcoming.rows[0].date).toBe(TODAY);
  for (const input of [{ date: "2026-03-13" }, { date: "2026-03-21" }, { date: "bad" },
    { date: TODAY, status: "guessed" }, { date: TODAY, status: "skipped", transactionId: "t" },
    { date: TODAY, id: "missing" }]) {
    let outcome;
    act(() => { outcome = result.current.resolveOccurrence({ id: "s", status: "recorded", ...input }); });
    expect(outcome.ok).toBe(false);
  }
  const row = result.current.upcoming.rows[0];
  act(() => { result.current.ledger.updateTransaction({ id: "t", amountCents: 30000 }); });
  let refused;
  act(() => { refused = result.current.matching.confirmMatch(row, "t"); });
  expect(refused.ok).toBe(false);
  expect(result.current.upcoming.rows[0].date).toBe(TODAY);
});

test("resolved dates do not consume the upcoming cap and a missing reference is retained", () => {
  const decisions = Object.fromEntries(["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30",
    "2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27", "2026-03-06", "2026-03-13", "2026-03-20"]
    .map((date) => [date, { status: "recorded", transactionId: `missing:${date}` }]));
  seed([{ ...schedule, startDate: "2026-01-02", occurrenceDecisions: decisions }]);
  const { result } = renderStore();
  expect(result.current.upcoming.rows[0].date).toBe("2026-03-27");
  expect(result.current.schedules[0].occurrenceDecisions).toEqual(decisions);
});
