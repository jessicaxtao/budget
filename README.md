# Budget App

This budget app allows you to keep track of your money.

It runs entirely in your browser. There is no backend, no account, and no sign-up
— every figure you enter is stored in that browser's `localStorage` and never
leaves the machine. Clearing site data clears the books.

## Getting started

```sh
npm install
npm start        # dev server at http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm start` | Development server with hot reload |
| `npm test` | Jest + React Testing Library, watch mode |
| `npm test -- --watchAll=false` | Single non-interactive run |
| `npm run build` | Production build into `build/` |

Built with Create React App (react-scripts 5), React 18, React Router 6 and
Tailwind CSS 3. Linting is CRA's built-in ESLint, which runs as part of
`npm start` and `npm test` — there is no separate lint script.

## Current features — V0.2

- Set custom categories [0.1]
- Add and delete expenses [0.1]
- Add and delete incomes [0.2]
- A planned amount per category *per month*, so a limit set in one month carries
  forward until you change it rather than needing to be re-entered
- Deleting a category keeps its expenses, reassigning them to **Uncategorized** —
  what you spent is a matter of record, and only the label was wrong

Everything above lives on the **Transactions** page. The app's other five
sections — Dashboard, Plan, Reports, Net worth and Retirement — are scaffolded:
each renders the list of capabilities it is meant to cover, so the intended scope
is visible before the section is built.

## How the data is kept

Two rules hold everywhere, and are worth knowing before contributing:

- **Money is stored as an integer number of cents**, never as floating-point
  dollars. A ledger that disagrees with itself is worse than no ledger.
- **Transactions carry a plain `YYYY-MM-DD` date** on the local calendar, and the
  month is always derived from it rather than stored next to it, so the two
  cannot drift apart.

Records written by earlier versions are migrated on read, and entries predating
dates are shown as "Undated" rather than backfilled with invented history.

## Coming soon

- Zero based budget method
    - Figure out starting point [0.3]
    - Budgeting new money as it comes in [0.4]
    - Allowing you to move money between categories [0.5]
    - Auto Assign [0.6]
- Saving and importing your information through csv file [0.8]
- Saving your information through signing up [1.0]

## Roadmap

### Near term

- Saving goals
- Starting point / net worth tracking

### Medium Term

- Charts - income vs expenses, starting vs end balance, spending by category
- Transfers
- Resetting per month
- Big goals (retirement, debt, etc.)
- Next paycheck
- Loan calculator

### Long Term

- Beer money
- Donations
- Credit Score tracking
- Investment tracking
- Monthly and Yearly history, spending by category by month etc.
- Tax calculator
- Mobile apps

Feature research behind this roadmap — what users of comparable budgeting apps
ask for and complain about — is collected in [`docs/feature-research.md`](docs/feature-research.md).

## Contributing

Architecture notes, conventions and the reasoning behind them are in
[`.claude/CLAUDE.md`](.claude/CLAUDE.md).
