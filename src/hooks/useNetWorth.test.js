import { renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import useNetWorth, {
  HOLDING_CLASSES,
  SPENDING_SLICE,
  holdingClass,
  percentChangeBps,
} from "./useNetWorth";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { PLAN_BUCKETS } from "../contexts/BudgetsContext";
import { addMonths } from "../utils";

/**
 * The net-worth maths through the real stores, as everywhere else in this suite:
 * the rules being tested are a *join* across two contexts, and mocking either
 * would assert only that the mock was wired up.
 *
 * What they are mostly about is the asymmetry — every account can be snapshotted,
 * but a hand-valued holding's figure carries forward while one for an account the
 * budget spends through answers for its own month and hands back to the ledger.
 *
 * A fixed period rather than `currentPeriod()`, since half of what is asserted
 * here is about months before and after the one on screen.
 */
const PERIOD = "2026-08";
const BEFORE = addMonths(PERIOD, -1);
const AFTER = addMonths(PERIOD, 1);

const account = (overrides) => ({
  type: "asset",
  scope: "off-budget",
  assetClass: "Stocks",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
  ...overrides,
});

const EVERYDAY = account({
  id: "acc-cash",
  name: "Everyday",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 200000,
});

const BROKERAGE = account({ id: "acc-401k", name: "401(k)", openingBalanceCents: 1000000 });

function seed(data) {
  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  // The `assignments` key existing is what stops the day-one seed inventing
  // funding rows out of any ledger seeded below.
  if (!("assignments" in data)) localStorage.setItem("assignments", JSON.stringify([]));
}

const read = (period = PERIOD) =>
  renderHook(() => useNetWorth(period), { wrapper: AppProviders }).result.current;

beforeEach(() => {
  localStorage.clear();
});

test("an on-budget account is derived from the ledger where no statement was entered", () => {
  seed({
    accounts: [EVERYDAY],
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc-cash",
        budgetId: null,
        amountCents: 50000,
        date: `${PERIOD}-04`,
      },
    ],
  });

  const { current } = read();
  expect(current.cashCents).toBe(150000);
  expect(current.netCents).toBe(150000);
});

test("a statement answers for its own month and hands the rest back to the ledger", () => {
  seed({
    accounts: [EVERYDAY],
    accountBalances: [
      { id: "bal1", accountId: "acc-cash", period: PERIOD, amountCents: 220000 },
    ],
  });

  // The month it was read for: the statement wins, because it catches what the
  // books missed.
  expect(read(PERIOD).current.cashCents).toBe(220000);
  // Not the month after. Carrying it forward would freeze the account at
  // August's figure and hide every transaction logged since — the ledger can
  // answer for September, and does.
  expect(read(AFTER).current.cashCents).toBe(200000);
  expect(read(BEFORE).current.cashCents).toBe(200000);
});

test("the gap between a statement and the books is reported rather than resolved", () => {
  seed({
    accounts: [EVERYDAY],
    accountBalances: [
      { id: "bal1", accountId: "acc-cash", period: PERIOD, amountCents: 220000 },
    ],
  });

  const [row] = read().rows;
  // Both answers survive: the difference is what a reconciliation is for, and
  // the pages put it beside the figure rather than picking a winner silently.
  expect(row.valueCents).toBe(220000);
  expect(row.derivedCents).toBe(200000);
  expect(row.driftCents).toBe(20000);
});

test("a hand-valued holding has no drift, because there is nothing to differ from", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  // Its "derived" figure is the opening balance and nothing more, so a
  // difference from it would say nothing about the books being wrong.
  expect(read().rows[0].driftCents).toBeNull();
});

test("an off-budget holding takes its snapshot, and carries it forward but never back", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  // Before the snapshot, the opening balance — not the figure from the future.
  expect(read(BEFORE).current.investedCents).toBe(1000000);
  expect(read(PERIOD).current.investedCents).toBe(1250000);
  // And after it, until the next one is entered. That is what makes updating
  // once a month enough.
  expect(read(AFTER).current.investedCents).toBe(1250000);
});

