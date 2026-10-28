# Loans

A plan, not a description of what exists — nothing here is built. One screen for any
amortizing loan, with what a mortgage and a car loan each need on top: how much is left,
how long until it is gone, how each payment divides between interest and principal, how
much of the thing it bought the household actually owns, and what paying more would buy.
Read `STORES.md` (`AccountsContext`, `RetirementContext`) and `DERIVATIONS.md` (net worth,
the whole-balance-sheet walk) first; this leans on both.

Three decisions shape everything below. **The rest is mechanism, and these are the ones to
confirm before building**:

1. **A loan is terms *about* a liability account, never a second balance.** What is owed is
   `useNetWorth`'s figure for that account — the same one the Net worth page shows — and the
   amortization schedule is a *reading beside it*, the way a statement is. `accountBalancesAt`
   stays the only definition of what an account holds.
2. **Interest never touches the loan account.** It is money that left the household, so if
   it goes into the ledger at all it goes in as an ordinary outflow from the account that
   paid it. Only principal is a transfer into the loan.
3. **The what-if is a guess and holds no money.** An extra $100 changes no figure in the
   books until the household actually pays it.

## What the screen answers

| Asked for | Where it comes from |
|---|---|
| Balance over time | the contract schedule from origination, statement snapshots as points, and a projection from today's owed figure |
| Payments made, and how much | the schedule's payment number by date ("37 of 360"), and the books' own count and sum of transfers into the account |
| Countdown | payments left and the payoff date, projected from what is owed today at today's payment, against the contract's own end date |
| Equity | the value of the collateral account minus what is owed, and loan-to-value |
| Interest against principal | this payment's split, the split per year across the loan, interest paid so far and interest still to come |
| "If I paid $100 more" | the same walk with extra payments, compared to the baseline: months sooner, interest saved |

## Where the numbers come from

There are three readings of what is owed, and the page has to keep them apart because they
disagree in normal use:

- **The books' figure** — `useNetWorth`'s value for the account: the latest statement
  snapshot carried forward, or, with none, the opening balance plus transfers in. The headline.
- **The contract schedule** — what the loan *should* owe on a date if every payment was
  exactly the contractual one, walked from the original principal. Fixed for the loan's life
  (until a rate change or a recast). Draws the past half of the chart.
- **The projection** — the schedule walked forward from the books' figure *today*, at the
  current payment plus any what-if. Everything about the future — the countdown, the payoff
  date, interest still to come, the what-if — reads this one, so paying ahead or falling
  behind shows up the moment a statement is entered.

**When the books' figure and the contract schedule disagree by more than a payment's
principal, the page says so** ("your last statement is $4,120 ahead of schedule" — extra
payments; or "behind" — a missed one, or a statement that is out of date). It never resolves
the gap itself, the `driftCents` rule. It also offers the schedule's figure for this month as
a one-click entry in the monthly pass on the Net worth page, *offered*, never written —
only a typed or accepted figure becomes a snapshot, the rule `UpdateBalancesModal` already
keeps.

**Why not make the schedule the derived balance**: it would put loan maths into
`accountBalancesAt`, give a loan account a value nobody typed, and move the net worth of
every household with a loan on the day it shipped. The reading-beside-it shape moves no
figure anywhere.

## The store: `LoansContext`

Key `loans` (add it to `STORE_KEYS`, which `storage.test.js` checks, and the books file's
inventory in `ACCOUNTS.md`). The seventeenth provider. It reads no other store, so its
position in the provider order is free.

```
loans: [{
  id, accountId, kind,                  // kind ∈ LOAN_KINDS: mortgage | auto | student | personal | other
  originalPrincipalCents, rateBps,      // nominal APR, basis points
  termMonths, firstPaymentDate,         // "YYYY-MM-DD"; required — a schedule needs a day one
  paymentSource, paymentCents,          // "derived" | "typed"; principal + interest only
  rateChanges: [{ id, fromDate, rateBps }],
  balloonCents,                         // owed in one lump on the last payment; null = none
  collateralAccountId,                  // the house, the car
  collateralValueCents,                 // the price paid; LTV for PMI is measured against it
  collateralRateBps,                    // signed yearly change: +350 a house, −1500 a car; null = kind default
  escrowCents, pmiCents,                // mortgage; null = not stated
  pmiRemovalLtvBps,                     // 8000 by default (request), 7800 is automatic
  whatIf: { extraMonthlyCents, extraYearlyCents, extraYearlyMonth, lumpSums: [{ id, date, amountCents }], biweekly },
}]
```

