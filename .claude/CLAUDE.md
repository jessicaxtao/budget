# CLAUDE.md

Personal budgeting app: Create React App at the repo root, **one household per account**, backed by Supabase (Postgres + Auth) with **no server of our own** — and, over the same bundle, an Electron desktop app whose books are a file the household owns.

Every store persists through `useSyncedState` (`src/hooks/useSyncedState.js`) — `useState`-shaped, JSON, optional third `migrate` arg applied to stored values but never to the default.

## Where the rest is written down

This file is the orientation and the rules that bite everywhere. **Each companion doc in `.claude/` is the single place its subject's rules live** — a rule stated twice eventually disagrees with itself — and each says at the top when to read it.

| Doc | Read it before |
|---|---|
| **`STORES.md`** | changing a store's shape, its validation, or a cascade |
| **`DERIVATIONS.md`** | changing any cross-store hook's maths, or a chart that reads one |
| **`TESTING.md`** | adding a test suite, or working out where a claim belongs |
| **`UI.md`** | writing UI — the palette, the two modes, the shared components |
| **`ACCOUNTS.md`** | touching auth, sync, or storage scoping |
| **`DESKTOP_APP.md`** | touching the Electron shell, the books file, or packaging |
| **`ASSISTANT.md`** | touching "Ask" |

Plans, not descriptions of what exists: `LIFE_EVENTS.md`, `END_TO_END_ENCRYPTION.md`.

## Commands

Run from the repo root.

- `npm start` — dev server at http://localhost:3000
- `npm test` — Jest + RTL, watch mode. Single file: `npm test -- --watchAll=false src/App.test.js`
- `npm run build` — production build
- `npm run desktop` — the shell against the dev server, hot reload and all
- `npm run desktop:build` — packaged into `dist/win-unpacked` (etc.), no installer
- `npm run desktop:dist` — the installer for the platform you are on
- `npm run shell-config` — regenerate `electron/shell-config.json` alone; the three above already do

No lint script; CRA's ESLint (`react-app`) runs during `npm start` / `npm test`. Credentials live in `.env.local` (gitignored; copy `.env.example`). `supabase/schema.sql` is the whole server side and is idempotent. `node buildResources/makeIcon.js` redraws the icon from the palette; output is committed, so run it when a colour moves.

## Recurring conventions

Stated once here. Where a rule in a companion doc names one of these, this is it.

- **Inert but kept.** A reference to another store's record (a payee's `defaultBudgetId`, a schedule's `accountId`, an offer's `budgetIds`, `accountIds` anywhere, a life event's `propertyRef`) is **never validated against live records and nothing cascades into it**. A dangling id contributes nothing, resolved where it is read. This is what keeps the dependency graph one-way.
- **Both answers kept.** Where a question has two legitimate answers (derived vs typed), both are stored and a `…Source` field says which is in force; the other is never cleared. Same for fields a cadence or kind does not currently read. Comparing them is the point, and a switch that destroyed what it switched away from could only be used once.
- **Holds no money.** Stores of intentions, guesses and statements (`Schedules`, `SavingsGoals`, `Retirement`, `LifeEvents`, `Scenarios`, `Rewards`, `Donations`, `EmergencyFund`) are read by a hook or a page, never by the envelope or balance maths. Adding a record there moves no figure in the books.
- **`{ ok, error }`.** Every mutator that can reject input returns it, and **callers must surface the error** — never close a modal as though the write succeeded. Batch mutators validate the **whole batch before writing any of it**.
- **Blank vs zero.** A blank is a question left open; zero is an answer. Where both are meaningful (a balance snapshot, a goal, a rate) blank **removes the record** rather than storing zero.
- **Nothing is invented.** No migration backfills a decision nobody made — no date on an undated record, no repair of an incoherent split.
- **Commit on blur** for a figure edited in place, **on change** for a select or a control with nothing to half-type. A refused edit goes back, says why, and the input is keyed on the stored value so it re-seeds.

## Money and dates

