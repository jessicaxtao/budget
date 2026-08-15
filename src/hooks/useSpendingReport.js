import { useMemo } from "react";
import {
  PLAN_BUCKET_LABELS,
  PLAN_BUCKET_ORDER,
  useBudgets,
} from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { toSections } from "../planLayout";
import { addMonths, periodLTE, toPeriod } from "../utils";

/**
 * What the books did over a **window of months** — where the money went, how
 * much came in, and what was left.
 *
 * The fifth hook that reads across stores, and the only one whose subject is a
 * span rather than an instant. Every other view answers a question about one
 * period: what is in the envelopes *now* (`useEnvelopes`), what the accounts
 * hold *at* P (`useAccountBalances`, `useNetWorth`). A report is the other
 * question — what has been happening — and it cannot be answered a month at a
 * time, because the whole point of it is that one month is not evidence.
 *
 * It reads the ledger and the plan's arrangement, and **nothing else**. Not
 * assignments: what was put into an envelope is a decision, and a report is
 * about what actually happened. Not account balances: a report of spending is
 * indifferent to which account it left from. Not the opening balances, for the
 * same reason `useEnvelopes` keeps them out of income — money the household
 * already had is not money it earned this year.
 *
 * ## The three quantities, and why there are three rather than two
 *
 *   spent(b, p)     = outflows naming b, in p                   ← gross, ≥ 0
 *   refunded(b, p)  = inflows naming b, in p                    ← gross, ≥ 0
 *   netSpent(b, p)  = spent − refunded                          ← what it cost
 *   income(p)       = inflows naming no category, in p
 *
 * The refund rule is the store's, unchanged: **an inflow with a category is
 * money coming back to that category, and an inflow without one is income.**
 * Spend $100 on dinner and be paid $60 by the friends who ate it and the
 * household spent $40 on dinner — not $100 of dinner and $60 of earnings. So a
 * refund nets off the category it names and never reaches income. Getting this
 * wrong does not merely misfile a row; it inflates both halves of the headline
 * at once, which is the one error a savings rate cannot survive.
 *
 * That gives the identity this hook is checked against:
 *
 *   netCents = Σ income − Σ netSpent = Σ inflows − Σ outflows      ← over the window
 *
 * The right-hand side is cash actually moved. It holds because every inflow is
 * counted exactly once — as income or as a refund — and refunds are subtracted
 * from spending rather than added to income. Both routes reach the same total,
 * which is what makes "net saved" a fact about the bank rather than a figure
 * assembled from two different books.
 *
 * ## What is left out, and said out loud
 *
 * **Undated records belong to no month, so they are in no report.** `useEnvelopes`
 * folds them into every cumulative sum, because a balance has to account for
 * every dollar whether or not anyone wrote down when it moved. A report is the
 * opposite shape: its axis *is* the month, and putting an undated record in one
 * would be inventing the history the migration deliberately refused to invent.
 * They are counted instead, and the page says how many — money that is missing
 * from a chart has to be visible as missing.
 *
 * **A month outside the window is outside the window**, including a future-dated
 * record beyond the end month. Nothing accumulates from before the start: this
 * is a report of a span, not a balance at the end of one.
 */

/**
 * The spans a report is read over.
 *
 * Months rather than a pair of dates, because every figure in this app is filed
 * by month and a range that cut a month in half would report a rent payment in
 * whichever half it landed. Each one is inclusive of both ends.
 *
 * "All" is the only one that needs to know anything about the ledger, which is
 * why every `start` takes the first month on the books as well as the end month
 * — a signature the other four ignore.
 */
