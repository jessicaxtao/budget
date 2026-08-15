import { renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import useSpendingReport from "./useSpendingReport";
import { toPeriod } from "../utils";

/**
 * The report reads across the ledger and the plan, so these drive it through the
 * real providers with JSON in storage — the same way the rest of the cross-store
 * hooks are tested, and for the same reason: the migrations and the provider
 * order are part of what is under test.
 *
 * Every period here is written out rather than derived from today, because a
 * report is a statement about particular months and a test whose window slides
 * with the calendar cannot say which months it meant.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

beforeEach(() => {
  localStorage.clear();
});

const END = "2026-08";

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
};

function seed({ accounts = [ACCOUNT], groups, budgets, transactions } = {}) {
  const write = (key, value) => value && localStorage.setItem(key, JSON.stringify(value));
  write("accounts", accounts);
  write("budgetGroups", groups);
  write("budgets", budgets);
  write("transactions", transactions);
}

const budget = (id, name, groupId = null, plannedCents = 0) => ({
  id,
  name,
  groupId,
  plannedCents,
  goalCents: null,
  bucket: null,
});

let sequence = 0;
const ledger = (kind) => (date, amountCents, budgetId = null) => ({
  id: `t${(sequence += 1)}`,
  kind,
  accountId: ACCOUNT.id,
  budgetId,
  amountCents,
  date,
});
const out = ledger(TRANSACTION_KINDS.OUTFLOW);
const inn = ledger(TRANSACTION_KINDS.INFLOW);

const read = (range = "12m", period = END) =>
  renderHook(() => useSpendingReport(period, range), { wrapper }).result.current;

/** The identity's right-hand side, computed straight off the seed: cash that
 *  actually moved in the window, with no notion of income or refunds in it. */
const cashMoved = (transactions, months) =>
  transactions
    .filter((transaction) => months.includes(toPeriod(transaction.date)))
    .reduce(
      (sum, transaction) =>
        sum +
        (transaction.kind === TRANSACTION_KINDS.INFLOW
          ? transaction.amountCents
          : -transaction.amountCents),
      0
    );

describe("the window", () => {
  test("a range resolves to whole months, oldest first, ending at the month asked for", () => {
    seed({ budgets: [budget("b1", "Rent")] });

    expect(read("3m").months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(read("12m").months).toHaveLength(12);
    expect(read("12m").months[0]).toBe("2025-09");
    // The year so far, not the last twelve months — which is the range beside
    // it, and the reason both exist.
    expect(read("ytd").months[0]).toBe("2026-01");
    expect(read("ytd").months).toHaveLength(8);
  });

  test("all time starts at the first record on the books, not at the first category", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2024-11-03", 100000, "b1"), out("2026-08-01", 50000, "b1")],
    });

    const report = read("all");

    expect(report.startPeriod).toBe("2024-11");
    expect(report.months).toHaveLength(22);
  });

  test("a ledger with nothing datable still gives a window rather than an empty one", () => {
    // "All time" over a ledger of undated records has no first month to reach
    // back to. An empty month list would divide every per-month figure by
    // nothing, so the window falls back to the end month itself.
    seed({ budgets: [budget("b1", "Rent")], transactions: [out(null, 100000, "b1")] });

    const report = read("all");

    expect(report.months).toEqual([END]);
    expect(report.averagedOverMonths).toBe(1);
  });

  test("months outside the window contribute nothing to it", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [
        out("2026-02-01", 100000, "b1"), // before a 3-month window
        out("2026-07-01", 50000, "b1"), // inside it
        out("2026-11-01", 900000, "b1"), // dated past the end of the books
      ],
    });

    const report = read("3m");

    expect(report.netSpentCents).toBe(50000);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].netSpentCents).toBe(50000);
  });
});

describe("income, spending and what was left", () => {
  const transactions = [
    inn("2026-07-01", 500000),
    inn("2026-08-01", 500000),
    out("2026-07-05", 120000, "b1"),
    out("2026-08-06", 80000, "b1"),
    out("2026-08-07", 30000, "b2"),
    // A refund: money coming back to the category it left.
    inn("2026-08-09", 12000, "b2"),
  ];

  const setup = () =>
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [budget("b1", "Rent", "g1", 100000), budget("b2", "Dining", null, 20000)],
      transactions,
    });

  test("the identity holds: net is every inflow less every outflow in the window", () => {
    setup();
    const report = read("3m");

    // The tripwire. Both sides count the refund exactly once and by different
    // routes — the left through the category it went back to, the right as the
    // cash it plainly is. Netting it off spending *and* adding it to income
    // would create money; doing neither would lose it.
    expect(report.netCents).toBe(cashMoved(transactions, report.months));
    expect(report.netCents).toBe(report.totalIncomeCents - report.netSpentCents);
  });

  test("a refund nets off its category and is not counted as income", () => {
    setup();
    const report = read("3m");

    expect(report.totalIncomeCents).toBe(1000000);
    // $300 out on dining, $120 back: dining cost $180.
    const dining = report.rows.find((row) => row.name === "Dining");
    expect(dining.spentCents).toBe(30000);
    expect(dining.refundCents).toBe(12000);
    expect(dining.netSpentCents).toBe(18000);
    // Gross and net are both reported, and the totals keep them apart.
    expect(report.totalSpentCents).toBe(230000);
    expect(report.totalRefundCents).toBe(12000);
    expect(report.netSpentCents).toBe(218000);
  });

  test("the savings rate is a share of income, and a dash where there is none", () => {
    setup();
    // $1,000,000 in, $218,000 out: $782,000 kept, which is 78.2%.
    expect(read("3m").savingsRateBps).toBe(7820);

    localStorage.clear();
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2026-08-01", 50000, "b1")],
    });
    // Spending with no recorded income is not a savings rate of minus
    // infinity — it is a window with nothing to be a share of.
    expect(read("3m").savingsRateBps).toBeNull();
  });

  test("a month is a row of its own, and the months add up to the totals", () => {
    setup();
    const report = read("3m");

    expect(report.series.map((month) => month.period)).toEqual(report.months);
    const july = report.series.find((month) => month.period === "2026-07");
    expect(july).toMatchObject({
      incomeCents: 500000,
      spentCents: 120000,
      refundCents: 0,
      netSpentCents: 120000,
      netCents: 380000,
    });
    expect(report.series.reduce((sum, month) => sum + month.netCents, 0)).toBe(report.netCents);
  });
});

