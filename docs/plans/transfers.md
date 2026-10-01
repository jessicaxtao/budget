# Plan: transfers between accounts

Status: **phase 1 (store, maths, tests) built. Phase 2 (modal and register) next.**
Decisions are recorded at the bottom.

## The problem

A ledger record is money in or money out (`TRANSACTION_KINDS`), and money out
must name a category. Moving $500 from checking to savings, or paying the Visa
bill, can only be entered as:

- an outflow from checking, filed against some category, which counts as
  spending, reduces an envelope and shows in the spending report; plus
- an inflow to the other account, which counts as income and adds to "to be
  assigned".

Each half distorts a different figure, and together they inflate both income
and spending in the report. A real transfer moves money between accounts and,
in the common case, touches **no** budget figure at all.

## The model: one record, a third kind

```
{ id, kind: "transfer", date, description, amountCents,
  accountId,      // where the money left
  toAccountId,    // where it arrived
  budgetId }      // only when the transfer crosses the budget boundary
```

**One record, not a linked pair of in/out records.** "One movement of money is
one record" is how the ledger already works, and it is the same reason
donations refuse to copy an amount. A pair can come apart: one leg deleted, one
leg re-dated, one leg's amount edited. A single record cannot disagree with
itself. `amountCents` stays a non-negative magnitude; the direction is
`accountId` → `toAccountId`.

### What a transfer does to the budget depends on which side each account is on

| From → To | Example | Budget effect | Category |
|---|---|---|---|
| on-budget → on-budget | checking → savings, checking → Visa (a card payment) | **none** | none, refused |
| on-budget → off-budget | checking → 401(k), checking → brokerage | **outflow**: money leaves the budget | required (e.g. a savings or retirement category) |
| off-budget → on-budget | brokerage → checking | **inflow**: money enters the budget | optional: none means the pool (to assign, but **not income**), one means a refund to that category |
| off-budget → off-budget | 401(k) rollover to an IRA | **none** | none, refused |

"On-budget" means `spendsThroughBudget`, so cards count as on-budget, exactly
as they do everywhere else. A card payment is the first row: neutral, because
the purchases on the card were already charged to their categories when they
were made.

That classification is **cross-store maths** (it needs the transaction and the
accounts), so it cannot live in `TransactionsContext`. That provider wraps
`AccountsProvider` and must not read it. It goes in one pure function that
every hook calls:

```js
// src/ledger.js — no React, like paySchedule.js
budgetSide(transaction, accountsById) → "inflow" | "outflow" | null
```

- An inflow or outflow returns its own kind, unchanged, so existing records
  classify exactly as they do today.
- A transfer returns the row of the table above, read off the two accounts'
  scopes **live**. Changing an account's scope restates the transfers into it,
  just as it already restates the account's opening balance in "to be
  assigned".
- **A leg whose account is gone** (detached by an account delete, so `null`)
  counts as **outside the budget**. The first draft made the transfer neutral
  instead, but that breaks the books: delete a card that checking paid $500
  towards, and the card's −$500 opening leaves "to be assigned" while checking
  stays $500 lighter, so the envelopes hold $500 more than the accounts. Treated
  as outside, the payment becomes $500 leaving the budget and lands in
  Uncategorized, which is visible. A test checks that "to be assigned" plus
  everything in the envelopes still equals the on-budget cash after the delete.
- **A crossing outflow with no category** (the store cannot refuse it; see
  below) is charged to `UNCATEGORIZED_BUDGET_ID`, as legacy spend already is.
  Dropping it instead would break the envelope identity.

### Why the store cannot enforce the category rule, and who does

`TransactionsContext` cannot see account scopes, so it cannot know whether a
transfer crosses the boundary. This is the same position as the donations
store's "no more than the gift" bound, and it gets the same treatment:

- **The store** checks what it can: a transfer names both accounts, and they
  are different.
- **The forms** (the modal and the register) know the accounts, so they require
  the category on an on→off transfer and refuse one on a neutral transfer.
- **The hooks** handle whatever is in storage anyway (the Uncategorized
  fallback above), so no stored state can break the maths.

## Changes, file by file

### Store: `src/contexts/TransactionsContext.js`

- `TRANSACTION_KINDS.TRANSFER = "transfer"`.
- **`migrateTransactions` must carry `toAccountId`** (`?? null`). Today it
  rebuilds every record from a field list and maps unknown kinds to OUTFLOW, so
  without this edit every transfer would be **stripped of its destination and
  turned into an expense on the next reload**. This is the one change where a
  mistake loses data, so it gets a test of its own.
- `RULES`:
  - existing "an outflow names a category": unchanged (transfers are exempt);
  - new "a transfer names where the money went", fields `kind, toAccountId`;
  - new "a transfer goes to a different account", fields
    `kind, accountId, toAccountId`;
  - `toAccountId` is normalised to `null` on anything that is not a transfer,
    so flipping a transfer back to an outflow cannot leave a stale destination.
- `addTransaction` / `updateTransaction` accept `toAccountId`, with `""`
  normalised to `null` as for the other selects.
