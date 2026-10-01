import { spendsThroughBudget } from "./contexts/AccountsContext";
import { TRANSACTION_KINDS } from "./contexts/TransactionsContext";

/**
 * What a ledger record does to the *budget*, as distinct from what it does to
 * an account.
 *
 * For an inflow or an outflow the answer is its own kind — unless it moved
 * through an **off-budget** account. Then it is `null`: a house bought out of
 * the savings account it was set aside in is real spending (the report counts
 * it), but that money left the budget when it was set aside, so it comes out of
 * no envelope now. A record with no account at all — legacy, or detached by an
 * account delete — stays in the budget, as it always has.
 *
 * A transfer moves money between two accounts, and whether that touches the
 * budget at all depends on which side of the budget each account sits on:
 *
 *   on-budget  → on-budget    none      checking → savings, paying the card
 *   on-budget  → off-budget   outflow   checking → 401(k): money leaves the budget
 *   off-budget → on-budget    inflow    brokerage → checking: money enters it
 *   off-budget → off-budget   none      a rollover between two holdings
 *
 * **A transfer is never spending and never income**, whichever way it reads
 * here: money set aside is money the household still has, and it is spent only
 * when it is spent. So the envelope maths keeps a transfer's effect apart from
 * `spent` and `refund` (`movedOut` / `movedIn`), and the spending report leaves
 * transfers out altogether. One that crosses with a category moves that
 * envelope; one with none moves "to be assigned".
 *
 * Cards count as on-budget, as they do everywhere (`spendsThroughBudget`): a
 * card payment is a neutral transfer, because every purchase on the card was
 * already charged to its category when it was made.
 *
 * Cross-store, so it lives here rather than in TransactionsContext, which wraps
 * AccountsProvider and may not read it. Pure, so every hook that reads the
 * ledger asks the same question the same way. The scopes are read **live**:
 * moving an account off budget restates the transfers into it, exactly as it
 * already restates that account's opening balance in "to be assigned".
 *
 * **A leg whose account is gone** — detached by an account delete, or never
 * known — counts as outside the budget. An account that no longer exists is
 * not one the budget spends through, which is the same reason its opening
 * balance has already left "to be assigned". Reading it any other way breaks
 * the books: delete a card that checking paid $500 towards, and its −$500
 * opening leaves the pool (+$500) while checking is still $500 lighter, so the
 * payment has to start counting as $500 leaving the budget or the envelopes
 * hold $500 more than the accounts do. With no category on it, it comes out of
 * "to be assigned".
 *
 * @returns TRANSACTION_KINDS.INFLOW, TRANSACTION_KINDS.OUTFLOW, or `null` for a
 *   record with no effect on the budget.
 */
export function budgetSide(transaction, accountsById) {
  if (transaction.kind !== TRANSACTION_KINDS.TRANSFER) {
    const account = accountsById.get(transaction.accountId);
    return account && !spendsThroughBudget(account) ? null : transaction.kind;
  }

  const fromInside = insideBudget(accountsById.get(transaction.accountId));
  const toInside = insideBudget(accountsById.get(transaction.toAccountId));

  if (fromInside === toInside) return null;
  return fromInside ? TRANSACTION_KINDS.OUTFLOW : TRANSACTION_KINDS.INFLOW;
}

function insideBudget(account) {
  return Boolean(account) && spendsThroughBudget(account);
}

/**
 * Money the household *earned*: an inflow naming no category.
 *
 * Deliberately a question about the record's kind and not about its budget
 * side. Money brought in from an off-budget account lands in the pool just as a
 * paycheque does — it is there to assign — but it is the household's own money
 * changing places, and counting it as income would inflate the savings rate by
 * whatever was pulled out of a brokerage.
 */
export function isIncome(transaction) {
  return transaction.kind === TRANSACTION_KINDS.INFLOW && transaction.budgetId == null;
}

/** Accounts by id, the lookup `budgetSide` takes. */
export function indexAccounts(accounts) {
  return new Map(accounts.map((account) => [account.id, account]));
}