export const REPORT_RANGES = [
  { key: "3m", label: "3M", name: "the last 3 months", start: (end) => addMonths(end, -2) },
  { key: "6m", label: "6M", name: "the last 6 months", start: (end) => addMonths(end, -5) },
  { key: "12m", label: "1Y", name: "the last 12 months", start: (end) => addMonths(end, -11) },
  {
    key: "ytd",
    label: "YTD",
    name: "the year to date",
    // January of the end month's own year — the year so far, not the last
    // twelve months, which is what the range beside it already is.
    start: (end) => `${end.slice(0, 4)}-01`,
  },
  {
    key: "all",
    label: "ALL",
    name: "every month on the books",
    start: (end, first) => first ?? end,
  },
];

export const DEFAULT_REPORT_RANGE = "12m";

/**
 * The ceiling on "all", in months.
 *
 * Ten years, matching the net-worth chart's longest span and for the same
 * reason: past a hundred and twenty columns a month stops being resolvable at
 * the width these cards get, and a household that has kept books for thirty
 * years would otherwise get a plot of three hundred and sixty hairlines.
 */
const MAX_WINDOW_MONTHS = 120;

/**
 * The months a range resolves to, oldest first and always ending at `endPeriod`.
 *
 * Every path is guarded back to a window of at least the end month itself: a
 * range that resolved to a start after its end — "all" on a ledger holding only
 * future-dated records, a hand-edited period — would otherwise produce an empty
 * month list, and every figure downstream would divide by it.
 */
function windowFor(endPeriod, rangeKey, firstPeriod) {
  const range =
    REPORT_RANGES.find((entry) => entry.key === rangeKey) ??
    REPORT_RANGES.find((entry) => entry.key === DEFAULT_REPORT_RANGE);

  let start = range.start(endPeriod, firstPeriod);
  if (!periodLTE(start, endPeriod)) start = endPeriod;

  const floor = addMonths(endPeriod, -(MAX_WINDOW_MONTHS - 1));
  if (periodLTE(start, floor)) start = floor;

  const months = [];
  for (let period = start; periodLTE(period, endPeriod); period = addMonths(period, 1)) {
    months.push(period);
  }
  return { range, months };
}

/**
 * `part` as a share of `whole`, in basis points — or null where a share says
 * nothing.
 *
 * A whole of zero has no size to be a share of, and a negative whole (a window
 * whose refunds outweighed its spending) makes the ratio meaningless rather than
 * merely large. Both come back null and the page prints a dash, on the same
 * discipline as `percentChangeBps` in `useNetWorth`: the figure itself is always
 * shown beside the share, so refusing to invent one costs nothing.
 */
export function shareBps(part, whole) {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 10000);
}

const emptyCategory = (budgetId) => ({
  budgetId,
  spentCents: 0,
  refundCents: 0,
  // Which months this category moved money in, so the average below can be read
  // as the rate it is or the artefact it is not.
  months: new Set(),
});

/**
 * `useSpendingReport(endPeriod, rangeKey)`
 *
 * @param endPeriod the last month in the window, inclusive
 * @param rangeKey  one of `REPORT_RANGES`
 */
