# Plan: transfers between accounts

Status: **phases 1 and 2 built** (store, maths, modal, register, to-be-assigned bar,
reports). Phase 3 follow-ons are optional.
Decisions are recorded at the bottom.

## The problem

A ledger record was either money in or money out, and money out had to name a
category. Moving $500 from checking to savings, or paying the Visa bill, could
only be entered as:

- an outflow from checking, filed against some category, which counted as
  spending, reduced an envelope and showed in the spending report; plus
- an inflow to the other account, which counted as income and added to "to be
  assigned".

Each half distorted a different figure, and together they inflated both income
and spending in the report. A real transfer moves money between accounts and,
in the common case, touches **no** budget figure at all.

## The principle

**Money that moves is not money spent.** Setting money aside in a brokerage, a
401(k) or a savings account the budget doesn't track still leaves the household
with that money. It becomes spending only when it is spent, for example when
the house is bought out of the savings account. So a transfer is never spending
and never income, wherever it goes.

## The model: one record, a third kind

```
{ id, kind: "transfer", date, description, amountCents,
  accountId,      // where the money left
  toAccountId,    // where it arrived
  budgetId }      // optional: the envelope it moves, when it crosses the budget's edge
```

**One record, not a linked pair of in/out records.** "One movement of money is
one record" is how the ledger already works, and it is the same reason
donations refuse to copy an amount. A pair can come apart: one leg deleted, one
leg re-dated, one leg's amount edited. A single record cannot disagree with
itself. `amountCents` stays a non-negative magnitude; the direction is
`accountId` → `toAccountId`.

### What a record does to the budget

| Record | Example | Envelopes / "to be assigned" | Spending report |
|---|---|---|---|
| transfer, on → on | checking → savings, paying the Visa | nothing | nothing |
| transfer, on → off | checking → 401(k) or brokerage | out of the envelope it names, or out of "to be assigned" if none | nothing: the money is still the household's |
| transfer, off → on | brokerage → checking | into the envelope it names, or into "to be assigned" if none | nothing: not income |
| transfer, off → off | 401(k) rolled into an IRA | nothing | nothing |
| outflow on an **off-budget** account | the house, bought out of savings | nothing: the money left the budget when it was set aside | **spending** in its category |
| inflow or outflow on an on-budget account | as before | as before | as before |

"On-budget" means `spendsThroughBudget`, so cards count as on-budget, exactly as
they do everywhere else. A card payment is the first row: no effect, because the
purchases on the card were already charged to their categories when they were
made.

That classification is **cross-store maths** (it needs the transaction and the
accounts), so it cannot live in `TransactionsContext`. That provider wraps
`AccountsProvider` and must not read it. It is one pure function that every
hook calls:

```js
// src/ledger.js — no React, like paySchedule.js
budgetSide(transaction, accountsById) → "inflow" | "outflow" | null
```

- An inflow or outflow returns its own kind, unless its account is off-budget,
  in which case it returns `null`. A record with no account at all (legacy, or
  detached by an account delete) stays in the budget, as it always has.
- A transfer returns `null` when both ends are on the same side of the budget,
  and otherwise the direction it crosses. Scopes are read **live**, so changing
  an account's scope restates its transfers, as it already restates the
  account's opening balance in "to be assigned".
- **A leg whose account is gone** (detached by an account delete, so `null`)
  counts as **outside the budget**. The first draft treated the transfer as
  having no effect instead, but that breaks the books. Delete a card that
  checking paid $500 towards: the card's −$500 opening leaves "to be assigned"
  while checking stays $500 lighter, so the envelopes would hold $500 more than
  the accounts. Treated as outside, the payment becomes $500 leaving the budget,
  taken out of "to be assigned". A test checks that "to be assigned" plus
  everything in the envelopes still equals the on-budget cash after the delete.

**The category on a crossing transfer is optional both ways**, so the store has
nothing to enforce about it that it cannot see. It checks what it can: a
transfer names both accounts, and they are different. The forms should refuse a
category on a transfer that stays on one side, because it would mean nothing.

## Changes, file by file

### Store: `src/contexts/TransactionsContext.js` (done)

- `TRANSACTION_KINDS.TRANSFER = "transfer"`.
- **`migrateTransactions` carries `toAccountId`.** It rebuilds every record from
  a field list and maps unknown kinds to OUTFLOW, so without this every transfer
  would reload as an expense going nowhere. Tested on its own.
- `RULES`: a transfer names where the money went (`kind, toAccountId`), and
  that is a different account (`kind, accountId, toAccountId`). `toAccountId` is
  `null` on anything that is not a transfer, and `updateTransaction` drops it
  when a record stops being one.
- `detachAccountTransactions` clears whichever leg pointed at the deleted
  account; `getAccountTransactions` matches either leg.

### Maths (done)

