import { useMemo } from "react";
import { useAccounts, isOffBudget } from "../contexts/AccountsContext";
import { useAssignments } from "../contexts/AssignmentsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";
import { periodLTE, toPeriod } from "../utils";

/**
 * Every figure the envelope view needs, for one period.
 *
 * One of two places that read across stores — the other is useAccountBalances,
 * which answers the balance-sheet question this one deliberately does not.
 * Each context references the others by id and never reads them back, which is
 * what keeps the provider graph acyclic; the moment derived maths moves into a
 * provider, that stops being true. See src/contexts/AppProviders.js.
 *
 *   activity(b, p)  = refunded(b,p) − spent(b,p)
 *   available(b, P) = Σ over p ≤ P of [ assigned(b,p) + activity(b,p) ]
 *   carriedIn(b, P) = the same sum over p < P
 *   toBeAssigned(P) = opening(P) + Σ over p ≤ P of [ income(p) − Σ over b of assigned(b,p) ]
 *
 * so that, at every period:
 *
 *   toBeAssigned + Σ available === opening + cumulative inflow − cumulative spend
 *
 * which is cash on hand. That identity is the tripwire the tests assert after
 * every mutation. It holds only if the row set below covers *every* budgetId
 * that appears anywhere — including ids with no matching budget record — and
 * if both sides use the same period filter. Filtering what the grid displays
 * is fine; filtering what these sums cover is not.
 *
 * **An inflow with a category is a refund, not income.** Money paid back into a
 * category — a friend's half of dinner, a returned jacket — was already assigned
 * once on its way out, so it returns to the envelope it left rather than to the
 * pool. That is why `income(p)` above counts only the inflows with no category
 * on them, while `cumulative inflow` in the identity counts every one: the
 * refund reaches the same cash total by the other route, through `activity`.
 * Counting it in both places is the one mistake here that would silently create
 * money, and it is exactly what the tripwire catches.
 *
 * `opening` is the starting balance of the **on-budget** accounts, and it is
 * the reason a household can spend on day one instead of waiting for a
 * paycheque to land. It is money the user already had, so it goes into the pool
 * exactly as income does — but it is reported separately rather than folded
 * into `cumIncomeCents`, because "income in August" is a figure the user checks
 * against their payslips and an account opening is not part of it. Off-budget
 * accounts are excluded: a 401(k) is not money to assign to groceries.
 *
 * Undated records (date: null, from the migration that introduced dates) count
 * in every period's cumulative sums, so money never disappears from the books
 * just because its date was never recorded. On a row they fold into carriedIn
 * and never into this month's activity, so the figures displayed on a row always
 * add up to the balance displayed beside them. Future-dated records are excluded
 * until their month arrives.
 */