- **`accountId` names a liability**, and `addLoan` refuses an asset. It is otherwise **inert
  but kept**: deleting the account cascades nothing into the loan, and the page shows
  the loan as "account removed" with its schedule still readable. One loan per account.
- **The add-loan form can open the account too** — name, off budget, liability, opening
  balance = what is owed today — so a household with no mortgage account yet types the figures
  once. Two writes from the page (`addAccount` then `addLoan`); if the second fails, the
  error is surfaced and the account stays, like any other account.
- **`paymentSource` is the both-answers-kept rule.** Derived is the standard annuity payment
  from principal, rate and term; typed is what the statement says, which differs by a few
  cents (the lender's rounding) or by a lot (a recast, an interest-only period). Switching
  never clears the other.
- **`escrowCents` and `pmiCents` are not principal or interest** and are never in the
  amortization. They only matter to what the payment *costs* and to the record-payment split.
  Blank removes the field — "no PMI" is `0`, "not told the app" is blank, the blank-vs-zero rule.
- **`collateralRateBps` null takes a default by kind** — a mortgage reads the retirement
  plan's `propertyRateBps`, so the two pages agree about the house; a car reads −15% a year; any
  other kind, no collateral line. A typed figure overrides it and is kept.
- **`whatIf` sits on the record because it belongs to that loan**, synced like everything
  else so it is still there next week. Clearing it never touches the terms. It is read by the
  Loans page and nothing else.
- Validation through `toCents` / `toBps`, `{ ok, error }` from every mutator: principal > 0,
  term 1–600 months, rate 0–`MAX_RATE_BPS`, a valid first-payment date, rate changes dated after it.
  **Coherence is not checked** — a typed payment below the first month's interest is reported
  on the page ("this never pays off"), not refused at the field, the `RetirementContext` stance.

## The maths: `src/domain/amortization.js`

Pure and integer-cents throughout, like `netWorthProjection`. React never sees a loop.

- `paymentFor(principalCents, rateBps, months)` — the annuity payment, rounded to the cent;
  `principal / months` at a zero rate.
- `amortize({ balanceCents, rateBps, paymentCents, fromDate, rateChanges, balloonCents, termEnd, extras })`
  → rows `{ n, date, rateBps, interestCents, principalCents, extraCents, balanceCents }`.
  Interest each month is `round(balance × rate / 12)`; the payment covers interest first. **The
  last row pays whatever is left**, so the rounded payment never leaves a 361st payment of
  $3.12 — the trap an unguarded loop falls into on a standard 30-year loan.
- **Capped at 1,200 rows and stops with `neverPaysOff: true`** when the payment does not
  cover the interest, rather than spinning.
- `summarize(rows)` → payments left, payoff date, total interest, the crossover payment (the
  first one where more goes to principal than interest).
- `compareWhatIf(base, plan)` → months sooner, interest saved, the new payoff date.
- `remainingAt(schedule, date)` — the contract schedule's balance on a date, for the "ahead
  / behind" comparison and the Net worth page's offered figure.

**Biweekly is 26 half-payments a year**, which is one extra monthly payment a year,
modelled as exactly that (each half-payment's interest is still charged monthly — what most
US servicers actually do). **Daily simple interest**, which most car loans use, is not
modelled: the gap from monthly is cents to a few dollars over a loan, and an option nobody can
check against a statement is a promise the app cannot keep. Revisit only if a household's
statement disagrees with the page by more than that.

## The hook: `useLoans()`

A cross-store hook — Loans, `useNetWorth` (owed and collateral value), Transactions (payments
the books recorded), Retirement (`propertyRateBps`) — so **the eleventh**; `CLAUDE.md` and
`DERIVATIONS.md` both count ten, and the count has to move with it.

Per loan it returns: `owedCents` and its source (statement month, or derived), the contract
schedule, the projection, `summary`, `whatIfSummary`, `aheadCents` (signed, the books against
the contract), `equityCents`, `ltvBps`, `recorded` (count and sum of transfers into the account,
by month), and, for a mortgage, the PMI date. Across all loans: total owed, total monthly
payment, and the debt-free date (the latest payoff).

**Recorded payments are counted, never matched to scheduled ones.** The `useUpcoming` rule:
guessing which transfer was "payment 37" is guessing at intent, and it is wrong the first
time someone pays twice in a month on purpose. The schedule's count comes from the calendar
and the books' count comes from the ledger, and both are shown.

## Recording a payment

Today a payment is usually one outflow from checking under a Housing category, and the
mortgage is valued by monthly statement — the dev seed does exactly that. **That keeps
working with no change**, and it is the first thing to ship against.

The better record, offered from the loan page as **`RecordLoanPaymentModal`** (the
`PayOffCardModal` pattern):

- a **transfer** from the paying account into the loan for **principal plus any extra**, filed
  under the loan's category (it crosses the budget boundary, so the envelope sees it as spending
  — row two of the transfer matrix);
