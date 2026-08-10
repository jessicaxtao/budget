# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The Create React App project lives at the repo root (`src/`, `public/`, `package.json`). Run all commands from the repo root.

## Commands

- `npm start` — dev server (CRA) at http://localhost:3000, hot reload
- `npm test` — Jest + React Testing Library in watch mode. Non-interactive single file: `npm test -- --watchAll=false src/App.test.js`
- `npm run build` — production build to `build/`

No lint script beyond CRA's built-in ESLint (`eslintConfig` extends `react-app`), which runs during `npm start`/`npm test`.

## Architecture

A personal budgeting app with **no backend** — every store persists to `localStorage` through `useLocalStorage` (`src/hooks/useLocalStorage.js`), a hook shaped like `useState` that syncs to a given key as JSON. Single user, no auth.

`useLocalStorage` takes an optional third argument, `migrate`, applied to values read back from storage but never to the default. Because every provider wraps the whole app, the hook swallows everything storage can throw: corrupt JSON falls back to the default *and* clears the key so the failure cannot repeat forever, and a failed write never reaches the render. It also listens for `storage` events, so a second tab does not silently overwrite the first.

### Money and dates

Two rules hold across every store:

- **Money is an integer number of cents**, in a field named `…Cents` (`amountCents`, `plannedCents`). Never floating-point dollars — a ledger that disagrees with itself is worse than none. Convert user input with `toCents` and render with `formatCents` (`src/utils.js`); `toCents` returns `null` for anything unparseable, which is how contexts reject bad input instead of letting `NaN` reach storage as `null`.
- **Transactions carry a `date`** (`"YYYY-MM-DD"`, local calendar via `todayISO` — never `toISOString`, which is UTC). Periods are `"YYYY-MM"` and are always **derived** with `toPeriod`, never stored alongside the date, so the two cannot disagree. Records written before dates existed have `date: null` and display as "Undated" rather than being backfilled with invented history.

Migrations live next to the store that owns the key and are keyed on **field presence** (`"amount" in record`) rather than a version counter, which makes them self-describing and safe to re-run.

### Routing

`react-router-dom` v6, pinned deliberately: v7 exposes `react-router/dom` via package `exports`, which the Jest resolver bundled with react-scripts 5 cannot resolve. Both routers opt into v7 behavior through the shared `routerFuture` flags (`src/routerFuture.js`).

`src/navigation.js` is the single source of truth for pages — it feeds both the route table in `App.js` and the tab bar in `AppShell.js`. **Adding a page means adding one entry there**, not editing both. Unknown paths redirect to `/`.

`src/App.js` is only the shell (nav chrome + route outlet); each page owns its own state and modals.

### Pages (`src/pages/`)

| Route | Page | State |
| --- | --- | --- |
| `/` | Dashboard — holistic overview | scaffold |
| `/transactions` | Day-to-day income/expense ledger | **implemented** |
| `/plan` | Budget configuration over time | scaffold |
| `/reports` | Spending charts by category and over time | scaffold |
| `/net-worth` | Net worth over time, asset allocation | scaffold |
| `/retirement` | Retirement projection | scaffold |

Scaffold pages render `PageHeader` plus `Placeholder` sections listing the capabilities that section is meant to cover. When implementing one, replace its `Placeholder`s — the listed items are the intended scope.

### State management: five context providers

All composed in `src/contexts/AppProviders.js`, which `index.js` and the tests both wrap the app with. Add a store there, not in `index.js`. Every collection generates IDs with `uuid` v4 **in the context**, not in form components.

**Provider order matters.** `BudgetPlanProvider` sits outside `BudgetsProvider` so deleting a budget can take its plan history with it. Plans reference budgets by id and never read them back, so the dependency runs one way only — keep it that way.

- **`BudgetPlanContext`** — `plans` (`id`, `budgetId`, `period`, `plannedCents`), one per (budget, period). **The single source of truth for what a category may spend**; budgets deliberately carry no `max` of their own. `getPlannedCents(budgetId, period)` returns that period's plan or carries the most recent earlier one forward, which is what makes one stored limit sufficient. `setPlannedAmount` upserts.
- **`BudgetsContext`** — `budgets` (`id`, `name`) and `expenses` (`id`, `description`, `amountCents`, `budgetId`, `date`). Deleting a budget reassigns its expenses to the `UNCATEGORIZED_BUDGET_ID` sentinel rather than deleting them — expenses are what actually happened — and drops its plans. Exposes pre-grouped `getBudgetTotalCents` / `getBudgetExpenses` and `totalSpentCents`; use those rather than re-scanning `expenses` per budget.
- **`IncomeContext`** — `income` (`id`, `description`, `amountCents`, `date`), plus `totalIncomeCents` and `getPeriodIncome`.
- **`AccountsContext`** *(scaffold)* — `accounts` (assets/liabilities, tagged with an asset class) and `balances`, one hand-entered `amountCents` per (account, period). Deleting an account drops its balances.
- **`RetirementContext`** *(scaffold)* — a single `assumptions` object. Kept separate on purpose: the plan may be *seeded* from real budget/net-worth figures but editing it must never write back to the books. `null` fields mean "fall back to the real number".