export default function useEnvelopes(period) {
  const { budgets } = useBudgets();
  const { transactions } = useTransactions();
  const { assignments } = useAssignments();
  const { accounts } = useAccounts();

  return useMemo(() => {
    // budgetId -> { before, current } in cents, for each of spend, refund and
    // assigned.
    const tally = new Map();
    const bucket = (budgetId) => {
      let entry = tally.get(budgetId);
      if (!entry) {
        entry = {
          spentBefore: 0,
          spentNow: 0,
          refundBefore: 0,
          refundNow: 0,
          assignedBefore: 0,
          assignedNow: 0,
        };
        tally.set(budgetId, entry);
      }
      return entry;
    };

    let periodIncomeCents = 0;
    let cumIncomeCents = 0;
    // What the pool has ever been given, which is what "to be assigned" is built
    // from. Separate from `cumIncomeCents` — that one is cash on hand and counts
    // every inflow, while a refund reaches the same total through its envelope
    // instead. Adding a refund to both is the one mistake here that would create
    // money out of nothing.
    let cumPoolIncomeCents = 0;

    for (const transaction of transactions) {
      const transactionPeriod = toPeriod(transaction.date);
      const inflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
      const counted = transactionPeriod == null || periodLTE(transactionPeriod, period);
      if (inflow && counted) cumIncomeCents += transaction.amountCents;

      // Income: an inflow naming no category. It is the only kind of inflow the
      // pool ever sees.
      if (inflow && transaction.budgetId == null) {
        if (transactionPeriod === period) periodIncomeCents += transaction.amountCents;
        if (counted) cumPoolIncomeCents += transaction.amountCents;
        continue;
      }

      const entry = bucket(transaction.budgetId ?? UNCATEGORIZED_BUDGET_ID);
      const field = inflow ? "refund" : "spent";
      if (transactionPeriod === period) entry[`${field}Now`] += transaction.amountCents;
      // Undated movement already happened, so it belongs behind us rather than
      // in this month's column.
      else if (transactionPeriod == null || periodLTE(transactionPeriod, period)) {
        entry[`${field}Before`] += transaction.amountCents;
      }
    }

    // What the on-budget accounts held before any of this was logged. Undated
    // openings count from the beginning of the books, on the same rule as an
    // undated transaction.
    let openingCents = 0;
    for (const account of accounts) {
      if (isOffBudget(account)) continue;
      const openedIn = toPeriod(account.openingDate);
      if (openedIn == null || periodLTE(openedIn, period)) {
        openingCents += account.openingBalanceCents ?? 0;
      }
    }

    for (const assignment of assignments) {
      const entry = bucket(assignment.budgetId);
      if (assignment.period === period) entry.assignedNow += assignment.assignedCents;
      else if (periodLTE(assignment.period, period)) {
        entry.assignedBefore += assignment.assignedCents;
      }
    }

    const budgetsById = new Map(budgets.map((budget) => [budget.id, budget]));
    // The union, not `budgets`: an id with spend but no budget record still
    // holds real money, and dropping it from the sum breaks the identity above.
    const ids = new Set([
      ...budgets.map((budget) => budget.id),
      UNCATEGORIZED_BUDGET_ID,
      ...tally.keys(),
    ]);

    const rows = [...ids].map((budgetId) => {
      const entry = tally.get(budgetId) ?? {
        spentBefore: 0,
        spentNow: 0,
        refundBefore: 0,
        refundNow: 0,
        assignedBefore: 0,
        assignedNow: 0,
      };
      // Signed: what the month did to the envelope, which is what came back
      // less what went out.
      const activityCents = entry.refundNow - entry.spentNow;
      const carriedInCents = entry.assignedBefore + entry.refundBefore - entry.spentBefore;
      const budget = budgetsById.get(budgetId);
      const kind = budget
        ? "category"
        : budgetId === UNCATEGORIZED_BUDGET_ID
        ? "uncategorized"
        : "orphan";

      return {
        budgetId,
        kind,
        name: budget?.name ?? (kind === "uncategorized" ? "Uncategorized" : "Unknown category"),
        carriedInCents,
        assignedCents: entry.assignedNow,
        // Gross, both of them, for anything that wants to say "spent" or
        // "refunded" as a quantity. `activityCents` is the net of the two and is
        // what the balance is built from.
        spentCents: entry.spentNow,
        refundCents: entry.refundNow,
        activityCents,
        availableCents: carriedInCents + entry.assignedNow + activityCents,
        // The standing estimate from Configuration, which is the same figure in
        // every period — it says what this category is expected to need in a
        // month, not what one particular month was planned at.
        plannedCents: budget?.plannedCents ?? 0,
        // The balance this category is saving towards, or null for one that is
        // not saving towards anything — which is most of them, and which the
        // catch-all rows never are. Null rather than zero all the way through:
        // "no goal" has to stay tellable from "a goal already met".
        goalCents: budget?.goalCents ?? null,
      };
    });

    // Configured categories first, in the order the user arranged them on the
    // Configuration page, then the catch-alls. Sort order is presentation only
    // — the sums cover every row.
    const order = { category: 0, uncategorized: 1, orphan: 2 };
    const positionById = new Map(budgets.map((budget, index) => [budget.id, index]));
    rows.sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        (positionById.get(a.budgetId) ?? 0) - (positionById.get(b.budgetId) ?? 0)
    );

    const totals = rows.reduce(
      (sum, row) => ({
        carriedIn: sum.carriedIn + row.carriedInCents,
        periodAssigned: sum.periodAssigned + row.assignedCents,
        available: sum.available + row.availableCents,
        spent: sum.spent + row.spentCents,
        refund: sum.refund + row.refundCents,
        activity: sum.activity + row.activityCents,
      }),
      { carriedIn: 0, periodAssigned: 0, available: 0, spent: 0, refund: 0, activity: 0 }
    );

    const assignedThroughCents = [...tally.values()].reduce(
      (sum, entry) => sum + entry.assignedBefore + entry.assignedNow,
      0
    );
    // Gross, and it has to be: the identity's other side counts *every* inflow
    // as cash, refunds included, so netting them off here as well would subtract
    // them twice.
    const cumSpentCents = [...tally.values()].reduce(
      (sum, entry) => sum + entry.spentBefore + entry.spentNow,
      0
    );

    return {
      period,
      rows,
      toBeAssignedCents: openingCents + cumPoolIncomeCents - assignedThroughCents,
      totalAvailableCents: totals.available,
      totalCarriedInCents: totals.carriedIn,
      periodIncomeCents,
      periodAssignedCents: totals.periodAssigned,
      periodSpentCents: totals.spent,
      periodRefundCents: totals.refund,
      periodActivityCents: totals.activity,
      openingCents,
      cumIncomeCents,
      cumSpentCents,
    };
  }, [budgets, transactions, assignments, accounts, period]);
}