test("a restated opening balance, dated later, outranks an older snapshot", () => {
  const stale = addMonths(PERIOD, -6);
  seed({
    // The account was opened long ago with a stale snapshot on file — then its
    // opening balance was edited to restate what it is worth now, dated to
    // the current month, the way a user correcting a starting balance would.
    accounts: [{ ...BROKERAGE, openingBalanceCents: 1400000, openingDate: `${PERIOD}-01` }],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: stale, amountCents: 900000 }],
  });

  // The restated opening is the newer fact and wins, not the six-month-old
  // snapshot underneath it.
  expect(read(PERIOD).current.investedCents).toBe(1400000);
  const [row] = read(PERIOD).rows;
  expect(row.hand).toBe(true);
  expect(row.asOf).toBe(PERIOD);

  // Before the restated date, the old snapshot is still the newest fact on
  // file and answers as before — restating later does not rewrite history.
  expect(read(stale).current.investedCents).toBe(900000);
});

test("the chart series draws a straight line between two real snapshots, unlike the exact one", () => {
  const from = addMonths(PERIOD, -6);
  const mid = addMonths(PERIOD, -3);
  seed({
    accounts: [BROKERAGE],
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: from, amountCents: 1100000 },
      { id: "bal2", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 },
    ],
  });

  const { series, chartSeries } = read();
  const exact = series.find((entry) => entry.period === mid);
  const smoothed = chartSeries.find((entry) => entry.period === mid);

  // The exact figure — what `current`, `rows` and `driftCents` all read — steps
  // flat at the first snapshot until the next one lands three months later.
  expect(exact.investedCents).toBe(1100000);
  // The chart's own reading is partway between the two, not stepped, halfway
  // across a six-month gap.
  expect(smoothed.investedCents).toBe(1175000);
  // The bands still add back up to the net on the smoothed side too.
  expect(smoothed.assetsCents - smoothed.debtCents).toBe(smoothed.netCents);
});

test("the chart reads the ledger for a spend-through account, never the reconciled snapshot", () => {
  seed({
    accounts: [EVERYDAY],
    accountBalances: [
      { id: "bal1", accountId: "acc-cash", period: PERIOD, amountCents: 220000 },
    ],
  });

  // The exact figure still shows the reconciliation, same as `current` above.
  const exact = read().series.find((entry) => entry.period === PERIOD);
  expect(exact.cashCents).toBe(220000);

  // The chart draws the ledger's own figure instead — a statement that
  // disagrees with the books for one month is drift to report, not a real
  // dip-and-recover in what the account held.
  const smoothed = read().chartSeries.find((entry) => entry.period === PERIOD);
  expect(smoothed.cashCents).toBe(200000);
  expect(smoothed.values[SPENDING_SLICE]).toBe(200000);
});

test("the chart ramp is weighted toward when a savings-bucket transfer left the spending accounts", () => {
  const from = addMonths(PERIOD, -6);
  const transferMonth = addMonths(PERIOD, -5);
  const quietMonth = addMonths(PERIOD, -4);

  seed({
    accounts: [EVERYDAY, BROKERAGE],
    budgets: [{ id: "b-invest", name: "Investing", bucket: PLAN_BUCKETS.SAVINGS }],
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: from, amountCents: 1000000 },
      { id: "bal2", accountId: "acc-401k", period: PERIOD, amountCents: 1500000 },
    ],
    // A $5,000 lump moved from checking into "Investing" a month into the gap
    // — the whole rise between the two snapshots, in one transaction.
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc-cash",
        budgetId: "b-invest",
        amountCents: 500000,
        date: `${transferMonth}-15`,
      },
    ],
  });

  const { chartSeries } = read();
  const valueAt = (period) => chartSeries.find((entry) => entry.period === period).values["acc-401k"];

  // The rise lands right after the transfer, not dribbled evenly across the
  // six-month gap the way an unweighted ramp would (which would put it at
  // roughly 1,083,333 one month in).
  expect(valueAt(transferMonth)).toBe(1500000);
  // And it stays there — there is no further savings-bucket spend in the gap
  // to weight a later rise toward before the next real snapshot.
  expect(valueAt(quietMonth)).toBe(1500000);
});