- an **outflow** from the paying account for **interest, escrow and PMI**, the same category
  or split across Mortgage interest / Property tax / Home insurance.

Pre-filled from the projection's next row, every figure editable to match the statement. The
envelope sees the whole payment as spending, which is what happened to the budget; the loan
account is credited with principal only, so **its derived balance is right without a
statement**; and the spending report finally shows interest as a cost and principal as money
the household kept. The two records are **never linked** — the cash-back rule: correcting one
leaves the other as it was.

**Never an outflow on the loan account itself.** `budgetLegs` would read it as budget spending,
and the interest would be counted twice.

A loan's payment is not schedulable as one reminder, since a schedule cannot be a transfer
(`SchedulesContext`); the dashboard's reminder stays as it is, and the modal is how a household
moves to the two-record shape if they want it.

## The page: `/loans`

One entry in `src/navigation.js`, label "Loans", between Net worth and Retirement, and a new
`tab-…` colour token in both blocks of `src/index.css` — all ten existing ones are taken.
No month stepper: like Retirement, almost nothing here is about a month, and the one dated
figure (owed) says which statement it came from.

Top to bottom:

1. **The loans** — one card each (mortgage, car…): name, owed, payment, payoff date, a thin
   progress bar of principal repaid. Totals across all of them, and the debt-free date. Picking
   one opens it below; one loan skips the list.
2. **Hero** — "$298,214 owed · 23 years 5 months to go · paid off February 2050", with the
   progress bar, "payment 79 of 360", and ahead/behind the contract when it is.
3. **Four tiles** — *Next payment* (interest / principal / escrow, as a split bar), *Paid so
   far* (principal and interest, since origination by the schedule), *Equity* (value − owed,
   LTV), *Interest still to pay*.
4. **Balance over time**, the chart and table twin the Net worth and Retirement pages use: the
   contract schedule as a line, statement snapshots as points on it, a today rule, the
   projection dashed forward, the what-if as a second dashed line, and — where there is
   collateral — its value as a line above, so **equity is the gap between the two**, shaded.
   A car's value line crossing *under* the balance is the "underwater" stretch, drawn as such.
5. **Where each payment goes** — a column per year, interest and principal stacked, the
   crossover year marked ("from 2044, more of each payment is principal"), with the what-if
   overlaid when one is set.
6. **Pay it off faster** — below.
7. **Kind-specific panel** — below.
8. **Full schedule** — a `<details>`, closed, at the foot (the balance-history-grid pattern):
   every payment by year, past rows dimmed, today's highlighted, extra payments in their own
   column.

Empty states: no loans (add one, or "you have a liability account — add its terms"); a loan
with no statement yet (owed is derived — say so, offer the monthly pass); paid off (the
progress bar full, total interest paid, the date it ended).

### Pay it off faster

Inputs, each committed on blur (on change for the biweekly toggle):

- **Extra each month** — the $100 question.
- **Extra each year**, and the month — the bonus, the tax refund.
- **One-off lump sums**, dated.
- **Pay half every two weeks** (biweekly).

Results beside them: the new payoff date, **months sooner**, **interest saved**, both lines on
the balance chart. Under it, a sensitivity table at +$50 / +$100 / +$250 / +$500 a month — the
Retirement page's ±1-point table, applied here — so the household can see where the next
dollar stops buying much.

For a sense of scale, the dev seed's mortgage ($325,000, 5.75%, 30 years, $1,896.61 a month):

| Extra a month | Paid off | Interest saved |
|---|---|---|
| +$100 | 3 years 7 months sooner | ~$50,400 |
| +$200 | 6 years 3 months sooner | ~$87,300 |
| +$500 | 11 years 8 months sooner | ~$156,700 |

and a $35,000 car at 7% over 60 months: +$100 a month ends it 8 months early and saves ~$1,000.

Two lines beside the result, stated and never decided for the household: **paying the loan
off is a guaranteed return at its rate**, set against the retirement plan's growth rate (net
of inflation, the way that page states it); and an emergency fund below its target is a
better home for the money first (`useEmergencyFund`).