describe("undated records", () => {
  test("are in no month, and are counted so the page can say so", () => {
    const transactions = [
      out("2026-08-01", 50000, "b1"),
      out(null, 70000, "b1"),
      inn(null, 30000),
    ];
    seed({ budgets: [budget("b1", "Rent")], transactions });

    const report = read("3m");

    // Placing an undated record in a month would invent the history the books
    // deliberately refuse to invent, so it is left out and reported.
    expect(report.netSpentCents).toBe(50000);
    expect(report.totalIncomeCents).toBe(0);
    expect(report.undatedCount).toBe(2);
    expect(report.undatedSpentCents).toBe(70000);
    expect(report.undatedIncomeCents).toBe(30000);
    // Which keeps the identity true of what is on screen: it is an identity
    // about the window, and an undated record is not in it.
    expect(report.netCents).toBe(cashMoved(transactions, report.months));
  });
});

describe("the per-month average", () => {
  test("spreads a once-a-year cost across the whole window, not across the month it fell in", () => {
    seed({
      budgets: [budget("b1", "Insurance", null, 10000)],
      transactions: [
        out("2025-09-01", 1200, "b1"), // opens the books a year back
        out("2026-03-11", 120000, "b1"),
      ],
    });

    const report = read("12m");
    const row = report.rows[0];

    expect(report.averagedOverMonths).toBe(12);
    expect(row.netSpentCents).toBe(121200);
    expect(row.averageCents).toBe(10100);
    // The count is what tells a reader the average is a lump rather than a
    // rate — the same figure means different things at 2 of 12 and at 12 of 12.
    expect(row.monthsWithSpend).toBe(2);
  });

  test("divides by the months the books cover, not by the months asked for", () => {
    seed({
      budgets: [budget("b1", "Rent")],
      transactions: [out("2026-07-01", 100000, "b1"), out("2026-08-01", 100000, "b1")],
    });

    const report = read("12m");

    // Two months of records over a twelve-month window. Dividing by twelve
    // would report $16,667 a month on a household spending $100,000, and would
    // do it silently.
    expect(report.averagedOverMonths).toBe(2);
    expect(report.coverageStartPeriod).toBe("2026-07");
    expect(report.rows[0].averageCents).toBe(100000);
    expect(report.averageSpendCents).toBe(100000);
  });
});

describe("the category ranking", () => {
  test("is by what was spent, biggest first, with each row's heading on it", () => {
    seed({
      groups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [
        // Deliberately arranged smallest-first on the plan, so the ranking
        // cannot be the plan's order by accident.
        budget("b1", "Dining", null, 20000),
        budget("b2", "Rent", "g1", 100000),
      ],
      transactions: [
        out("2026-08-01", 30000, "b1"),
        out("2026-08-02", 150000, "b2"),
        out("2026-08-03", 4000, null), // no category at all
        out("2026-08-04", 9000, "gone"), // a category since deleted
      ],
    });

    const report = read("3m");

    expect(report.rows.map((row) => row.name)).toEqual([
      "Rent",
      "Dining",
      "Unknown category",
      "Uncategorized",
    ]);
    expect(report.rows[0]).toMatchObject({
      groupName: "Bills",
      bucket: "essentials",
      targetCents: 100000,
      shareBps: 7772, // 150,000 of 193,000
    });
    // A category filed under nothing says so rather than being given a heading
    // it does not have.
    expect(report.rows[2].groupName).toBeNull();
    // No estimate set is not an estimate of zero.
    expect(report.rows[1].targetCents).toBe(20000);
    expect(report.rows[3].targetCents).toBeNull();
  });

  test("a category with nothing against it is not a row", () => {
    seed({
      budgets: [budget("b1", "Rent", null, 100000), budget("b2", "Unused", null, 5000)],
      transactions: [out("2026-08-01", 30000, "b1")],
    });

    expect(read("3m").rows.map((row) => row.name)).toEqual(["Rent"]);
  });

  test("the buckets add up to the spending above them, catch-alls included", () => {
    seed({
      groups: [
        { id: "g1", name: "Bills", bucket: "essentials" },
        { id: "g2", name: "Treats", bucket: "fun" },
      ],
      budgets: [budget("b1", "Rent", "g1"), budget("b2", "Dining", "g2")],
      transactions: [
        out("2026-08-01", 150000, "b1"),
        out("2026-08-02", 50000, "b2"),
        out("2026-08-03", 10000, null),
      ],
    });

    const report = read("3m");

    expect(report.buckets.map((entry) => [entry.label, entry.netSpentCents])).toEqual([
      ["Essentials", 150000],
      ["Fun", 50000],
      ["No category", 10000],
    ]);
    // The split describes the same household as the headline does, or it is
    // describing a smaller one.
    expect(report.buckets.reduce((sum, entry) => sum + entry.netSpentCents, 0)).toBe(
      report.netSpentCents
    );
    // Savings had nothing in it, so it is not a segment of nothing.
    expect(report.buckets.map((entry) => entry.label)).not.toContain("Savings");
  });
});