- **Money is an integer number of cents**, always in a `…Cents` field. Never floating-point dollars. Parse with `toCents`, render with `formatCents` (`src/utils.js`); `toCents` returns `null` for junk, which is how contexts reject bad input instead of writing `NaN`.
- `toCents` takes a figure written the way figures are written ("$1,234.56", "1 234.50", a leading sign) — what `formatCents` itself writes, so a field can show its figure as money and hand it straight back. **Never `parseFloat`**: it reads "1,234.56" as **1** and reports success. Once symbol, separators and spaces come off, what is left must be a number and nothing else, so "12 apples" is `null`.
- **Rates are an integer number of basis points**, always `…Bps`: `toBps` / `fromBps` / `formatBps`, same `null`-for-junk discipline, a "%" taken the way `toCents` takes a "$". A rate stored as `0.025` is a float the retirement projection raises to the power of thirty.
- **Transactions carry a `date`** (`"YYYY-MM-DD"`, local calendar via `todayISO` — never `toISOString`, which is UTC). Periods (`"YYYY-MM"`) are always **derived** with `toPeriod`, never stored, so the two cannot disagree. Legacy records have `date: null` and display as "Undated".
- **Compare periods with `periodLTE`, never a bare `<=`** — `null <= null` is `true`, which sweeps undated records into sums that already count them. Step months with `addMonths`, never string arithmetic (`"2026-13"` sorts before `"2027-01"`).
- Migrations live next to the store owning the key and are keyed on **field presence** (`"amount" in record`), not a version counter, so they are safe to re-run.

## Routing

`react-router-dom` v6, **pinned**: v7's `react-router/dom` export cannot be resolved by the Jest resolver in react-scripts 5. Both routers take the shared `routerFuture` flags (`src/routerFuture.js`).

`src/navigation.js` is the single source of truth for pages, feeding both the route table in `App.js` and the tab bar in `AppShell.js` — **adding a page means adding one entry there**. `src/App.js` is only shell; each page owns its state and modals.

| Route | Subject |
|---|---|
| `/` | Dashboard — today's figures, accounts and their last reconciliation, categories as the plan groups them, the one door to moving money between envelopes |
| `/transactions` | The editable register, a slim to-be-assigned bar, the ledger-entry modal, the split editor, assignment |
| `/plan` | Categories, estimates and goals, expected income, pay schedule, accounts and openings, the emergency fund, the balance-history grid (closed, at the foot) |
| `/net-worth` | Hero figure and band split, stacked chart + table twin, holdings by band, settling a statement, the monthly pass |
| `/retirement` | The outlook, year-by-year chart + table twin, net worth by age, the account picker, assumptions, scenarios |
| `/reports` | The window, headline figures, bucket split, cashflow chart, plan-vs-actual chart, spending by category ranked, per-category drill-in |
| `/donations` | A year of giving: given against claimable, the year's gifts, the goal, the organizations |
| `/savings-goals` | Goals with target, accumulated, remaining, this period's contribution; read-only to-be-assigned above |
| `/rewards` | Card offers and credits, which card to reach for, each card's fee against what it earns, then points/miles: value per point, catalog vs the household's own, planned trips |

`Placeholder` marks what is still to come: asset allocation (`/net-worth`), non-cash gifts and pledges (`/donations`), linking a goal to a category or account (`/savings-goals`), a recurring filter and CSV export (`/reports`).

**The dashboard has no period selector.** Everything on it is as of `todayISO()`, read once in the page so the date, the countdown and the reconciliation ages cannot disagree. Walking back through the books is the register's job, and **funding a month ahead is `AssignIncomeModal`'s** — the month is a control on that form rather than on any page, so the pool keeps one door and the dashboard keeps one date. The Net worth page *does* have a month, because half of what is on it is typed in and the month it was typed for is the meaning of the figure. The Retirement page has none, because nothing on it is about a month at all.

**The dashboard and the register cut the same books along different axes.** What each *envelope* holds is answered once, on the dashboard, by `CategoryLedgerTable`. What *happened*, line by line, is the register. The one envelope figure on the register is what is left to assign. **Do not put a grid of envelope cards back on `/transactions`.**

## State: sixteen providers in `src/contexts/AppProviders.js`

Add stores there, not in `index.js`. IDs are generated with `uuid` v4 **in the context**, never in form components. Each context memoises its value. **Cross-store maths belongs in a hook, never in a provider.**

The stores: `Transactions`, `Payees`, `Schedules`, `EmergencyFund`, `Assignments`, `Budgets`, `Accounts`, `IncomePlan`, `PaySchedule`, `Retirement`, `Donations`, `LifeEvents`, `Scenarios`, `Rewards`, `SavingsGoals`, `SavingsGoalAssignments`. **`STORES.md` is the field-by-field detail.**