Mutators that can reject input (`addBudget`, `addExpense`, `addIncome`, `setPlannedAmount`, `setBalance`) return `{ ok, error }` rather than failing silently. Callers must surface the error — closing a modal as though the write succeeded is the one option that cannot be right. Each context memoises its value, so a change in one store does not re-render consumers of the others.

The scaffold contexts are storage + CRUD only; derived math (allocation, projections) is deliberately not implemented.

### UI conventions

Tailwind, with a spreadsheet-derived palette and dense type scale defined in `tailwind.config.js`. Use these tokens rather than raw hex or default Tailwind colors.

**Two surfaces, and text tokens named for the one they sit on.** A dark chrome (`ledger` page, `panel` cards, `edge` hairlines) carries `chalk`/`chalk-soft` text; inverted inside it, a near-white data body (`sheet`, `sheet-alt` zebra, `band` subtotals, `rule` hairlines) carries `ink`/`ink-soft`. Pairing text with the wrong surface is meant to be visible at the call site — check which one you are on before picking a token. Accents `azure` (figures, primary action), `verdant` (income, under budget), `vermilion` (expense, over budget) and `sulfur` (active tab) are tuned for the dark chrome and are too light to carry text on a white row; destructive actions inside the sheet use `vermilion-ink` instead.

Type is `font-sans` (IBM Plex Sans) for structure and `font-mono` (IBM Plex Mono) for figures, on a three-step scale — `text-label` (uppercase column heads), `text-row` (data), `text-figure` (card totals).

Currency renders through `formatCents` in `src/utils.js`; monetary figures are set in `font-mono`, and columns of them get `tabular-nums`. `CURRENCY` and `CURRENCY_LOCALE` are pinned together — the app books one currency, and leaving the locale to the viewer's machine while hardcoding the symbol produced a mismatched format.

Shared components (`src/components/`):

- `AppShell` — masthead + tab nav, wraps every page
- `PageHeader` — eyebrow / title / description / actions; every page starts with one, and the title is the page's only `<h1>`
- `Placeholder` — dashed "Not built" panel with a list of intended capabilities
- `Button` — `variant` named for the job and the surface it belongs on: `primary` / `outline` / `danger` on dark chrome, `row` inside light data rows. `size` is `sm` | `md`.
- `Dialog` — native `<dialog>` with `showModal()`, backdrop-click to close
- `Field` — underlined label + input, takes `inputRef`
- `TallyGauge` — tick progress meter that shifts toward `vermilion` as it fills
- `LedgerList` — the shared expense/income table (description, date, amount, remove). Both record types are the same shape, so they share one table rather than two that drift apart; it reads `amountCents` and renders a null `date` as "Undated".
- `BudgetCard` — shared card taking `amountCents` / `maxCents`, reused by `TotalBudgetCard` and `UncategorizedBudgetCard`, which return `null` when there is nothing to show. `IncomeBudgetCard` always renders: income is a standing part of the ledger rather than an overflow bucket, and hiding it would take the only "Add income" control on the card grid with it.

`Add*Modal` components are uncontrolled forms using a `useRef` per field, read on submit — not controlled inputs. `View*Modal` components list entries with delete actions, pulling from the relevant context. Modals stay mounted and are toggled by a `show` prop rather than conditionally rendered.

**Because modals never unmount, they must re-seed themselves on open.** Each `Add*Modal` holds a `formRef` and runs an effect on `show` that calls `form.reset()`, clears any error, and re-applies defaults. Without it, fields keep the previous entry, and `defaultValue` on a `<select>` silently does nothing after the first mount — which is how "Add expense" on a budget card used to file everything under Uncategorized.

### Testing

jsdom 16 (bundled with react-scripts 5) implements no `<dialog>` at all, so `src/setupTests.js` polyfills `showModal` / `show` / `close` — including the `close` event `Dialog` subscribes to. Without it every modal test dies on `showModal is not a function`. The polyfill is guarded, so a future jsdom with native support wins.

Modal regressions only appear across repeated open/close cycles on a persistently mounted component, so drive them through a small harness that mimics `TransactionsPage` rather than rendering the modal once with fixed props.
