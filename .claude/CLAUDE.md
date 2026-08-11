# CLAUDE.md

Personal budgeting app: Create React App at the repo root, **no backend**, single user, no auth. Every store persists to `localStorage` via `useLocalStorage` (`src/hooks/useLocalStorage.js`) — `useState`-shaped, JSON, optional third `migrate` arg applied to stored values but never to the default.

## Commands

Run from the repo root.

- `npm start` — dev server at http://localhost:3000
- `npm test` — Jest + RTL, watch mode. Single file: `npm test -- --watchAll=false src/App.test.js`
- `npm run build` — production build

No lint script; CRA's ESLint (`react-app`) runs during `npm start` / `npm test`.

## Money and dates

- **Money is an integer number of cents**, always in a `…Cents` field. Never floating-point dollars. Parse input with `toCents` and render with `formatCents` (`src/utils.js`); `toCents` returns `null` for junk, which is how contexts reject bad input instead of writing `NaN`.
- **Transactions carry a `date`** (`"YYYY-MM-DD"`, local calendar via `todayISO` — never `toISOString`, which is UTC). Periods (`"YYYY-MM"`) are always **derived** with `toPeriod`, never stored, so the two cannot disagree. Legacy records have `date: null` and display as "Undated"; do not backfill invented history.
- **Compare periods with `periodLTE`, never a bare `<=`** — `null <= null` is `true` in JS, which sweeps undated records into sums that already count them. Step months with `addMonths`, never string arithmetic (`"2026-13"` sorts before `"2027-01"`).
- Migrations live next to the store owning the key and are keyed on **field presence** (`"amount" in record`), not a version counter, so they are safe to re-run.

## Routing

`react-router-dom` v6, pinned: v7's `react-router/dom` export cannot be resolved by the Jest resolver in react-scripts 5. Both routers take the shared `routerFuture` flags (`src/routerFuture.js`).

`src/navigation.js` is the single source of truth for pages, feeding both the route table in `App.js` and the tab bar in `AppShell.js` — **adding a page means adding one entry there**. `src/App.js` is only shell; each page owns its state and modals.

Implemented: `/transactions` (envelope grid, income, assignment, expenses), `/plan` (partly — categories and estimates). Scaffolds: `/`, `/reports`, `/net-worth`, `/retirement` — they render `PageHeader` plus `Placeholder` sections whose listed capabilities are the intended scope.

## State: six providers in `src/contexts/AppProviders.js`

Add stores there, not in `index.js`. IDs are generated with `uuid` v4 **in the context**, never in form components.

**Provider order matters.** `BudgetPlanProvider` and `AssignmentsProvider` sit outside `BudgetsProvider` so deleting a budget takes its plans and funding with it. They reference budgets by id and never read them back — keep the dependency one-way. **Cross-store maths belongs in `useEnvelopes`, never in a provider.** `UNCATEGORIZED_BUDGET_ID` lives in `src/contexts/constants.js` for that reason.

- **`BudgetPlanContext`** — `plans` per (budget, period): the recurring **estimate**. `getPlannedCents` carries the most recent earlier plan forward.
- **`AssignmentsContext`** — `assignments` per (budget, period): what was **actually put in**. Does *not* carry forward (the balance does). Zero rows pruned; negatives allowed — under rollover that is the only way to pull money back out.
- **`BudgetsContext`** — `budgets` and `expenses`. Deleting a budget moves its expenses **and its assignments** onto `UNCATEGORIZED_BUDGET_ID` and drops its plans; dropping the funding instead would ask the user to fund the same purchase twice. `getBudgetTotalCents` / `getBudgetExpenses` / `totalSpentCents` are **all-time** — never mix them with period-scoped envelope figures on one screen.
- **`IncomeContext`** — `income` plus `totalIncomeCents` / `getPeriodIncome`. Deliberately **no** delete cascade: nothing maps income to the envelopes it funded. Deleting assigned income correctly drives "to be assigned" negative.
- **`AccountsContext`**, **`RetirementContext`** *(scaffolds)* — storage + CRUD only; derived math deliberately absent. Retirement is separate so the plan can be seeded from real figures without writing back to the books.

Mutators that can reject input (`addBudget`, `addExpense`, `addIncome`, `setPlannedAmount`, `setAssignedAmount`, `setPeriodAssignments`, `setBalance`) return `{ ok, error }`. **Callers must surface the error** — never close a modal as though the write succeeded. Each context memoises its value.