test("the retirement bucket weights the ramp the same way the savings bucket does", () => {
  // The two buckets answer different questions about what the money is *for*,
  // but both name a transfer out of a spending account on its way to a
  // holding — the one signal this heuristic needs, so a retirement-bucket
  // outflow has to move the ramp exactly as a savings-bucket one does.
  const from = addMonths(PERIOD, -6);
  const transferMonth = addMonths(PERIOD, -5);
  const quietMonth = addMonths(PERIOD, -4);

  seed({
    accounts: [EVERYDAY, BROKERAGE],
    budgets: [{ id: "b-retire", name: "401(k) top-up", bucket: PLAN_BUCKETS.RETIREMENT }],
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: from, amountCents: 1000000 },
      { id: "bal2", accountId: "acc-401k", period: PERIOD, amountCents: 1500000 },
    ],
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc-cash",
        budgetId: "b-retire",
        amountCents: 500000,
        date: `${transferMonth}-15`,
      },
    ],
  });

  const { chartSeries } = read();
  const valueAt = (period) => chartSeries.find((entry) => entry.period === period).values["acc-401k"];

  expect(valueAt(transferMonth)).toBe(1500000);
  expect(valueAt(quietMonth)).toBe(1500000);
});

test("the chart series still carries forward, never back, outside a bracketed gap", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  // Before the only snapshot, there is nothing on the far side of the gap to
  // draw a line to, so the chart reads the same opening balance the exact
  // figure does.
  const chartBefore = read(BEFORE).chartSeries;
  expect(chartBefore.find((entry) => entry.period === BEFORE).investedCents).toBe(1000000);
  // After it, the same carry-forward the exact figure already does — smoothing
  // only bridges a gap with a real snapshot on both sides.
  const chartAfter = read(AFTER).chartSeries;
  expect(chartAfter.find((entry) => entry.period === AFTER).investedCents).toBe(1250000);
});

test("a liability subtracts, and is reported as the positive amount owed", () => {
  seed({
    accounts: [
      EVERYDAY,
      account({
        id: "acc-mortgage",
        name: "Mortgage",
        type: "liability",
        assetClass: "Other",
        openingBalanceCents: -30000000,
      }),
    ],
  });

  const { current } = read();
  expect(current.debtCents).toBe(30000000);
  expect(current.assetsCents).toBe(200000);
  expect(current.netCents).toBe(-29800000);
});

test("the bands split the accounts by what kind of money they are", () => {
  expect(holdingClass(account({ assetClass: "Cash" }))).toBe(HOLDING_CLASSES.CASH);
  expect(holdingClass(account({ assetClass: "Bonds" }))).toBe(HOLDING_CLASSES.INVESTED);
  expect(holdingClass(account({ assetClass: "Real estate" }))).toBe(HOLDING_CLASSES.PROPERTY);
  // A debt is a debt whatever it bought, so the asset class is not consulted.
  expect(holdingClass(account({ type: "liability", assetClass: "Cash" }))).toBe(
    HOLDING_CLASSES.DEBT
  );
});

test("the bands always add back up to the net, so the chart's stack matches its line", () => {
  seed({
    accounts: [
      EVERYDAY,
      BROKERAGE,
      account({ id: "acc-house", name: "House", assetClass: "Real estate", openingBalanceCents: 45000000 }),
      account({
        id: "acc-card",
        name: "Card",
        type: "liability",
        scope: "on-budget",
        assetClass: "Other",
        openingBalanceCents: -80000,
      }),
    ],
  });

  for (const entry of read().series) {
    expect(entry.cashCents + entry.investedCents + entry.propertyCents).toBe(entry.assetsCents);
    expect(entry.assetsCents - entry.debtCents).toBe(entry.netCents);
  }
});

test("the window is twelve months ending at the period by default", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [
      { id: "bal1", accountId: "acc-401k", period: addMonths(PERIOD, -6), amountCents: 1100000 },
      { id: "bal2", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 },
    ],
  });

  const result = read();
  expect(result.series).toHaveLength(12);
  expect(result.series[0].period).toBe(addMonths(PERIOD, -11));
  expect(result.series[11].period).toBe(PERIOD);
  expect(result.windowStartPeriod).toBe(addMonths(PERIOD, -11));
});

test("a longer window is the same months, further back", () => {
  seed({ accounts: [BROKERAGE] });

  const result = renderHook(() => useNetWorth(PERIOD, { months: 120 }), {
    wrapper: AppProviders,
  }).result.current;

  expect(result.series).toHaveLength(120);
  expect(result.series[0].period).toBe(addMonths(PERIOD, -119));
  expect(result.series[119].period).toBe(PERIOD);
});

