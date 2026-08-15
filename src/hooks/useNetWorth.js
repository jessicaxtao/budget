import { useMemo } from "react";
import {
  ACCOUNT_TYPES,
  isOffBudget,
  spendsThroughBudget,
  useAccounts,
} from "../contexts/AccountsContext";
import { PLAN_BUCKETS, useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { accountBalancesAt } from "./useAccountBalances";
import { addMonths, formatCents, formatPeriod, periodLTE, toPeriod } from "../utils";

/**
 * What the household is worth, month by month, split by what kind of money it is.
 *
 * The third of the five hooks that read across stores, and the one that joins the app's two
 * ways of knowing what an account holds: the ledger's arithmetic, and the figure
 * the user read off a statement. **Every account can carry both.** A month's
 * snapshot is what that account was worth at the end of that month, whoever it
 * belongs to — that is what makes a once-a-month pass over the statements a real
 * record of a household's position, and what lets years that predate the books be
 * entered at all.
 *
 * The two are not symmetrical, though, and the asymmetry is the whole design:
 *
 *   off budget    → snapshot at or before P, else the derived balance
 *                   — it **carries forward**, because nothing else can answer
 *   spent through → snapshot for P *exactly*, else the derived balance
 *                   — it **never carries**, because the ledger can answer
 *
 * A 401(k) is worth whatever the market says this morning, which no ledger here
 * can know, so May's figure is the best answer available in June and July. An
 * everyday account is different: its balance is the opening figure plus
 * everything that moved through it, and that arithmetic is live. A statement read
 * in May is the better answer *for May* — it catches what the books missed, and
 * it is the only answer at all for a month before the books opened — but letting
 * it stand in for June would freeze the account at May's figure and hide every
 * transaction logged since. So it answers for its own month and hands back.
 *
 * Where both answers exist, `driftCents` is the difference. It is not an error to
 * be resolved here: it is the gap between the books and the bank, which is
 * exactly what a reconciliation is for, and the pages that show it say so.
 *
 * **Snapshots never carry back.** A holding last valued in May is worth May's
 * figure in June, but in April it is worth its opening balance. Propagating the
 * earliest figure backwards would draw a flat line across years nobody recorded
 * and present it as history.
 *
 *   net(P) = Σ over every account of value(a, P)          ← signed
 *
 * so a liability subtracts, exactly as it does in `useAccountBalances` — one sign
 * convention across the whole balance sheet, settled at the boundary in
 * `signedOpeningCents` rather than at each call site.
 *
 * None of this reaches the budget. `useEnvelopes` and `useAccountBalances` read
 * the ledger and the opening balances alone, so a snapshot can never move money
 * between envelopes or into "to be assigned" — it states what an account was
 * worth, not what the household may spend.
 *
 * **`series` is exact and `chartSeries` is smoothed, and every figure but the
 * chart and its table twin reads the exact one.** A holding valued in January
 * and not touched again until June is, in `series`, January's figure held flat
 * for four months and then a jump — a true record of what was actually entered,
 * which is what `current`, `changes`, `rows`, `tracked` and `driftCents` all
 * need: whether a holding is stale, and what it is worth *right now*, are
 * questions about the real snapshots, not a guess at the months between them.
 * `chartSeries` answers a different question — what the shape of this account
 * probably was — by drawing a line between the two real snapshots that bracket
 * a gap, bent toward the months a savings- or retirement-bucket outflow
 * suggests the money actually moved rather than spread evenly across every
 * month in between. See
 * `interpolatedOffBudgetCents` and `smoothedEntry`.
 *
 * `chartSeries` also reads a spend-through account differently: it always
 * takes the ledger's own figure, never a snapshot entered for it. That
 * account has no gap to smooth — the books answer for every month — so a
 * statement that disagrees with them is drift, not new information about the
 * shape of the account, and belongs on `driftCents` rather than as a spike
 * the chart draws and un-draws a month later.
 */

/**
 * The three kinds of money, plus what is owed.
 *
 * Coarser than `ASSET_CLASSES` on purpose. The asset class describes *one
 * account* precisely enough to report an allocation from; this describes what a
 * reader wants separated on a chart, and at that level stocks and bonds are one
 * answer to "how much of this is invested". Four bands is also the point at which
 * a stacked chart stops being readable — see the palette note in
 * `tailwind.config.js`, where these four are validated against each other.
 */
export const HOLDING_CLASSES = {
  CASH: "cash",
  INVESTED: "invested",
  PROPERTY: "property",
  DEBT: "debt",
};

// Every asset class lands in exactly one band, and the mapping is total: a class
// added to `ASSET_CLASSES` without a line here falls to `property`, which is the
// band that already means "owned, and neither of the other two".
const BAND_BY_ASSET_CLASS = {
  Cash: HOLDING_CLASSES.CASH,
  Stocks: HOLDING_CLASSES.INVESTED,
  Bonds: HOLDING_CLASSES.INVESTED,
  Alternatives: HOLDING_CLASSES.INVESTED,
  "Real estate": HOLDING_CLASSES.PROPERTY,
  Other: HOLDING_CLASSES.PROPERTY,
};

/** Which band an account's value lands in. A debt is a debt whatever it bought. */
export function holdingClass(account) {
  if (account.type === ACCOUNT_TYPES.LIABILITY) return HOLDING_CLASSES.DEBT;
  return BAND_BY_ASSET_CLASS[account.assetClass] ?? HOLDING_CLASSES.PROPERTY;
}

/**
 * Stacking order, baseline outward: the most liquid band against the fixed edge,
 * the one that barely moves at the far end, and what is owed on the other side of
 * zero. Also the order the bands are reported in everywhere else on the page, so
 * the chart, its legend and its table twin cannot disagree about it.
 */
const BAND_ORDER = [
  HOLDING_CLASSES.CASH,
  HOLDING_CLASSES.INVESTED,
  HOLDING_CLASSES.PROPERTY,
  HOLDING_CLASSES.DEBT,
];

/**
 * The one series on the chart that is not a single account: every account the
 * budget spends through, added up.
 *
 * The chart is read to answer "which of my holdings moved", and the answer is
 * always one of the ones valued by hand — a 401(k), a brokerage, the house, the
 * mortgage. The everyday accounts are the wrong grain for that question: a
 * current account, a savings account and two cards are four thin bands that
 * change places with each other as the month is spent, and none of them is a
 * *holding* so much as working capital passing through. So they get one band
 * between them, and the account-by-account cut of them is the register.
 */
export const SPENDING_SLICE = "spending";

/**
 * The chart's series, in stacking order — one per hand-valued account, plus the
 * spending accounts as a single band.
 *
 * Derived from the accounts alone, never from a month's figures, which is what
 * makes it stable: a stack ordered by size would reshuffle every time two
 * holdings crossed, and the reader would read the reshuffle as movement. Within
 * a band the order is the order the accounts were added, for the same reason.
 *
 * `accounts` on a slice is what it is made of, so a caller that has to sum,
 * describe or link to the underlying records never has to re-derive which
 * accounts fell where.
 */
export function buildSlices(accounts) {
  const spending = accounts.filter(spendsThroughBudget);

  const held = accounts
    .filter(isOffBudget)
    .map((account, order) => ({
      key: account.id,
      label: account.name,
      band: holdingClass(account),
      account,
      accounts: [account],
      order,
    }))
    .sort(
      (a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || a.order - b.order
    );

  if (spending.length === 0) return held;

  return [
    {
      key: SPENDING_SLICE,
      label: "Spending accounts",
      // The cash band, and first inside it: these are the accounts the household
      // actually spends out of, so they are both the most cash-like thing on the
      // chart and the one band that moves every week. The band that moves goes
      // against the fixed edge.
      band: HOLDING_CLASSES.CASH,
      account: null,
      accounts: spending,
      order: -1,
    },
    ...held,
  ];
}

/**
 * accountId -> its snapshots, oldest first.
 *
 * Built once and walked per period rather than filtered per (account, period),
 * which is the difference between one pass over the balances and one per cell of
 * a twelve-month chart. Rows whose period is not a real "YYYY-MM" are dropped
 * here: they could never be found by a `periodLTE` lookup anyway, and leaving
 * them in would put a value in the sort that orders nowhere.
 *
 * Exported with `snapshotAt` because the backfill grid asks the same question the
 * chart does — what was this holding worth going into the window — and a second
 * definition of "the figure in force" could drift from the one the chart draws.
 */
export function indexSnapshots(balances) {
  const byAccount = new Map();
  for (const balance of balances) {
    if (toPeriod(balance.period) == null) continue;
    let list = byAccount.get(balance.accountId);
    if (!list) {
      list = [];
      byAccount.set(balance.accountId, list);
    }
    list.push(balance);
  }
  for (const list of byAccount.values()) list.sort((a, b) => (a.period < b.period ? -1 : 1));
  return byAccount;
}

/** The latest snapshot at or before `period`, or null before the first one. */
export function snapshotAt(index, accountId, period) {
  const list = index.get(accountId);
  if (!list) return null;

  let found = null;
  for (const balance of list) {
    if (!periodLTE(balance.period, period)) break;
    found = balance;
  }
  return found;
}

/** The snapshot for `period` itself, or null. What an account the budget spends
 *  through reads, since for those a figure only speaks for its own month. */
export function snapshotFor(index, accountId, period) {
  return index.get(accountId)?.find((balance) => balance.period === period) ?? null;
}

/** Which of the two answers an account takes at `period`, by the rule above. */
function snapshotInForce(index, account, period) {
  return isOffBudget(account)
    ? snapshotAt(index, account.id, period)
    : snapshotFor(index, account.id, period);
}

/**
 * Where a row's figure came from, said plainly — the last column of the holdings
 * table, and the line under each field in the update form.
 *
 * One definition rather than two, because the two screens are read against each
 * other: a figure described as carried forward in one and as current in the other
 * is worse than either description alone. `stale` marks a figure that is older
 * than the month it is being shown for, which is the only reason to distrust one.
 */
export function describeSource(row, period) {
  if (!row.hand) {
    return spendsThroughBudget(row.account)
      ? { text: "From the ledger", stale: false }
      : { text: "Never valued", stale: true };
  }
  if (row.asOf !== period) return { text: `Carried from ${formatPeriod(row.asOf)}`, stale: true };
  // A statement for a month the ledger also covers. Agreeing is worth saying —
  // it is a reconciliation — and so is the gap when they do not.
  if (row.driftCents != null && row.driftCents !== 0) {
    return { text: `Entered · ${formatCents(row.driftCents)} vs ledger`, stale: false };
  }
  return { text: "Updated this month", stale: false };
}

const emptyBands = () => ({ cash: 0, invested: 0, property: 0, debt: 0 });

/**
 * Roll a set of rows up into the bands and the chart's per-slice values.
 *
 * Pulled out of `holdingsAt` so the chart-smoothing pass below can re-total a
 * row set with off-budget figures swapped for interpolated ones without a
 * second, drifting definition of what a band or a slice adds up to.
 */
function aggregateRows(rows) {
  const bands = emptyBands();
  // What each of the chart's series is worth this month, keyed the way
  // `buildSlices` keys them. Signed throughout: a slice is drawn on whichever
  // side of the baseline its own figure puts it, so a spending group whose cards
  // outweigh its cash draws down rather than being quietly counted as an asset.
  const values = { [SPENDING_SLICE]: 0 };
  for (const row of rows) {
    bands[row.band] += row.valueCents;
    values[row.account.id] = row.valueCents;
    if (spendsThroughBudget(row.account)) values[SPENDING_SLICE] += row.valueCents;
  }

  return {
    values,
    cashCents: bands.cash,
    investedCents: bands.invested,
    propertyCents: bands.property,
    // A magnitude, matching `owedCents` in useAccountBalances and the way a
    // statement reads. Zero is written out rather than negated, because `-0` is
    // a real value in JavaScript and would travel from here into every
    // comparison and sum downstream.
    debtCents: bands.debt === 0 ? 0 : -bands.debt,
    assetsCents: bands.cash + bands.invested + bands.property,
    netCents: bands.cash + bands.invested + bands.property + bands.debt,
  };
}

/**
 * What every account is worth at `period`, and the bands those roll up into.
 *
 * `debtCents` is reported as a positive magnitude, matching `owedCents` in
 * `useAccountBalances` and the way a statement reads; `netCents` is the signed
 * sum, so it is assets minus debt without any caller re-deriving the sign.
 */
function holdingsAt(accounts, transactions, snapshots, period) {
  const derived = new Map(
    accountBalancesAt(accounts, transactions, period).rows.map((row) => [
      row.account.id,
      row.balanceCents,
    ])
  );

  const rows = accounts.map((account) => {
    const snapshot = snapshotInForce(snapshots, account, period);
    const derivedCents = derived.get(account.id) ?? 0;
    return {
      account,
      band: holdingClass(account),
      valueCents: snapshot ? snapshot.amountCents : derivedCents,
      // Both answers, kept side by side. The books' figure is worth carrying even
      // when a statement supersedes it: their difference is the reconciliation.
      derivedCents,
      // Only where both are real answers for the same month. An off-budget
      // holding's "derived" figure is its opening balance and nothing more, so a
      // difference from it means nothing and is not reported as drift.
      driftCents:
        snapshot && spendsThroughBudget(account) ? snapshot.amountCents - derivedCents : null,
      // Where the figure came from, which the pages have to be able to say out
      // loud: a hand-entered snapshot goes stale and a derived balance cannot,
      // so only one of the two is worth putting a date beside.
      hand: snapshot != null,
      asOf: snapshot?.period ?? null,
    };
  });

  return { period, rows, ...aggregateRows(rows) };
}

/** Whole months from period `a` to period `b`, signed — `monthsBetween("2026-01",
 *  "2026-06") === 5`. Real integer month arithmetic off the "YYYY-MM" strings
 *  rather than a date subtraction, so it can never land on a fraction. */
function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Both buckets name money leaving a spending account on its way toward a
// holding rather than being spent — the split between "generic savings" and
// "retirement" is a question of what the money is *for*, which this signal
// does not need answered.
const TRANSFER_BUCKETS = new Set([PLAN_BUCKETS.SAVINGS, PLAN_BUCKETS.RETIREMENT]);

/**
 * period -> cents spent that month from a spending account into a category
 * filed under the **savings** or **retirement** bucket — money that left the
 * books' live arithmetic on its way toward some holding, whichever one.
 *
 * This is the only signal available for *when*, inside a gap between two
 * off-budget snapshots, the money actually moved: nothing in the ledger names
 * the off-budget account a transfer was headed for (there is no transfer
 * record in this app — an outflow only names a category), so a transfer-bucket
 * outflow is a proxy, not a fact. It is shared across every off-budget
 * holding rather than attributed to one, for the same reason. Built once per
 * render and walked by period, the same shape as `indexSnapshots`.
 */
function indexSavingsSpend(transactions, budgets) {
  const bucketOf = new Map(budgets.map((budget) => [budget.id, budget.bucket]));
  const byPeriod = new Map();
  for (const transaction of transactions) {
    if (transaction.kind !== TRANSACTION_KINDS.OUTFLOW) continue;
    if (!TRANSFER_BUCKETS.has(bucketOf.get(transaction.budgetId))) continue;
    const period = toPeriod(transaction.date);
    if (period == null) continue;
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + transaction.amountCents);
  }
  return byPeriod;
}

/** Savings-bucket spend in the months after `fromExclusive` and at or before
 *  `toInclusive` — walked month by month rather than summed over the whole
 *  map, since a gap between two snapshots is usually a handful of months and
 *  never the app's whole history. */
function savingsSpendBetween(savingsByPeriod, fromExclusive, toInclusive) {
  let sum = 0;
  for (
    let p = addMonths(fromExclusive, 1);
    periodLTE(p, toInclusive);
    p = addMonths(p, 1)
  ) {
    sum += savingsByPeriod.get(p) ?? 0;
  }
  return sum;
}

/**
 * An off-budget holding's value at `period`, for the chart only: a line
 * between the two real snapshots that bracket it, rather than the flat step
 * `holdingsAt` draws. A holding entered in January and not touched again
 * until June currently shows January's figure flat through May and jumps at
 * June — a staircase that makes it look like nothing happened for four months
 * and then everything happened at once.
 *
 * **The line is bent toward where the money actually moved, not drawn
 * straight.** An even, month-by-month ramp is the right guess when a holding
 * simply grew — but when most of the rise between two snapshots was a lump
 * transfer out of a spending account (a house down payment routed through a
 * "Savings" category, say), an even ramp under-credits the holding for
 * however long the gap runs, and the total net worth line reads as though
 * that money briefly went missing before "catching up" — the account it was
 * really always in just hadn't been revalued yet. Weighting the ramp by
 * `indexSavingsSpend`'s figures moves the credit to roughly when the transfer
 * happened instead of spreading it evenly across months that may have seen no
 * transfer at all. **Only a proxy** — it cannot tell a transfer bound for
 * *this* holding from one bound for another, or from money that was actually
 * spent and simply miscategorised — so where the gap holds no savings- or
 * retirement-bucket spend at all (the whole change was market movement, most
 * gaps), it falls back to the even, month-by-month ramp exactly as before.
 *
 * Bridges **only real data** — where a `next` snapshot exists to draw
 * toward. Before the first snapshot or after the last, there is nothing on
 * the far side of the gap, so the same fallback `holdingsAt` already uses
 * stands: the opening balance before, the last figure carried flat after.
 * That is the "carry forward, never back" rule this hook documents, and this
 * function narrows it rather than replacing it.
 *
 * The figure this returns never reaches `rows`, `tracked`, `driftCents`, or
 * `needsUpdate` — everywhere a snapshot's exact, real-entered value is what
 * the page is asking about (has this been reconciled, is it stale) keeps
 * reading `holdingsAt`'s own figure. Only the chart, and its table twin, read
 * a smoothed line.
 */
function interpolatedOffBudgetCents(snapshots, savingsByPeriod, account, period, exactCents) {
  const list = snapshots.get(account.id);
  if (!list || list.length === 0) return exactCents;

  let prev = null;
  let next = null;
  for (const balance of list) {
    if (periodLTE(balance.period, period)) prev = balance;
    else {
      next = balance;
      break;
    }
  }
  if (!prev || !next || prev.period === next.period) return prev?.amountCents ?? exactCents;

  const totalDelta = next.amountCents - prev.amountCents;
  const totalWeight = savingsSpendBetween(savingsByPeriod, prev.period, next.period);
  // With no savings-bucket spend recorded anywhere in the gap, there is
  // nothing to bend the line toward — an even ramp across the months is the
  // only guess left, exactly the one drawn before this weighting existed.
  const t =
    totalWeight > 0
      ? savingsSpendBetween(savingsByPeriod, prev.period, period) / totalWeight
      : monthsBetween(prev.period, period) / monthsBetween(prev.period, next.period);

  return Math.round(prev.amountCents + totalDelta * t);
}

/** A `holdingsAt` entry re-read for the chart: every off-budget row's figure
 *  smoothed toward the next real snapshot, every spend-through row read off
 *  the ledger regardless of a snapshot, and the bands and slice values
 *  re-totalled from that — the chart and its table twin's own reading of a
 *  month, kept beside but never mixed into the exact one everything else on
 *  the page reads.
 *
 *  A spend-through account has a real, continuous answer for *every* month —
 *  the ledger's own arithmetic — so there is no gap for it to bridge the way
 *  an off-budget holding has between snapshots. A statement entered for one
 *  month there is a reconciliation, not new information about the months
 *  around it, and reading it into the chart draws a spike on the month it
 *  was entered and a cliff on the month after, which is not a shape the
 *  account's value actually took — the money did not leave and come back,
 *  the books were merely off by that much. That gap is real and stays real —
 *  `driftCents` still reports it, on `rows` and on `HoldingsTable` — the
 *  chart just is not where it belongs. */
function smoothedEntry(entry, snapshots, savingsByPeriod) {
  const rows = entry.rows.map((row) => {
    if (!isOffBudget(row.account)) {
      return row.valueCents === row.derivedCents
        ? row
        : { ...row, valueCents: row.derivedCents };
    }
    const valueCents = interpolatedOffBudgetCents(
      snapshots,
      savingsByPeriod,
      row.account,
      entry.period,
      row.valueCents
    );
    return valueCents === row.valueCents ? row : { ...row, valueCents };
  });

  return { ...entry, rows, ...aggregateRows(rows) };
}

/**
 * The spans a net-worth change is worth quoting over, and what each measures
 * from.
 *
 * Deliberately not tied to the chart window: how far back the picture reaches
 * and how far back the headline measures are two different questions, and a
 * reader looking at a year of detail may still want the decade's figure beside
 * it. Every one of them names the month it measures from on screen, because "up
 * 8%" is only a fact once the reader knows 8% of what.
 *
 * Year to date measures from **December of the previous year** rather than from
 * January, because a year-to-date change is the movement since the books closed
 * on the old year — measuring from January's close would silently drop January.
 */
export const CHANGE_RANGES = [
  { key: "1m", label: "1M", name: "1 month", from: (period) => addMonths(period, -1) },
  {
    key: "ytd",
    label: "YTD",
    name: "year to date",
    from: (period) => addMonths(period, -Number(period.slice(5, 7))),
  },
  { key: "1y", label: "1Y", name: "12 months", from: (period) => addMonths(period, -12) },
  { key: "5y", label: "5Y", name: "5 years", from: (period) => addMonths(period, -60) },
  { key: "10y", label: "10Y", name: "10 years", from: (period) => addMonths(period, -120) },
];

export const DEFAULT_CHANGE_RANGE = "1y";

/**
 * The change as a share of what was there before, in basis points — or `null`
 * where a share says nothing.
 *
 * Two bases have no honest percentage. **Zero** has no size to be a share of.
 * And a base on the *other side of zero* from where the household ended up makes
 * the ratio meaningless: −$10,000 to $10,000 is not "up 200%", it is a household
 * that stopped being underwater, and no percentage carries that. Both cases
 * return null and the page prints a dash, exactly as it does for any other
 * figure it does not have — the dollar change is shown either way, so nothing is
 * lost by refusing to make one up.
 *
 * Where both are the same side of zero the denominator is the **magnitude** of
 * the base, so a household $20,000 in the hole climbing to $15,000 in the hole
 * reads as +25%: up, because it is better off, which is what a positive change
 * means everywhere else on this page.
 *
 * Basis points rather than a float, on the same discipline as every other rate
 * in the app.
 */
export function percentChangeBps(fromCents, toCents) {
  if (fromCents === 0) return null;
  if (Math.sign(fromCents) * Math.sign(toCents) < 0) return null;
  return Math.round(((toCents - fromCents) / Math.abs(fromCents)) * 10000);
}

/**
 * `months` of history ending at `period`, inclusive.
 *
 * Twelve by default, which is the window that makes a year-on-year change
 * readable off the chart itself rather than only off a figure beside it.
 */
export default function useNetWorth(period, { months = 12 } = {}) {
  const { accounts, balances } = useAccounts();
  const { transactions } = useTransactions();
  const { budgets } = useBudgets();

  return useMemo(() => {
    const snapshots = indexSnapshots(balances);
    const savingsByPeriod = indexSavingsSpend(transactions, budgets);

    const series = [];
    for (let back = months - 1; back >= 0; back -= 1) {
      series.push(holdingsAt(accounts, transactions, snapshots, addMonths(period, -back)));
    }

    // The chart's own reading of the same months: off-budget holdings smoothed
    // between real snapshots instead of stepped. `current`, `changes` and every
    // other figure below reads `series`, the exact one — smoothing is for the
    // line the eye follows across a window, not for a number anything is
    // measured against.
    const chartSeries = series.map((entry) => smoothedEntry(entry, snapshots, savingsByPeriod));

    const current = series[series.length - 1];
    const first = series[0];

    // Net worth at any month, reusing the window where the window already covers
    // it. A reference month usually sits outside the chart — the ten-year figure
    // beside a one-year picture is the whole point of separating them — so the
    // fallback is a derivation of its own. `??` rather than `||`: a household
    // worth exactly nothing that month is an answer, not a miss.
    const inWindow = new Map(series.map((entry) => [entry.period, entry.netCents]));
    const netAt = (at) =>
      inWindow.get(at) ?? holdingsAt(accounts, transactions, snapshots, at).netCents;

    const changes = CHANGE_RANGES.map((range) => {
      const fromPeriod = range.from(period);
      const fromCents = netAt(fromPeriod);
      return {
        key: range.key,
        label: range.label,
        name: range.name,
        fromPeriod,
        fromCents,
        changeCents: current.netCents - fromCents,
        changeBps: percentChangeBps(fromCents, current.netCents),
      };
    });

    // The list the "first of the month" pass walks: **every account**, because a
    // month's snapshot is a record of the whole position and the everyday
    // accounts are half of it. What differs between them is what a blank means —
    // an off-budget holding falls back to the figure it was last given, an
    // everyday account falls back to the books — which is what `needsUpdate`
    // reports and what the forms say beside each field.
    const tracked = current.rows.map((row) => {
      // The account's own latest snapshot, not the one in force at `period` —
      // stepping back to March must not make a holding updated in August look
      // as though it were last touched in February.
      const history = snapshots.get(row.account.id);
      return {
        account: row.account,
        band: row.band,
        valueCents: row.valueCents,
        derivedCents: row.derivedCents,
        driftCents: row.driftCents,
        hand: row.hand,
        asOf: row.asOf,
        lastUpdated: history ? history[history.length - 1].period : null,
        updatedThisPeriod: row.asOf === current.period,
        // Only a hand-valued holding can go stale. An account the budget spends
        // through is answered by the ledger the moment no figure is entered for
        // it, so it is never *waiting* on one — asking for it every month anyway
        // would cry wolf about the accounts that are already right.
        needsUpdate: isOffBudget(row.account) && row.asOf !== current.period,
      };
    });

    return {
      period,
      series,
      // The same months, smoothed for the chart and its table twin — see
      // `smoothedEntry`. Everything else in this return value reads `series`.
      chartSeries,
      // The chart's series definitions, stable across the window: one per
      // hand-valued account and one for the spending accounts between them.
      slices: buildSlices(accounts),
      current,
      rows: current.rows,
      tracked,
      changes,
      // The left edge of the chart, which is what its axis and its caption say.
      windowStartPeriod: first.period,
      // Whether there is a shape to plot at all, as opposed to one figure
      // repeated across the window because nothing has ever been recorded.
      hasHistory: series.some((entry) => entry.netCents !== current.netCents),
    };
  }, [accounts, balances, transactions, budgets, period, months]);
}