- `detachAccountTransactions` clears `toAccountId` as well as `accountId`.
- `getAccountTransactions` matches either leg.
- `reassignBudgetTransactions`, `deleteTransaction`: unchanged.

### Maths: replace every `kind` check with `budgetSide`

| Reader | Today | Change |
|---|---|---|
| `useEnvelopes` | `kind === INFLOW` else spend | classify with `budgetSide`; `null` → skip entirely. Money in from off budget goes to the pool but is reported as `periodTransferInCents` / `cumTransferInCents`, not income |
| `accountBalancesAt` | inflow +, **else −** | a transfer is − on `accountId` **and** + on `toAccountId`. Today's `else` would treat it as an outflow and lose the arriving leg. |
| `useSpendingReport` | inflow / outflow | classify; neutral transfers are in no figure; money in from off budget with no category is in neither income nor spending, totalled as `transferredInCents` |
| `useNetWorth` `indexSavingsSpend` | outflows in the savings/retirement buckets | also count crossing on→off transfers with such a category. They are the exact signal this proxy was standing in for (see phase 3) |
| `useGiving` | skips non-inflows / tagged ids | unchanged; a transfer can't be a gift (the forms don't offer it) |

**The envelope identity gains one term**, because money brought in from off
budget is cash but not income:

```
toBeAssigned + Σ available === opening + cumulative income + cumulative transferred in − cumulative spend
```

A neutral transfer adds to neither side; one out to off budget is in
`cumSpentCents` like any outflow.

The report's tripwire ("`netCents` = every inflow less every outflow in the
window") now reads *across the budget's edge, less money brought in from off
budget with no category*.

### UI

**`AddTransactionModal`**: the toggle grows a third option, **Transfer**, next
to Money out / Money in.
- Fields: From, To, Amount, Date, Description.
- From and To offer **every** account, off-budget included. Moving money to a
  401(k) is the point.
- The category select appears only when the picked pair crosses the boundary:
  required for on→off; for off→on, optional, with "None — income to assign".
  It is keyed on the pair's crossing state, the same way it is already keyed on
  direction, so each case gets its own default.
- The "nowhere to file this" guard: a transfer needs two accounts, not a
  category.

**`TransactionRegister`**: a transfer row shows the Account cell as
`Checking → Savings` (two compact selects) and the amount in the **Out** column,
read from the source account's side. The In cell on a transfer row is blank and
not editable, because "type in the other column to flip direction" makes no
sense for a transfer. The Category cell shows a dash when the transfer is
neutral. Keep the fixed column widths summing under 768px (see CLAUDE.md); two
selects in the Account cell is the tight spot, and may mean widening that
column at Description's expense.

**`AccountList` / dashboard**: nothing to do. Both read `accountBalancesAt`.

## Phases

1. **Store + maths + tests.** The `budgetSide` module, store changes, migration,
   every hook, and the two tripwires extended. No UI yet; it can be verified
   entirely in tests.
2. **Modal and register.** Enter and edit transfers. Also show
   `periodTransferInCents` beside "Received" in `ToBeAssignedBar`, since
   "to be assigned" now grows from something that isn't income.
3. **Follow-ons** (each optional, separately shippable):
   - *Net-worth interpolation from real transfers.* A transfer into a specific
     off-budget account says exactly when and where money moved, which
     `indexSavingsSpend` only guesses at, and shares across every holding.
   - *Credit-card payment envelopes* (comparison item #2) build directly on
     card payments being neutral transfers.

## Tests

Phase 1's are in (`dataModel.test.js` "transfers between accounts", and the
report test in `useSpendingReport.test.js`); the UI ones come with phase 2.

- `dataModel.test.js`: the identity after each of a neutral transfer, an on→off
  transfer with a category, one with no category (→ Uncategorized), an off→on to
  the pool, an off→on refund, and an account delete that leaves a transfer
  half-detached.
- Store: the migration keeps `toAccountId` across a reload; a transfer to the
  same account is refused; one with no destination is refused; flipping kind
  away from transfer clears `toAccountId`.
- `accountBalancesAt`: both legs move, and an off-budget destination's derived
  balance rises.
- `useSpendingReport.test.js`: a neutral transfer is in no figure and the
  identity holds.
- `AddModals.test.js`: the Transfer option, the category appearing and
  disappearing as the pair crosses the boundary, re-seed across open/close
  cycles.
- `TransactionsPage.test.js`: enter a transfer, see both account balances move
  and "to be assigned" not move.

## Decisions

1. **Money brought in from an off-budget account is not income.** It lands in
   "to be assigned", but it is kept out of income everywhere: the dashboard's
   figures, the Reports page and the giving page's share of income. The
   envelope hook reports it separately (`periodTransferInCents`), and the
   report totals it as `transferredInCents`. Transfers out to an off-budget
   account under a category still count as spending from that category, which
   is how a retirement contribution shows in the retirement bucket.
2. **No merge tool.** Nobody is using the app yet, so there are no faked
   transfers to convert. Dropped from phase 3.
3. **Off-budget → off-budget transfers are allowed.** They have no effect on the
   budget and move the derived balances that net worth falls back on.