test("the change is offered over several spans, each measured from a named month", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  const changes = Object.fromEntries(read().changes.map((entry) => [entry.key, entry]));

  // Year to date measures from the close of the old year, not from January's
  // close — which would silently drop January out of the year.
  expect(changes.ytd.fromPeriod).toBe("2025-12");
  expect(changes["1m"].fromPeriod).toBe(addMonths(PERIOD, -1));
  expect(changes["1y"].fromPeriod).toBe(addMonths(PERIOD, -12));
  // Reaching well outside the chart window, which is the point of computing
  // these independently of it.
  expect(changes["10y"].fromPeriod).toBe(addMonths(PERIOD, -120));

  // $10,000 of opening balance a year ago against $12,500 snapshotted now.
  expect(changes["1y"].fromCents).toBe(1000000);
  expect(changes["1y"].changeCents).toBe(250000);
  expect(changes["1y"].changeBps).toBe(2500);
});

test("a spanKey sizes the window the same way it measures the change, and an explicit months wins over it", () => {
  seed({
    accounts: [BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  const withSpan = (spanKey) =>
    renderHook(() => useNetWorth(PERIOD, { spanKey }), { wrapper: AppProviders }).result.current;

  expect(withSpan("3m").series).toHaveLength(3);
  expect(withSpan("3m").windowStartPeriod).toBe(addMonths(PERIOD, -2));
  expect(withSpan("6m").series).toHaveLength(6);
  // August is the 8th month, so year-to-date is eight columns: January through
  // the month on screen.
  expect(withSpan("ytd").series).toHaveLength(8);
  expect(withSpan("ytd").windowStartPeriod).toBe(`${PERIOD.slice(0, 4)}-01`);

  // An explicit `months` still overrides whatever the span would have picked —
  // the numeric option is not removed, only given a default it can beat.
  const explicit = renderHook(() => useNetWorth(PERIOD, { spanKey: "3m", months: 5 }), {
    wrapper: AppProviders,
  }).result.current;
  expect(explicit.series).toHaveLength(5);
});

test("\"all\" reaches back to the first month anything is known about the books, on both sides of the pairing", () => {
  seed({
    accounts: [BROKERAGE],
    // The earliest fact on file is the account's own opening, well outside any
    // fixed span — which is the whole point of "all" over "10y".
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  const result = renderHook(() => useNetWorth(PERIOD, { spanKey: "all" }), {
    wrapper: AppProviders,
  }).result.current;

  // BROKERAGE opens with `openingDate: null` from the shared fixture, so the
  // earliest known fact is the balance snapshot itself: nothing to reach
  // further back for, so the window is one column.
  expect(result.firstPeriod).toBe(PERIOD);
  expect(result.series).toHaveLength(1);
  const changes = Object.fromEntries(result.changes.map((entry) => [entry.key, entry]));
  expect(changes.all.fromPeriod).toBe(PERIOD);
});

test("\"all\" reads an account's own opening as the start of the books, capped at the same ceiling as \"10y\"", () => {
  seed({
    accounts: [{ ...BROKERAGE, openingDate: `${addMonths(PERIOD, -200)}-01` }],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  const result = renderHook(() => useNetWorth(PERIOD, { spanKey: "all" }), {
    wrapper: AppProviders,
  }).result.current;

  expect(result.firstPeriod).toBe(addMonths(PERIOD, -200));
  // A hundred and twenty columns is where a month stops being resolvable at
  // the chart's width — the same ceiling "10y" already sits at.
  expect(result.series).toHaveLength(120);
  const changes = Object.fromEntries(result.changes.map((entry) => [entry.key, entry]));
  expect(changes.all.fromPeriod).toBe(addMonths(PERIOD, -200));
});

test("\"all\" on a file with no history at all falls back to the month on screen rather than dividing by zero", () => {
  seed({ accounts: [] });

  const result = renderHook(() => useNetWorth(PERIOD, { spanKey: "all" }), {
    wrapper: AppProviders,
  }).result.current;

  expect(result.firstPeriod).toBeNull();
  expect(result.series).toHaveLength(1);
  const changes = Object.fromEntries(result.changes.map((entry) => [entry.key, entry]));
  expect(changes.all.fromPeriod).toBe(PERIOD);
});

test("a percentage is refused where the base cannot carry one", () => {
  expect(percentChangeBps(1000000, 1250000)).toBe(2500);
  // A debt shrinking is *up*, because the household is better off — the sign
  // means the same here as everywhere else on the page.
  expect(percentChangeBps(-2000000, -1500000)).toBe(2500);
  // Nothing to be a share of.
  expect(percentChangeBps(0, 500000)).toBeNull();
  // Across zero. "Up 200%" would describe a household that stopped being
  // underwater as though it had multiplied what it had.
  expect(percentChangeBps(-1000000, 1000000)).toBeNull();
  // Landing exactly on zero is still a real share of the base: the hole is gone.
  expect(percentChangeBps(-1000000, 0)).toBe(10000);
});

test("the chart's series are the hand-valued accounts, with everything spent through as one", () => {
  seed({
    accounts: [
      EVERYDAY,
      account({
        id: "acc-card",
        name: "Card",
        type: "liability",
        scope: "credit-card",
        assetClass: "Other",
        openingBalanceCents: -80000,
      }),
      BROKERAGE,
      account({
        id: "acc-house",
        name: "House",
        assetClass: "Real estate",
        openingBalanceCents: 45000000,
      }),
      account({
        id: "acc-mortgage",
        name: "Mortgage",
        type: "liability",
        assetClass: "Real estate",
        openingBalanceCents: -30000000,
      }),
    ],
  });

  const { slices, current } = read();

  // One band for the accounts the budget spends through — a current account and
  // a card are working capital passing through, not holdings — then every
  // hand-valued account on its own, grouped by band, cash outward to debt.
  expect(slices.map((slice) => slice.label)).toEqual([
    "Spending accounts",
    "401(k)",
    "House",
    "Mortgage",
  ]);
  expect(slices[0].key).toBe(SPENDING_SLICE);
  expect(slices[1].key).toBe("acc-401k");

  // The spending band is those accounts netted: the cash less what is on the
  // card, which is what there is to spend.
  expect(current.values[SPENDING_SLICE]).toBe(120000);
  expect(current.values["acc-mortgage"]).toBe(-30000000);
});

test("the slices always add back up to the net, so the chart's stack matches its line", () => {
  seed({
    accounts: [
      EVERYDAY,
      BROKERAGE,
      account({
        id: "acc-mortgage",
        name: "Mortgage",
        type: "liability",
        assetClass: "Real estate",
        openingBalanceCents: -30000000,
      }),
    ],
  });

  const { series, slices } = read();
  for (const entry of series) {
    const stacked = slices.reduce((sum, slice) => sum + entry.values[slice.key], 0);
    expect(stacked).toBe(entry.netCents);
  }
});

test("the monthly pass covers every account, but only a holding can fall behind", () => {
  seed({
    accounts: [EVERYDAY, BROKERAGE],
    accountBalances: [{ id: "bal1", accountId: "acc-401k", period: PERIOD, amountCents: 1250000 }],
  });

  const { tracked } = read(BEFORE);
  // Every account is offered — a month's snapshot is a record of the whole
  // position, and the everyday accounts are half of it.
  expect(tracked.map((row) => row.account.id)).toEqual(["acc-cash", "acc-401k"]);

  const [cash, brokerage] = tracked;
  // The everyday account is not *waiting* on a figure: with none entered the
  // books answer, so flagging it every month would cry wolf.
  expect(cash.needsUpdate).toBe(false);
  expect(brokerage.needsUpdate).toBe(true);

  // Stepping back to July must not make a holding updated in August read as
  // never having been updated.
  expect(brokerage.lastUpdated).toBe(PERIOD);
  expect(brokerage.updatedThisPeriod).toBe(false);
  // While the value shown for July is still July's — the snapshot does not
  // carry backwards.
  expect(brokerage.valueCents).toBe(1000000);
});

test("a zero snapshot is a balance, not a missing one", () => {
  seed({
    accounts: [account({ id: "acc-card", name: "Card", type: "liability", openingBalanceCents: -50000 })],
    accountBalances: [{ id: "bal1", accountId: "acc-card", period: PERIOD, amountCents: 0 }],
  });

  // The card was paid off. Falling back to the opening balance here would keep
  // reporting a debt the user has cleared.
  expect(read(PERIOD).current.debtCents).toBe(0);
  expect(read(BEFORE).current.debtCents).toBe(50000);
});
