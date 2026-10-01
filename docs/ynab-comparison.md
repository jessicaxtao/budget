# What YNAB has that this app doesn't

A comparison of this codebase against YNAB's feature set as of October 2026.
The YNAB side is written from general knowledge of the product, not checked
against its current docs, so some details may have moved.

The core envelope model is already here: money assigned from a "to be
assigned" pool, balances that carry forward from month to month, refunds
credited back to their category, and credit-card spending that reduces what is
left to assign. What follows is what is missing, most important first.

## Core budgeting

1. **Transfers between accounts.** A transaction is only money in or money out
   (`TRANSACTION_KINDS` in `src/contexts/TransactionsContext.js`), and money out
   must name a category. Paying a credit card, or moving cash from checking to
   savings, can only be faked as an expense plus an income, which distorts
   spending and income. In YNAB a transfer between two budget accounts needs no
   category; one to an off-budget account takes one. *The biggest structural
   gap.* Plan: [`plans/transfers.md`](plans/transfers.md).
2. **Credit-card payment envelopes.** When you buy on a card, YNAB moves the
   money out of the spending category into a "Card payment" envelope, so the
   money for the bill is always set aside. Here the category is charged, but
   nothing tracks money set aside for the card bill. Depends on #1.
3. **Move money / cover overspending.** The store allows negative assignments,
   but no screen offers "move $X from Dining to Groceries" or "cover this
   overspent category from…". After assigning, this is YNAB's most-used action.
4. **Quick-assign shortcuts.** This app has "Fill" (top a category up to its
   estimate). YNAB also offers underfunded, assigned last month, spent last
   month, average spent and reset, for one category or all of them.
5. **Target types.** This app has a monthly estimate and an optional goal
   balance. YNAB targets add a due date and a rule ("$1,200 by December",
   "refill up to $X", "$X weekly", "monthly savings builder"), work out what each
   month still needs, and flag categories that are underfunded. The savings-goals
   page says linking, editing and removing goals are still to come.
6. **Overspending rules.** In YNAB, cash overspending is taken out of next
   month's "to be assigned" and the category resets to zero; card overspending
   becomes debt on the card. Here a negative balance carries forward in the
   category. That is defensible, but it is different.

## The register

7. **Bank import.** No direct bank connection, no OFX/QFX/CSV import, and no
   matching of imported entries against ones typed by hand. Everything is
   entered manually.
8. **Scheduled and recurring transactions.** None. The pay schedule predicts
   paydays but does not create entries.
9. **Split transactions.** One category per transaction, so a Costco trip
   covering groceries and household goods cannot be split.
10. **Cleared status and a reconcile flow.** Accounts store the date they were
    last reconciled (`reconciledOn`). YNAB also tracks each transaction as
    cleared, uncleared or reconciled; its reconcile step checks the cleared
    balance against the bank's figure, adds an adjustment if they differ, and
    locks the reconciled entries.
11. **Payees, memos, flags.** YNAB remembers each payee's usual category and
    autocompletes names. Here there is a single description field, with no memo
    or colour flags.
12. **Register tools.** No search, no filter (by account, category, payee or
    date) and no bulk editing.

## Everything else

13. **Sync, mobile and sharing.** Everything lives in `localStorage` in one
    browser, with no backup or export. Clearing site data loses the budget, so
    this is the biggest practical risk. YNAB syncs across devices, has phone
    apps, and lets several people share one budget (YNAB Together).
14. **Undo.** No general undo.
15. **Reports.** Still to come on the Reports page: per-category drill-in, a
    custom date range, a recurring filter and CSV export. YNAB also reports Age of
    Money, the average age of the dollars you spend.
16. **Loan planner.** Loan accounts here are tracked by hand-entered balances.
    YNAB's loan accounts track interest and model what extra payments would save.
17. **Category housekeeping.** Categories cannot be hidden, archived or given
    notes. Deleting one moves its money to Uncategorized; it cannot be merged
    into another category.

## What this app has that YNAB doesn't

- Net worth by account, with monthly statement snapshots and a chart going back
  up to ten years.
- A retirement projection in today's dollars.
- Donation tracking: the deductible part of each gift, which receipts are still
  needed, and a yearly giving goal.
- A pay-schedule calendar.
- A bucket split of the plan (essentials, fun, savings, retirement) compared
  with what was actually spent.

## Suggested order

1. Transfers (#1)
2. Card payment envelopes (#2), because accurate figures on any account with a
   card depend on both
3. Move money (#3), a small change
4. Export and backup (#13), which removes the data-loss risk