| Reader | Change |
|---|---|
| `useEnvelopes` | Classifies with `budgetSide`; `null` is skipped. A crossing transfer moves its envelope as `movedIn` / `movedOut` (gross, on each row, apart from `spent` / `refund`) or the pool if it names none. Reports `periodTransferInCents` / `periodTransferOutCents` and cumulative twins. "Spent this month" no longer includes money set aside. |
| `accountBalancesAt` | A transfer is − on `accountId` **and** + on `toAccountId`. |
| `useSpendingReport` | Ignores every transfer and reads every plain record, off-budget accounts included. Totals `transferredInCents` / `transferredOutCents` for the window. |
| `useNetWorth` `indexSavingsSpend` | Counts every transfer out of the budget, plus plain outflows under a savings or retirement category as before. |
| `useGiving` | Unchanged; a transfer can't be a gift. |

**The envelope identity** now reads:

```
toBeAssigned + Σ available === opening + cumulative income − cumulative spend
                               + cumulative transferred in − cumulative transferred out
```

**The report identity** (`netCents` = every inflow less every outflow in the
window) holds unchanged once "every" means every record that isn't a transfer.
Money set aside is part of what "net" says was kept, which is the point.

### UI (phase 2, done)

**`AddTransactionModal`**: the toggle grows a third option, **Transfer**, next
to Money out / Money in.
- Fields: From, To, Amount, Date, Description.
- From and To offer **every** account, off-budget included.
- When the pair crosses the budget's edge, an optional category select appears:
  "None — from to-be-assigned" going out, "None — to assign" coming in. It is
  keyed on the crossing state, as the select is already keyed on direction, so
  each case gets its own default.
- The "nowhere to file this" guard: a transfer needs two accounts, not a
  category.
- **Money out also has to offer off-budget accounts** now, or the house can't be
  bought out of savings. Out of an off-budget account, the category still names
  what it was spent on, for the report.

**`TransactionRegister`**: a transfer row shows the Account cell as
`Checking → Savings` (two compact selects) and the amount in the **Out** column,
read from the source account's side. The In cell on a transfer row is blank and
not editable, because "type in the other column to flip direction" makes no
sense for a transfer. The Category cell shows a dash when the transfer stays on
one side. Keep the fixed column widths summing under 768px (see CLAUDE.md); two
selects in the Account cell is the tight spot.

**`ToBeAssignedBar`**: show money moved in and out by transfer beside
"Received", since "to be assigned" can now move without income or assignment.

**Reports**: say how much was moved to and from off-budget accounts in the
window, next to the headline figures. The bucket split now leaves money set
aside by transfer out, so a household that saves by transfer sees the savings
and retirement shares near zero against the plan's. Give the split a
"set aside" segment so the plan-against-books comparison still means something.

**`AccountList` / dashboard**: nothing to do. Both read `accountBalancesAt`.

## Phases

1. **Store + maths + tests.** Done.
2. **Modal, register, the to-be-assigned bar and the reports page.** Done.
3. **Follow-ons** (each optional, separately shippable):
   - *Net-worth interpolation from real transfers.* A transfer into a specific
     off-budget account says exactly when and where money moved, which
     `indexSavingsSpend` only guesses at, and shares across every holding.
   - *Credit-card payment envelopes* (comparison item #2) build directly on
     card payments being transfers with no budget effect.

## Tests

Phase 1's are in `dataModel.test.js` ("transfers between accounts") and
`useSpendingReport.test.js`:

- the store: one record naming both ends; refused without a destination or to
  the same account; an edit can't point it back at itself; flipping away from a
  transfer drops the destination; the destination survives a reload;
- the envelope identity after each case in the table above, including the house
  bought out of an off-budget account and an account delete that cuts a leg;
- the report: transfers are neither spending nor income, and spending out of an
  off-budget account is spending.

Phase 2's:

- `AddModals.test.js` ("transfers between accounts"): the Transfer option, the
  envelope appearing only when the pair crosses and defaulting to none each
  way, a transfer to the same account refused with the form left open, reopen
  resetting to money out, off-budget accounts offered for money out and not
  money in, and no form with only one account.
- `TransactionRegister.test.js`: a transfer row's two ends, its amount-only
  edit, its absence from both totals, and its envelope only across the edge.
- `TransactionsPage.test.js` ("transfers"): entered through the form, the pool
  holds still between two on-budget accounts, drops (with "moved out" on the
  bar) going off budget, and moves when the register re-points one.
- `useSpendingReport.test.js` and `ReportsPage.test.js`: money set aside fills
  its envelope's bucket in the split, and the page says what moved.

**Known, not caused by this work:** at 768px the register's fixed columns
already sum to more than the container, so Description collapses to nothing and
its heading overlaps Category's. The column widths are unchanged by this plan.

## Decisions

1. **A transfer is never spending and never income.** Money set aside off
   budget is still the household's; it is spending when it is spent. Moving it
   out takes it from the envelope it names (or "to be assigned"), but "spent
   this month" and the spending report don't count it. Money brought back isn't
   income either.
2. **Spending out of an off-budget account is spending** (the house). It shows
   in the report under its category and comes out of no envelope.
3. **No merge tool.** Nobody is using the app yet, so there are no faked
   transfers to convert.
4. **Off-budget → off-budget transfers are allowed.** They have no effect on the
   budget and move the derived balances that net worth falls back on.