**"Make this the plan"** raises the loan's category estimate by the extra amount — an
ordinary `updateBudget`, surfaced through `{ ok, error }` — so the extra is budgeted from next
month. It writes nothing to the ledger; the money only moves when it is paid.

### Mortgage

- **Escrow and PMI** in the payment breakdown; the payment the household writes is P&I +
  escrow + PMI, and the page always shows which part is which.
- **PMI countdown** — the date the contract schedule reaches 80% of the original value (when
  it can be requested) and 78% (when it drops on its own), and the earlier date the what-if
  reaches it.
- **Equity and LTV** against the house account's value at the retirement plan's appreciation rate.
- **Rate changes** for an ARM — dated rate rows, the schedule re-amortized at each. Later phase.
- **Refinance check** — new rate, new term, closing costs → the new payment, the break-even
  month, lifetime interest either way. Later phase; a scenario, never a write.

### Car

- **Above / below water** — the vehicle's value at its depreciation rate against the balance,
  the month the two cross, and what the household would owe after selling today.
- A **balloon** final payment where the contract has one.

### Student, personal, other

The generic screen and nothing more: hero, tiles, both charts, pay-it-off-faster. Income-driven
repayment, deferment and interest-only periods are out of scope — each is a payment that is
not an annuity, and the honest version of each is its own plan.

## What it touches elsewhere

- **Retirement's `debtAssumptions`** — today a rate and a monthly payment typed per liability.
  Once a loan exists for the account, those become derivable from it: add a source
  (`"loan"` | `"typed"`, default loan where a loan exists), both kept. The projection then walks
  the same rate and payment this page shows, and a what-if adopted as the plan reaches it through
  the payment. `netWorthProjection.test.js` must stay green; nothing about the walk changes,
  only where its two inputs come from.
- **Net worth** — no change to the maths. The monthly pass offers the schedule's figure for a
  loan account (decision 1).
- **Dashboard** — nothing in the first version. A "debt-free in" line is a candidate later.
- **Ask** (`ASSISTANT.md`) — the loans store joins whatever the assistant can read, if it reads
  stores by key.
- **Docs** — `STORES.md` (the store), `DERIVATIONS.md` (the hook and the module, the count to
  eleven), `CLAUDE.md` (route table, provider count to seventeen, hook count to eleven),
  `TESTING.md` (the suite). This file becomes a description once built, the way
  `LIFE_EVENTS.md` did.

## Tests

- **`amortization.test.js` as a sixth tripwire**: for any principal, rate and term, the
  contract schedule has exactly `termMonths` rows, Σ principal === original principal to the
  cent, Σ payment === Σ principal + Σ interest, and the balance never rises. A zero rate is
  principal ÷ term. With extras, Σ principal still equals the starting balance and the schedule
  is never longer than the baseline. Asserted against a hand-computed loan, not against the
  module's own output.
- **`useLoans.test.js`**, real providers: owed is `useNetWorth`'s figure, never the schedule's;
  a statement ahead of schedule shows as ahead; a deleted account leaves the loan readable.
- **`dataModel.test.js`** stays green through `RecordLoanPaymentModal`'s two writes — the
  identity covers both records with no new rule, and that is the point of shaping them that way.
- **`LoansPage.test.js`**: the countdown, a what-if moving the payoff date, a refused write
  keeping the modal open with its error.

## Order

1. `amortization.js` and its tripwire.
2. `LoansContext`, `STORE_KEYS`, an add/edit loan modal (with "open the account too") on the
   page, and a dev-seed loan for the existing mortgage plus a car.
3. `useLoans`; the page — list, hero, tiles, both charts, the schedule table.
4. Pay it off faster: inputs, results, sensitivity table, "make this the plan".
5. Mortgage and car panels: escrow/PMI and the PMI countdown, equity and water lines.
6. `RecordLoanPaymentModal`, and the Net worth monthly pass offering the schedule's figure.
7. Retirement's `debtAssumptions` reading the loan.
8. Later: ARM rate changes, refinance check, a dashboard line.

## Open questions

- **Decisions 1–3 above.** If decision 1 is wrong — if a loan account should *derive* its
  balance from the schedule — most of the page stays the same, but it becomes a change to
  `useNetWorth`, and every net worth with a loan moves.
- **Should a loan exist without an account?** This plan says no: a loan the books do not hold
  is not in net worth, and a planned purchase's mortgage is already a life event on the
  Retirement page. Allowing it would make `accountId` nullable and the owed figure the
  schedule's alone.
- **A tab of its own, or a section of Net worth?** A tab, because the screen is a lot of
  sections and the Net worth page is already long, but it is the eleventh.