## Envelope budgeting (`src/hooks/useEnvelopes.js`)

The only place that reads across stores. `useEnvelopes(period)` returns one row per budget id plus the pool:

```
available(b, P) = Σ over p ≤ P of [ assigned(b,p) − spent(b,p) ]
carriedIn(b, P) = the same sum over p < P
toBeAssigned(P) = Σ over p ≤ P of [ income(p) − Σ over b of assigned(b,p) ]
```

**The invariant**, asserted after every mutation by the tripwire in `dataModel.test.js`:

```
toBeAssigned + Σ available === cumulative income − cumulative spend
```

The assignment terms cancel algebraically, so this checks coverage, not arithmetic. Two conditions keep it true:

1. **`rows` is the union** of budget ids, the Uncategorized sentinel, and every id appearing in `expenses` or `assignments`. Filtering what the *grid* renders is fine; filtering what the *sums* cover is not.
2. **Both sides use the same period filter.**

Also:

- **Undated records count in every period's cumulative sums.** On a row they fold into `carriedIn`, never `spentCents`, so the displayed figures add up to the displayed balance.
- **Future-dated records are excluded** until their month arrives — hence the ban on mixing these figures with all-time ones.
- **Rollover is the closed form above**, not a stored carry-in, so past periods are not immutable.
- **The day-one seed** in `AssignmentsContext` opens every category with an assignment equal to its existing spend, so a pre-existing ledger starts at zero envelopes with net cash unassigned. It runs in the **lazy default only**.
- **"Fill" tops a category up to its estimate outright**, ignoring carry-in, so sinking funds accumulate.

## UI conventions

Tailwind with the Gotham terminal palette and a dense type scale in `tailwind.config.js`. Take new colors from there — **never raw hex or default Tailwind colors**.

**Two surfaces, with text tokens named for the one they sit on.** Dark chrome (`ledger`, `panel`, `panel-raised`, `edge` hairlines) carries `chalk` / `chalk-soft`; the light mint data body inside it (`sheet`, `sheet-alt` zebra, `band` subtotals, `rule` hairlines) carries `ink` / `ink-soft`. Check which surface you are on before picking a token. Accents `azure` (figures, primary action), `verdant` (income, under budget), `vermilion` (expense, over budget), `sulfur` (active tab) are tuned for dark chrome and are too light for text on a light row — destructive actions in the sheet use `vermilion-ink`.

`font-sans` (IBM Plex Sans) for structure, `font-mono` (IBM Plex Mono) for figures, on `text-label` / `text-row` / `text-figure`. Currency goes through `formatCents`; columns of figures get `tabular-nums`. `CURRENCY` and `CURRENCY_LOCALE` are pinned together.

Shared components in `src/components/` — read the file before reusing one. Rules that are not visible from the call site:

- Every page starts with `PageHeader`, whose title is the page's only `<h1>`.
- `Button` `variant` names the surface: `primary` / `outline` / `danger` on dark chrome, `row` inside light data rows.
- `TallyGauge` treats a non-positive `max` as a zero ratio, so **callers must suppress it rather than pass one**.
- `BudgetCard` has **one** definition of trouble, `available < 0` — not a second rule about the estimate, which an envelope with carry-over can safely exceed.

`Add*Modal` forms are uncontrolled (`useRef` per field, read on submit), stay mounted, and toggle on a `show` prop. **Because they never unmount they must re-seed on open** — a `formRef` effect on `show` that calls `form.reset()`, clears the error, and re-applies defaults. Without it fields keep the previous entry and `<select>` `defaultValue` silently does nothing after first mount. `AssignIncomeModal` recomputes its live counter from `FormData` in one form-level `onChange` rather than holding state per row; its re-seed effect depends on `[show, period]` and deliberately **not** on the rows array.

## Testing

- jsdom 16 has no `<dialog>`; `src/setupTests.js` polyfills `showModal` / `show` / `close` and the `close` event. Guarded, so native support wins later.
- Tests seed pre-migration JSON into `localStorage` before `renderHook` and use the real `AppProviders`, exercising migrations and provider order rather than mocking them.
- **Any change to the envelope maths must keep the identity tripwire in `dataModel.test.js` green** — nothing else catches a row-set or cascade regression.
- Seeding the `expenses` key also fires the day-one assignment seed; to test spend with no funding, write an empty `assignments` key too.
- Modal regressions only appear across repeated open/close cycles, so drive them through a harness that mimics `TransactionsPage`.
