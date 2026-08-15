import { useMemo } from "react";
import {
  ACCOUNT_TYPES,
  isOffBudget,
  spendsThroughBudget,
  useAccounts,
} from "../contexts/AccountsContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { periodLTE, toPeriod } from "../utils";

/**
 * What each account actually holds, at the end of a period.
 *
 *   balance(a, P) = opening(a) + Σ inflows to a − Σ outflows from a, through P
 *
 * The balance-sheet counterpart to useEnvelopes: the same ledger, cut by the
 * account the money sat in rather than by the category it was for. Every dollar
 * appears in both cuts, which is the point — the envelopes say what the money is
 * *for*, this says where it *is*, and a plan the accounts cannot fund is one the
 * user needs to see.
 *
 * Derived, never stored. That is what separates it from `balances` in
 * AccountsContext, which is a figure the user types in for an off-budget holding
 * whose worth no ledger can know — a 401(k) moves with the market, not with
 * anything recorded here. An on-budget account never needs that: it is the sum
 * of what went through it, and a hand-entered figure beside it could only
 * disagree.
 *
 * Undated openings and undated transactions count in every period, on the same
 * rule as everywhere else; future-dated ones are excluded until their month
 * arrives, so stepping back a month shows what the account held then.
 */

/**
 * The derivation itself, as a plain function of the two stores.
 *
 * Pulled out of the hook so `useNetWorth` can run it once per month across a
 * whole chart window without calling a hook in a loop. It stays the *only*
 * definition of what an account holds — a second one written for the chart would
 * be free to drift from the figure shown beside it on Configuration, which is
 * exactly the disagreement the "derived, never stored" rule above exists to
 * prevent.
 */
export function accountBalancesAt(accounts, transactions, period) {
  const movement = new Map();

  for (const transaction of transactions) {
    // Cut loose from a deleted account. The money is still in the envelope
    // maths; there is simply no account left to show it against.
    if (transaction.accountId == null) continue;

    const transactionPeriod = toPeriod(transaction.date);
    if (transactionPeriod != null && !periodLTE(transactionPeriod, period)) continue;

    let entry = movement.get(transaction.accountId);
    if (!entry) {
      entry = { inflowCents: 0, outflowCents: 0 };
      movement.set(transaction.accountId, entry);
    }

    if (transaction.kind === TRANSACTION_KINDS.INFLOW) {
      entry.inflowCents += transaction.amountCents;
    } else {
      entry.outflowCents += transaction.amountCents;
    }
  }

  const rows = accounts.map((account) => {
    const { inflowCents, outflowCents } = movement.get(account.id) ?? {
      inflowCents: 0,
      outflowCents: 0,
    };
    const openingCents = account.openingBalanceCents ?? 0;
    const openedIn = toPeriod(account.openingDate);
    // An account opened next month holds nothing this month — but its
    // transactions, if any were dated earlier, still do.
    const counted = openedIn == null || periodLTE(openedIn, period) ? openingCents : 0;

    return {
      account,
      openingCents: counted,
      inflowCents,
      outflowCents,
      balanceCents: counted + inflowCents - outflowCents,
    };
  });

  // Signed throughout, so a debt subtracts rather than needing every caller to
  // remember which way round it goes. `owedCents` is reported positive because
  // that is how a statement reads it.
  const sum = (predicate) =>
    rows.reduce((total, row) => (predicate(row) ? total + row.balanceCents : total), 0);

  return {
    period,
    rows,
    netCents: sum(() => true),
    // Cards count here, net of what is owed on them: the budget spends through
    // them, so what there is to spend is the cash minus the card balance.
    onBudgetCents: sum((row) => spendsThroughBudget(row.account)),
    offBudgetCents: sum((row) => isOffBudget(row.account)),
    ownedCents: sum((row) => row.account.type !== ACCOUNT_TYPES.LIABILITY),
    owedCents: -sum((row) => row.account.type === ACCOUNT_TYPES.LIABILITY),
  };
}

export default function useAccountBalances(period) {
  const { accounts } = useAccounts();
  const { transactions } = useTransactions();

  return useMemo(
    () => accountBalancesAt(accounts, transactions, period),
    [accounts, transactions, period]
  );
}
