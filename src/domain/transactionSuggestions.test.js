import { discoverSchedules, matchSchedulePayments, suggestCategory } from "./transactionSuggestions";
import { nextOccurrence } from "./recurrence";

const payee = { id: "p" };
const budgets = [{ id: "food" }, { id: "bills" }];
const base = { payeeId: "p", accountId: "a", budgetId: "bills", kind: "outflow", amountCents: 10000 };
const tx = (date, changes = {}) => ({ ...base, id: date, date, ...changes });
const discovery = (transactions, changes = {}) => discoverSchedules({ transactions, schedules: [],
  payees: [payee], accounts: [{ id: "a" }], budgets, today: "2026-03-20", ...changes });
const category = (transactions, changes = {}) => suggestCategory({ transactions, payee, budgets, today: "2026-03-20", ...changes });

test("category requires three examples and 80 percent agreement, showing the supporting count", () => {
  const history = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"].map((date) => tx(date));
  expect(category(history.slice(0, 2))).toBeNull();
  expect(category([...history, tx("2026-03-05", { budgetId: "food" })])).toMatchObject({ budgetId: "bills", count: 4, total: 5 });
  expect(category([...history, tx("2026-03-05", { budgetId: "food" }), tx("2026-03-06", { budgetId: "food" })])).toBeNull();
});

test("category ignores old, future, undated, split, other-payee, transfer and deleted-category evidence", () => {
  const valid = [tx("2026-03-01"), tx("2026-03-02")];
  for (const invalid of [tx("2025-03-19"), tx("2026-03-21"), tx(null),
    tx("2026-03-03", { splits: [{ budgetId: "bills", amountCents: 10000 }] }),
    tx("2026-03-03", { payeeId: "another" }), tx("2026-03-03", { kind: "transfer" }),
    tx("2026-03-03", { budgetId: "deleted" })]) {
    expect(category([...valid, invalid])).toBeNull();
  }
});

test("category uses only the latest 20 and yields to live defaults and splits", () => {
  const history = Array.from({ length: 20 }, (_, index) => tx(`2026-03-${String(index + 1).padStart(2, "0")}`));
  expect(category([...history, tx("2026-02-01", { budgetId: "food" })])).toMatchObject({ count: 20, total: 20 });
  expect(category(history, { payee: { ...payee, defaultBudgetId: "food" } })).toBeNull();
  expect(category(history, { payee: { ...payee, defaultSplit: [{ budgetId: "food" }, { budgetId: "bills" }] } })).toBeNull();
  expect(category(history, { payee: { ...payee, defaultBudgetId: "gone" } })).not.toBeNull();
});

test.each([
  [["2026-03-02", "2026-03-09", "2026-03-16"], "weekly", "2026-03-23"],
  [["2026-02-16", "2026-03-02", "2026-03-16"], "biweekly", "2026-03-30"],
  [["2026-01-15", "2026-02-16", "2026-03-15"], "monthly", "2026-04-15"],
  [["2025-09-15", "2025-12-15", "2026-03-15"], "quarterly", "2026-06-15"],
  [["2024-03-15", "2025-03-15", "2026-03-15"], "annually", "2027-03-15"],
])("discovers regular cadence with posting drift: %s", (dates, cadence, startDate) => {
  expect(discovery(dates.map((date) => tx(date)))).toEqual([expect.objectContaining({ cadence, startDate, amountCents: 10000 })]);
});

test("month ends and leap years preserve the inferred day when next month is shorter", () => {
  const [candidate] = discovery([tx("2025-11-30"), tx("2025-12-31"), tx("2026-01-31")], { today: "2026-02-01" });
  expect(candidate).toMatchObject({ startDate: "2026-02-28", anchorDay: 31 });
  expect(nextOccurrence(candidate, "2026-03-01")).toBe("2026-03-31");
  expect(discovery([tx("2024-01-31"), tx("2024-02-29"), tx("2024-03-31")], { today: "2024-04-01" })[0])
    .toMatchObject({ startDate: "2024-04-30", anchorDay: 31 });
});

test("rejects irregular purchases, changing amounts, missing history and stale patterns", () => {
  expect(discovery([tx("2026-01-01"), tx("2026-02-10"), tx("2026-03-15")])).toEqual([]);
  expect(discovery([tx("2026-01-15"), tx("2026-02-15", { amountCents: 10600 }), tx("2026-03-15")])).toEqual([]);
  expect(discovery([tx("2026-02-15"), tx("2026-03-15")])).toEqual([]);
  expect(discovery([tx("2025-12-15"), tx("2026-01-15"), tx("2026-02-15")])).toEqual([]);
  // Three non-leap Februaries cannot distinguish the 28th from a clamped 29th.
  expect(discovery([tx("2025-02-28"), tx("2026-02-28"), tx("2027-02-28")], { today: "2027-03-01" })).toEqual([]);
});

test("latest consecutive payments, exact grouping and active schedules limit discovery", () => {
  const history = [tx("2026-01-15"), tx("2026-02-15"), tx("2026-03-15")];
  expect(discovery([...history, tx("2026-03-18")])).toEqual([]);
  expect(discovery(history, { schedules: [{ ...base, cadence: "monthly" }] })).toEqual([]);
  expect(discovery(history, { schedules: [{ ...base, cadence: "monthly", endsOn: "2026-03-01" }] })).toHaveLength(1);
  expect(discovery(history, { payees: [] })).toEqual([]);
  expect(discovery(history, { accounts: [] })).toEqual([]);
  expect(discovery(history, { budgets: [] })).toEqual([]);
  expect(discovery(history.map((row, i) => ({ ...row, accountId: i ? "a" : "other" })))).toEqual([]);
});

const schedule = { ...base, id: "s", startDate: "2026-03-15", cadence: "monthly" };
const match = (transactions, changes = {}) => matchSchedulePayments({ schedule, date: "2026-03-15", transactions,
  schedules: [schedule], today: "2026-03-20", ...changes });

test("matches within three days and five percent and ranks date before amount", () => {
  const history = [tx("2026-03-18"), tx("2026-03-15", { amountCents: 10500 }), tx("2026-03-12"),
    tx("2026-03-19"), tx("2026-03-15", { id: "too-much", amountCents: 10501 })];
  expect(match(history).map((row) => row.id)).toEqual(["2026-03-15", "2026-03-12", "2026-03-18"]);
});

test("matching rejects wrong identity, splits, future records and already-linked payments", () => {
  for (const changes of [{ payeeId: "other" }, { accountId: "other" }, { kind: "inflow" },
    { budgetId: "food" }, { date: null }, { splits: [{ budgetId: "bills", amountCents: 10000 }] }]) {
    expect(match([tx("2026-03-15", changes)])).toEqual([]);
  }
  expect(match([tx("2026-03-15")], { today: "2026-03-14" })).toEqual([]);
  expect(match([tx("2026-03-15")], { schedules: [{ ...schedule, occurrenceDecisions: {
    "2026-02-15": { status: "recorded", transactionId: "2026-03-15" },
  } }] })).toEqual([]);
  expect(match([tx("2026-03-15")], { schedule: { ...schedule, enteredThrough: "2026-03-15" } })).toEqual([]);
});