**Provider order is a cascade order** — a store that cleans up after another's delete sits *outside* it:

- `TransactionsProvider` + `AssignmentsProvider` wrap `BudgetsProvider` (deleting a category takes its spend and its funding)
- `TransactionsProvider` wraps `AccountsProvider` (deleting an account cuts its transactions loose) and `PayeesProvider` (detach on delete, repoint on merge)
- `DonationsProvider` wraps `TransactionsProvider` (deleting an outflow takes the statement that it was a gift)
- `SavingsGoalAssignmentsProvider` wraps `SavingsGoalsProvider` (deleting a goal drops every assignment to it)

A deleted category's funding **moves** to `UNCATEGORIZED_BUDGET_ID` (`src/contexts/constants.js`) — dropping it would ask the user to fund the same purchase twice. A deleted goal's simply stops existing and the money reappears in "to be assigned". Each store references the other by id and never reads it back.

### The three shapes a ledger record takes

**`TransactionsContext` is one ledger for every movement of money**, discriminated by `kind` (`TRANSACTION_KINDS.INFLOW` / `OUTFLOW` / `TRANSFER`), never a signed amount; `amountCents` is a non-negative magnitude. Three rules are load-bearing far outside that store:

1. **An outflow must name a `budgetId`; an inflow may.** An inflow with no category is income into the pool; an inflow *with* one is a **refund** against that category. Spend $100 on food, be paid back $60, food shows $40 of activity.
2. **A split's parts add up to `amountCents` exactly.** The envelopes read the parts while every balance reads the whole, and the two agree only because of that rule.
3. **A transfer's meaning depends only on which side of the budget boundary each account sits** (`insideBudget`; **`null` is inside**):

| source | destination | budget effect |
|---|---|---|
| spends through | spends through | **none** — a card payment, checking → savings |
| spends through | off budget | an **outflow** against `budgetId` — a 401(k) contribution |
| off budget | spends through | **income to assign** — a withdrawal into checking |
| off budget | off budget | **none** — a rollover |

**`budgetLegs(transaction, insideBudget)` is what every consumer reads**, and it returns a **list** — one leg per split part, one for an undivided record, none for a transfer the budget never sees. One list on both sides of the identity below, so a split or a transfer cannot be counted as cash on one side and missed on the other.

## The envelope identity

`useEnvelopes(period)` returns one row per budget id, one row per savings goal, and the pool:

```
activity(b, p)   = refunded(b,p) − spent(b,p)          ← signed
available(b, P)  = Σ over p ≤ P of [ assigned(b,p) + activity(b,p) ]
available(g, P)  = Σ over p ≤ P of assigned(g,p)       ← a goal, and nothing else
assignedAhead(P) = max(0, Σ over p > P of [ Σ_b assigned(b,p) + Σ_g assigned(g,p) ])
toBeAssigned(P)  = opening(P)
                 + Σ over p ≤ P of [ poolIncome(p) − Σ over b of assigned(b,p)
                                                   − Σ over g of assigned(g,p) ]
                 − assignedAhead(P)
```

**A savings goal draws on the same pool a category does** — a dollar diverted to the wedding fund cannot also fund groceries. There is no second pool anywhere.

**The invariant**, asserted after every mutation by the tripwire in `dataModel.test.js`:

```
toBeAssigned + reserved + assignedAhead + Σ available + Σ goal available === opening + cumulative inflow − cumulative gross spend
```

**Two terms are money that is still there and no longer free**, and each is subtracted from the pool and reported back so the identity closes over it:

