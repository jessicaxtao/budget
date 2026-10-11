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
 * A **transfer** is the one record that moves two balances, and the one the two
 * cuts read most differently: here both of its halves are always real, while the
 * envelope cut sees a transfer between two accounts the budget spends through as
 * nothing at all. That is what lets a credit card be paid off — the card's balance
 * rises by what checking loses, and no envelope is asked to fund the payment
 * twice. See `budgetLegs` in TransactionsContext.
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
  const entryFor = (accountId) => {
    let entry = movement.get(accountId);
    if (!entry) {
      entry = { inflowCents: 0, outflowCents: 0 };
      movement.set(accountId, entry);
    }
    return entry;
  };

  for (const transaction of transactions) {
    const transactionPeriod = toPeriod(transaction.date);
    if (transactionPeriod != null && !periodLTE(transactionPeriod, period)) continue;

    // **The one record that moves two balances.** Money left one account and
    // arrived in another, so this is the cut where both halves are real — and it
    // is the only cut where they are, since between two accounts the budget spends
    // through nothing has been earned or spent at all. Each side is credited only
    // if it still exists: a transfer whose holding was deleted still leaves the
    // account it left, on the same rule as any other detached record below.
    if (transaction.kind === TRANSACTION_KINDS.TRANSFER) {
      if (transaction.accountId != null) {
        entryFor(transaction.accountId).outflowCents += transaction.amountCents;
      }
      if (transaction.toAccountId != null) {
        entryFor(transaction.toAccountId).inflowCents += transaction.amountCents;
      }
      continue;
    }

    // Cut loose from a deleted account. The money is still in the envelope
    // maths; there is simply no account left to show it against.
    if (transaction.accountId == null) continue;

    const entry = entryFor(transaction.accountId);
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

/**
 * What one account held **after each row that moved it** — the running balance
 * a chequebook stub carries down its right-hand column.
 *
 * In the same file as `accountBalancesAt` and not beside the register, because
 * the two are one definition read at two resolutions: this walks the movements in
 * order and that one sums them to a month end, so **the figure on the last row of
 * a month is the figure `accountBalancesAt` reports for that month**. Written
 * anywhere else it would be a second reading of what an account holds, free to
 * drift from the one shown on the balance sheet, which is the disagreement the
 * "derived, never stored" rule exists to prevent. `useAccountBalances.test.js`
 * asserts the two agree at every month boundary.
 *
 * **The order is the books' own, not the screen's.** Undated rows first — they
 * count in every period's carried-in figure, so they are already inside whatever
 * the account held when the first dated row landed — then by date, ties broken by
 * the order they were logged in. The register draws newest first; that is a
 * reading order and must not change what a row's balance *is*. Which is also why
 * this is computed over the **whole ledger for the account** rather than over the
 * rows on screen: a running balance that counted only the rows a filter left
 * behind would be a number that matches nothing — not the statement, not the
 * balance sheet, not itself a month later.
 *
 * The opening balance takes its place in that order rather than being added to
 * the front, so an account opened in March does not lend its opening figure to a
 * row dated February — the same rule `accountBalancesAt` keeps when it counts the
 * opening only once the month it was opened in has arrived.
 *
 * Signed throughout, like the rest of this file: a card's balance goes more
 * negative as it is spent on, and the row says so.
 */
export function runningBalances(account, transactions) {
  if (!account) return new Map();

  // What this account's balance does for one record: nothing, where the record
  // does not name it. A transfer is the one that can be either side, and the
  // `continue`-free shape here is deliberately the same case analysis
  // `accountBalancesAt` makes above.
  const movementOf = (transaction) => {
    if (transaction.kind === TRANSACTION_KINDS.TRANSFER) {
      if (transaction.accountId === account.id) return -transaction.amountCents;
      if (transaction.toAccountId === account.id) return transaction.amountCents;
      return null;
    }
    if (transaction.accountId !== account.id) return null;
    return transaction.kind === TRANSACTION_KINDS.INFLOW
      ? transaction.amountCents
      : -transaction.amountCents;
  };

  const steps = [];
  // The opening, as a movement of its own at the date it happened. Index -1 so
  // it comes before anything logged on the same day: money cannot have moved
  // through an account before it held its opening figure.
  steps.push({ id: null, at: account.openingDate ?? "", index: -1, cents: account.openingBalanceCents ?? 0 });

  transactions.forEach((transaction, index) => {
    const cents = movementOf(transaction);
    if (cents == null) return;
    steps.push({ id: transaction.id, at: transaction.date ?? "", index, cents });
  });

  steps.sort((a, b) => a.at.localeCompare(b.at) || a.index - b.index);

  const balances = new Map();
  let running = 0;
  for (const step of steps) {
    running += step.cents;
    if (step.id != null) balances.set(step.id, running);
  }
  return balances;
}

export default function useAccountBalances(period) {
  const { accounts } = useAccounts();
  const { transactions } = useTransactions();

  return useMemo(
    () => accountBalancesAt(accounts, transactions, period),
    [accounts, transactions, period]
  );
}
