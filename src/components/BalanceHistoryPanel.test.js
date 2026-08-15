import { fireEvent, render, screen, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import BalanceHistoryPanel, { HISTORY_MONTHS } from "./BalanceHistoryPanel";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { addMonths, currentPeriod, formatPeriod } from "../utils";

/**
 * Through the real stores, like the pages: what this grid shows in an empty cell
 * is a join across the accounts, their snapshots and the ledger, and a mocked
 * hook would assert only that the mock was wired up.
 *
 * The blank cell is the whole contract. A blank is a month nobody recorded, and
 * what fills it in differs by account — the books for one the budget spends
 * through, the figure above for one valued by hand. A grid that seeded those
 * cells with the value they inherit would turn one statement into twelve records
 * of it, which is the regression these are here to catch.
 */
const PERIOD = currentPeriod();
const OLDEST = addMonths(PERIOD, -(HISTORY_MONTHS - 1));

const account = (fields) => ({
  id: fields.name,
  type: "asset",
  scope: "off-budget",
  assetClass: "Stocks",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
  ...fields,
});

const EVERYDAY = account({
  name: "Everyday",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 400000,
});

const BROKERAGE = account({ name: "401(k)", openingBalanceCents: 1000000 });

function renderPanel(data = {}) {
  const file = { accounts: [EVERYDAY, BROKERAGE], assignments: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  render(
    <AppProviders>
      <BalanceHistoryPanel />
    </AppProviders>
  );
  fireEvent.click(screen.getByText("Balance history"));
}

// A textbox rather than a number field: these figures are copied off statements,
// where they are written "$12,500.00", and `type="number"` refuses that outright.
const cell = (name, period) =>
  screen.getByRole("textbox", { name: `${name}, ${formatPeriod(period)}` });

/** The month's row, by the heading that names it. */
const row = (period) => screen.getByRole("rowheader", { name: formatPeriod(period) }).closest("tr");

const stored = () => JSON.parse(localStorage.getItem("accountBalances"));

beforeEach(() => {
  localStorage.clear();
});

test("every account has a column, the everyday one included", () => {
  renderPanel();

  // Before the books opened the ledger has nothing to say about the current
  // account either, so a history that skipped it would draw a flat line where
  // the household's cash used to be.
  expect(cell("Value of Everyday", PERIOD)).toBeInTheDocument();
  expect(cell("Value of 401(k)", PERIOD)).toBeInTheDocument();
});

test("covers a year, oldest first, ending at this month", () => {
  renderPanel();

  const rows = screen.getAllByRole("rowheader");
  expect(rows).toHaveLength(HISTORY_MONTHS);
  expect(rows[0]).toHaveTextContent(formatPeriod(OLDEST));
  expect(rows[HISTORY_MONTHS - 1]).toHaveTextContent(formatPeriod(PERIOD));
});

test("stepping earlier moves the whole window; there is nothing later than this month", () => {
  renderPanel();

  expect(screen.getByRole("button", { name: "Later months" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Earlier months" }));

  expect(
    screen.getByRole("rowheader", { name: formatPeriod(addMonths(PERIOD, -HISTORY_MONTHS)) })
  ).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: formatPeriod(PERIOD) })).not.toBeInTheDocument();
  // Back within reach, so the window can be walked forward again.
  expect(screen.getByRole("button", { name: "Later months" })).toBeEnabled();
});

test("a typed month is recorded and the months around it are left unrecorded", () => {
  renderPanel();

  fireEvent.change(cell("Value of 401(k)", OLDEST), { target: { value: "12000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  // One record from a grid of a hundred and forty-four cells: a blank is not a
  // zero and not a copy of the figure it inherits.
  expect(stored()).toEqual([
    { id: expect.any(String), accountId: "401(k)", period: OLDEST, amountCents: 1200000 },
  ]);
});

test("a figure is taken as it is written, and put back as money", () => {
  renderPanel();

  // Copied off a statement rather than retyped as a bare number. A number field
  // would refuse this outright — the cell would look filled and read back empty.
  fireEvent.change(cell("Value of 401(k)", OLDEST), { target: { value: "$12,000.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(stored()).toEqual([
    { id: expect.any(String), accountId: "401(k)", period: OLDEST, amountCents: 1200050 },
  ]);

  // And a figure typed bare comes to rest formatted, so the column reads as one
  // series whichever way each month was entered.
  const cash = cell("Value of Everyday", OLDEST);
  fireEvent.change(cash, { target: { value: "4200.5" } });
  fireEvent.blur(cash);
  expect(cash).toHaveValue("$4,200.50");
});

test("a hand-valued holding carries its figure down the blank months below it", () => {
  renderPanel();

  fireEvent.change(cell("Value of 401(k)", OLDEST), { target: { value: "12000" } });

  // Every later month reads as $12,000 without a record being invented for it —
  // the field is still empty, and only hints at what it is inheriting.
  expect(cell("Value of 401(k)", PERIOD)).toHaveValue("");
  expect(cell("Value of 401(k)", PERIOD)).toHaveAttribute("placeholder", "$12,000");
  // Cash of $4,000 alongside it, so the row is the whole net worth.
  expect(within(row(PERIOD)).getByText("$16,000")).toBeInTheDocument();
});

test("an account the budget spends through falls back to that month's books, not to the row above", () => {
  renderPanel({
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "Everyday",
        budgetId: null,
        amountCents: 50000,
        date: `${PERIOD}-04`,
      },
    ],
  });

  // The ledger answers each month for itself: $4,000 before the spend, $3,500
  // after it. A statement figure typed into one month must never stand in for a
  // month the books can answer — that would freeze the account.
  expect(cell("Value of Everyday", OLDEST)).toHaveAttribute("placeholder", "$4,000");
  expect(cell("Value of Everyday", PERIOD)).toHaveAttribute("placeholder", "$3,500");

  fireEvent.change(cell("Value of Everyday", OLDEST), { target: { value: "9000" } });

  expect(cell("Value of Everyday", PERIOD)).toHaveAttribute("placeholder", "$3,500");
  expect(within(row(OLDEST)).getByText("$19,000")).toBeInTheDocument();
});

test("an existing snapshot seeds only its own month", () => {
  const month = addMonths(PERIOD, -2);
  renderPanel({
    accountBalances: [{ id: "bal1", accountId: "401(k)", period: month, amountCents: 1250000 }],
  });

  // Money at rest, so the recorded month reads as the greyed figures around it
  // rather than as a bare number in a column of them.
  expect(cell("Value of 401(k)", month)).toHaveValue("$12,500");
  expect(cell("Value of 401(k)", PERIOD)).toHaveValue("");
});

test("clearing a recorded month takes the record back out", () => {
  const month = addMonths(PERIOD, -2);
  renderPanel({
    accountBalances: [{ id: "bal1", accountId: "401(k)", period: month, amountCents: 1250000 }],
  });

  fireEvent.change(cell("Value of 401(k)", month), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(stored()).toEqual([]);
});

test("a debt is entered as the amount owed and stored signed", () => {
  renderPanel({
    accounts: [account({ name: "Mortgage", type: "liability", assetClass: "Real estate" })],
  });

  fireEvent.change(cell("Amount owed on Mortgage", PERIOD), { target: { value: "250000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(stored()[0].amountCents).toBe(-25000000);
  // And read back the way a statement reads it: owed, positive, subtracting from
  // the net beside it.
  expect(within(row(PERIOD)).getByText("-$250,000")).toBeInTheDocument();
});

test("without an account it says what to add rather than showing an empty grid", () => {
  renderPanel({ accounts: [] });

  expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
});