- **`reserved` is the emergency fund held back** (`emergencyReservedCents`, from `useEmergencyFund`'s `reservedCents`, capped at the target where there is one, never below zero). Without it that money read as "to be assigned" and could be given to groceries. Only from the current month on, and off when `emergencyFund.holdBack` is false.
- **`assignedAhead` is a month funded before it arrived** (`assignedAheadCents`) — budgeting ahead, YNAB's and Actual's. **An assignment, unlike a transaction, may be dated ahead on purpose**: it stays out of every figure belonging to the month on screen (it is not this month's `assignedCents`, it seeds no row, it is not in `carriedIn` until its month is behind), but it cannot stay out of the pool — the money it was given is today's money, and a pool that offered it again would let one dollar fund two months. Floored at zero, `reserved`'s rule, because a negative total ahead means a later month will *release* money that is sitting in its envelope today, where `available` already counts it.

`ToBeAssignedBar` names both figures; `DashboardSummary`'s pool tile names the second, since the dashboard has no month on which a month ahead could otherwise be seen.

The assignment terms cancel algebraically, so this checks **coverage, not arithmetic**. Five conditions keep it true:

1. **`rows` is the union** of budget ids, the Uncategorized sentinel, and every id appearing in the ledger or in `assignments`. Filtering what the *grid* renders is fine; filtering what the *sums* cover is not.
2. **Both sides use the same period filter**, and the one assignment that falls outside it is carried by a term of its own. The pool subtracts *every* assignment: those at or before `P` against `Σ available`, those after it against `assignedAhead`. Drop the term and funding next month reads as money vanishing; leave the assignment out of the pool instead and the same dollar is offered twice.
3. **A split's parts are its legs and nothing else is.** `cumSpentCents` is built from the parts while `useAccountBalances` reads `amountCents`, so a division that did not add up would put the two cuts on two different transactions.
4. **A refund is counted once on each side, by different routes.** `toBeAssigned` uses `cumPoolIncomeCents` (uncategorised inflows only) while the right-hand side uses `cumIncomeCents` (every inflow) and a **gross** `cumSpentCents`. Netting refunds off the spend as well would subtract them twice; adding them to the pool as well would create money.
5. **A goal's `availableCents` is nothing but its own cumulative assignment**, which is what makes the third term cancel. **Give a goal any figure the ledger also sees and the identity breaks** — the whole reason a goal is not a category with an account behind it.

**The balance sheet is the other cut of the same ledger**: `balance(a, P) = opening(a) + Σ inflows − Σ outflows, through P` (`useAccountBalances`, derived and never stored). Envelopes say what money is *for*, this says where it *is*. `accountBalancesAt` **stays the only definition of what an account holds.**

## The ten cross-store hooks

Each owns a definition no single store can own. **`DERIVATIONS.md` is the detail.**

`useEnvelopes`, `useAccountBalances`, `useNetWorth`, `useRetirementProjection`, `useSpendingReport`, `useGiving`, `useSavingsGoalEnvelopes`, `useEmergencyFund`, `useCardOffers`, `useCardValue`.

Not in the ten: `useDashboard` and `useStartingBalances` (they arrange what `useEnvelopes` derived), `usePlanHealth` (crosses three stores but never reads the books), `useNextPaycheck` (one store), `useRecordCashback` (a writer), and `useUpcoming` — one store, and it **must not become** a cross-store hook: a schedule is a prediction, and a hook that read the ledger would invite matching an occurrence against a transaction that looks like it, which is guesswork about intent and wrong the first time a bill is paid twice on purpose.

The pure modules beside them: `src/paySchedule.js` (when the household's own pay lands), `src/recurrence.js` (which days a recurring bill lands on), `src/cadence.js` (what a recurring figure comes to in an average month), `src/netWorthProjection.js` (the whole balance sheet walked forward), `src/rewards.js`, `src/chartAxis.js`, `src/bucketTones.js`, `src/cashback.js`, `src/payeeSearch.js`, `src/receipts.js`. **Four cadence names appear in three of those tables by coincidence of English and they are not to be consolidated** — the proof is the weekend rule, which `paySchedule.js` has and `recurrence.js` must not.

Two figures that look alike and are not: **`usePlanHealth`'s `plannedCents` grosses up by `pretaxContributionCents` and `useSpendingReport`'s does not**, because a pre-tax deduction never becomes a transaction a report of the books could find.

## Testing

**`TESTING.md`** says which suite covers what. These are the parts that bite on any change.

### Environment

- jsdom 16 has no `<dialog>`; `src/setupTests.js` polyfills `showModal` / `show` / `close` and the `close` event, guarded so native support wins later.
- **react-scripts sets `resetMocks: true`** — a mock implementation defined at module scope is wiped before every test. Stage them in `beforeEach` or they come back `undefined`.
- A promise resolved in an effect needs `await act(async () => {})` before asserting, or its state update lands outside act.
- **CRA pins Jest's `roots` to `<rootDir>/src` and does not allow it to be overridden** (`createJestConfig.js` lists what it takes, and `roots` is not on it), so a test under `electron/` is never discovered — it does not fail, it silently does not exist. That is why `electronBooks.test.js`, `electronAssist.test.js` and `electronReceipts.test.js` test main-process code from `src/`. They drive the real modules against **real files in a real temp directory** (the atomicity relied on is the filesystem's own); `jest.resetModules()` before each `require` is required, since the module is a singleton over one file.
- A `<dt>` does not take its accessible name from its content, so `getByRole("term", { name })` finds nothing. Reach a figure through its term's text and `nextElementSibling`, scoped to the region.
- A `type="number"` input in jsdom refuses non-numeric text exactly as a browser does — but the only number fields left are the ages and the day count. **Money and rates are textboxes**, so `getByRole` wants `"textbox"`, `toHaveValue` takes a **string** (`"$12,500"`, or `""` for empty, never `null`), and a rejected figure can be tested with a word.
- React 17+ delegates `onFocus` through `focusin`: use `fireEvent.focusIn`, not `fireEvent.focus`.
- dnd-kit drags need `getBoundingClientRect` stubbed to give each row a band by its index (jsdom lays nothing out), and a **60ms wait after each drag**, or its 50ms click-swallowing listener eats the next test's first click.
- Deliver bridge answers inside `await act(async () => …)`. Left outside, the renders go to React's real scheduler and state a re-seed effect sets can still be pending when the next click lands. An empty `act()` afterwards does not help — it only flushes work scheduled inside it.
- A write that follows an `await` lands after the render its button appears in, so `waitFor` the stored record.

### Seeding

- Tests seed pre-migration JSON into `localStorage` before `renderHook` and use the real `AppProviders`, exercising migrations and provider order rather than mocking them. **That this works is the point of the migration's shape**: with no `AuthProvider` above them the storage scope is null, so a bare key is the real key and no network exists to mock.
- Seeding the `transactions` key — or the legacy `expenses` key, which still folds in — also fires the day-one assignment seed; to test spend with no funding, write an empty `assignments` key too.
- Any test that writes a transaction must seed an **account** first: the store refuses one without an `accountId`.
- **Tests that assert a whole stored record must list every field** — `payeeId`, `toAccountId` and `splits` on a transaction; `reconciledOn` on an account; `goalCents` on a budget. Several broke each time one was added, which is the point of asserting whole records.
- **Nothing mocks a hook.** Pages render through the real providers; that is what caught a column dropped from a table header and left in its body.

### The five tripwires — any change to the maths must keep these green

- **`dataModel.test.js`** — `expectBalanced` is the envelope identity written out, **including the `goalRows` and `assignedAheadCents` terms**; drop the first and every goal assignment reads as money vanishing, drop the second and so does every month funded ahead. Its **funding a month ahead** block asserts the half the store cannot see: next month's envelope funded, today's pool paying for it, no row or figure of the month on screen touched, a goal funded ahead drawing on the same pool, over-funding shown rather than refused, and a later month's withdrawal not reading as money free today. Its `transfers` block asserts the same identity in **all four quadrants** of the matrix, the only thing standing between a change to `budgetLegs` and a transfer that quietly creates or destroys money. Its splits block carries **`expectCoversLedger`**, the stronger one: it adds up the raw `amountCents` of every outflow in the seed — a reading with no notion of parts — so it catches a division and its whole drifting *together*, which `expectBalanced` (self-consistent by construction) would not. Its `moveBetweenBudgets` block asserts the move is **one write**, so the sum across the two rows is unchanged at every point a reader of storage could look.
- **`useRetirementProjection.test.js`** — a balance of `need` on the first day of retirement is a balance of zero on the last. The only thing holding the closed form and the year-by-year simulation to the same meaning.
- **`netWorthProjection.test.js`** — three: `expectIdentity` (each year's change in net worth is exactly income − consumption − tax − interest + growth + unfunded, from the unrounded `exact` figures), the reproduction of `projectRetirement` to the cent with only a retirement pot, and a pot of `need` ending at zero through `retirementOutlook`. Asserted again under every event kind, a purchase, a sale, and a down payment bigger than the cash.
- **`useSpendingReport.test.js`** — `netCents` equals every inflow less every outflow in the window, computed straight off the seed with no notion of income or refunds in it. `cashMoved` takes the off-budget account ids so it spells the transfer rule out for itself rather than reading `budgetLegs`: a tripwire that called the code under test would only assert the code agrees with itself.
- **`storage.test.js`**'s last test **reads `src/contexts/*.js` and fails if a store's key is missing from `STORE_KEYS`**. The only test in the suite that reads source, because nothing else can catch it — the app works perfectly until the user opens it somewhere else.