export default function useSpendingReport(endPeriod, rangeKey = DEFAULT_REPORT_RANGE) {
  const { groups, budgets } = useBudgets();
  const { transactions } = useTransactions();

  return useMemo(() => {
    // The first month anything was recorded in, which is what "all" reaches back
    // to and what the average below is honestly divisible by.
    let firstPeriod = null;
    for (const transaction of transactions) {
      const period = toPeriod(transaction.date);
      if (period != null && (firstPeriod == null || period < firstPeriod)) firstPeriod = period;
    }

    const { range, months } = windowFor(endPeriod, rangeKey, firstPeriod);
    const startPeriod = months[0];

    const byMonth = new Map(
      months.map((period) => [
        period,
        { period, incomeCents: 0, spentCents: 0, refundCents: 0 },
      ])
    );

    const byCategory = new Map();
    const categoryEntry = (budgetId) => {
      let entry = byCategory.get(budgetId);
      if (!entry) {
        entry = emptyCategory(budgetId);
        byCategory.set(budgetId, entry);
      }
      return entry;
    };

    // Money with no month to put it in. Counted rather than placed, and reported
    // so that a chart missing a figure says so instead of quietly disagreeing
    // with the register.
    let undatedCount = 0;
    let undatedSpentCents = 0;
    let undatedIncomeCents = 0;

    for (const transaction of transactions) {
      const period = toPeriod(transaction.date);
      const inflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
      const amountCents = transaction.amountCents;

      if (period == null) {
        undatedCount += 1;
        if (inflow && transaction.budgetId == null) undatedIncomeCents += amountCents;
        else undatedSpentCents += inflow ? -amountCents : amountCents;
        continue;
      }

      const month = byMonth.get(period);
      // Outside the window — earlier than the start, or dated past the end.
      // Neither accumulates into it: this is a report of a span.
      if (!month) continue;

      // Income is an inflow naming no category, and it is the only inflow the
      // household actually earned.
      if (inflow && transaction.budgetId == null) {
        month.incomeCents += amountCents;
        continue;
      }

      const entry = categoryEntry(transaction.budgetId ?? UNCATEGORIZED_BUDGET_ID);
      const field = inflow ? "refundCents" : "spentCents";
      month[field] += amountCents;
      entry[field] += amountCents;
      entry.months.add(period);
    }

    // How many months the per-month average is honestly divided by.
    //
    // **The window, clipped to where the books actually start** — not the number
    // of months the category itself was active in. Amortising is the whole point
    // of the figure: a $1,200 premium paid once reads as $100 a month, which is
    // what makes it comparable with the rent beside it, and dividing it by the
    // one month it was paid in would report it as $1,200 a month. But dividing
    // three months of records by twelve understates every category by four, and
    // silently, so the divisor stops at the first month on file and the page
    // prints what it was.
    const covered = months.filter((period) => firstPeriod == null || periodLTE(firstPeriod, period));
    const averagedOverMonths = Math.max(1, covered.length);
    const coverageStartPeriod = covered[0] ?? startPeriod;
    const perMonth = (cents) => Math.round(cents / averagedOverMonths);

    // Which heading and which bucket each category is filed under. Read off the
    // sections rather than the flat list, exactly as `usePlanHealth` does:
    // resolving what a category counts as needs its group beside it, and
    // `toSections` has already done that once.
    const filing = new Map();
    for (const section of toSections(groups, budgets)) {
      for (const budget of section.budgets) {
        filing.set(budget.id, {
          name: budget.name,
          groupName: section.name,
          bucket: budget.effectiveBucket,
          targetCents: budget.plannedCents,
        });
      }
    }

    const series = months.map((period) => {
      const month = byMonth.get(period);
      const netSpentCents = month.spentCents - month.refundCents;
      return {
        ...month,
        netSpentCents,
        // Signed, and it is cash: what came in less what went out, for this
        // month alone. Nothing carries forward — that is the balance's job.
        netCents: month.incomeCents - netSpentCents,
      };
    });

    const totalIncomeCents = series.reduce((sum, month) => sum + month.incomeCents, 0);
    const totalSpentCents = series.reduce((sum, month) => sum + month.spentCents, 0);
    const totalRefundCents = series.reduce((sum, month) => sum + month.refundCents, 0);
    const netSpentCents = totalSpentCents - totalRefundCents;

    // Every category that moved money in the window, biggest first.
    //
    // **Ranked rather than arranged**, which is the one place this table
    // deliberately parts company with the dashboard's. The plan's arrangement is
    // answered on the dashboard and on the plan itself; the question here is
    // where the money went, and that question has an order of its own. The group
    // each row is filed under travels on the row, so the arrangement is still
    // readable — it is just no longer the axis.
    //
    // A category with nothing against it is dropped, the same rule the dashboard
    // uses: a report of spending is not the place to list what was not spent.
    const rows = [...byCategory.values()]
      .map((entry) => {
        const filed = filing.get(entry.budgetId);
        const netCents = entry.spentCents - entry.refundCents;
        return {
          budgetId: entry.budgetId,
          kind: filed
            ? "category"
            : entry.budgetId === UNCATEGORIZED_BUDGET_ID
              ? "uncategorized"
              : "orphan",
          name:
            filed?.name ??
            (entry.budgetId === UNCATEGORIZED_BUDGET_ID ? "Uncategorized" : "Unknown category"),
          // Null rather than a placeholder heading: the catch-alls are filed
          // under nothing, and a dash is the truthful cell.
          groupName: filed?.groupName ?? null,
          bucket: filed?.bucket ?? null,
          spentCents: entry.spentCents,
          refundCents: entry.refundCents,
          netSpentCents: netCents,
          averageCents: perMonth(netCents),
          // The standing monthly estimate from the plan. Zero means nobody has
          // set one, which is not an estimate of nothing — null, and the table
          // draws it as a dash.
          targetCents: filed?.targetCents ? filed.targetCents : null,
          shareBps: shareBps(netCents, netSpentCents),
          monthsWithSpend: entry.months.size,
        };
      })
      .sort((a, b) => b.netSpentCents - a.netSpentCents);

    // What the spending split into, against what the plan says it should. The
    // plan's own split is on Configuration; this is the same four shares read
    // off the books instead of off the estimates, which is the comparison the
    // pair exists for.
    //
    // A category with no bucket — the Uncategorized sentinel, an id whose
    // category was deleted — cannot be filed under one, so it gets a fifth
    // segment rather than being dropped. The five have to add up to the total
    // or the split is describing a smaller household than the headline does.
    const bucketTotals = new Map(PLAN_BUCKET_ORDER.map((bucket) => [bucket, 0]));
    let unfiledCents = 0;
    for (const row of rows) {
      if (row.bucket != null && bucketTotals.has(row.bucket)) {
        bucketTotals.set(row.bucket, bucketTotals.get(row.bucket) + row.netSpentCents);
      } else unfiledCents += row.netSpentCents;
    }

    const buckets = [
      ...PLAN_BUCKET_ORDER.map((bucket) => ({
        bucket,
        label: PLAN_BUCKET_LABELS[bucket],
        netSpentCents: bucketTotals.get(bucket),
      })),
      { bucket: null, label: "No category", netSpentCents: unfiledCents },
    ]
      .filter((entry) => entry.netSpentCents !== 0)
      .map((entry) => ({
        ...entry,
        averageCents: perMonth(entry.netSpentCents),
        shareBps: shareBps(entry.netSpentCents, netSpentCents),
      }));

    return {
      range,
      months,
      startPeriod,
      endPeriod,
      series,

      rows,
      buckets,

      totalIncomeCents,
      totalSpentCents,
      totalRefundCents,
      netSpentCents,
      // The identity: income less what spending actually cost, which is also
      // every inflow less every outflow in the window.
      netCents: totalIncomeCents - netSpentCents,
      // Null on a window with no income — a savings rate needs something to be a
      // rate of, and a household with $2,000 of spending and no recorded pay has
      // not saved −∞ percent, it has a gap in its records.
      savingsRateBps: shareBps(totalIncomeCents - netSpentCents, totalIncomeCents),

      averagedOverMonths,
      coverageStartPeriod,
      averageIncomeCents: perMonth(totalIncomeCents),
      averageSpendCents: perMonth(netSpentCents),
      averageNetCents: perMonth(totalIncomeCents - netSpentCents),

      // Money the report cannot place. Reported so the page can say so out loud
      // rather than leaving the reader to find the gap against the register.
      undatedCount,
      undatedSpentCents,
      undatedIncomeCents,

      hasLedger: transactions.length > 0,
      firstPeriod,
    };
  }, [groups, budgets, transactions, endPeriod, rangeKey]);
}
