import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import ReportsPage from "./ReportsPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addMonths, currentPeriod, formatPeriod } from "../utils";

/**
 * The page through the real stores, as with the dashboard and the net-worth
 * page: every figure on it is a join across the ledger and the plan, and mocking
 * the hook would assert only that the mock was wired up.
 *
 * The range control gets driven in several of these, because it is the only
 * control on the page and everything moves with it together — the headline
 * figures, the columns, the ranking, and the divisor under every per-month
 * figure. A range that moved some of those and not others would look right in a
 * screenshot.
 */
const PERIOD = currentPeriod();
const monthsBack = (count) => addMonths(PERIOD, -count);

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 0,
  openingDate: null,
  reconciledOn: null,
};

let sequence = 0;
const entry = (kind) => (period, amountCents, budgetId = null) => ({
  id: `t${(sequence += 1)}`,
  kind,
  accountId: ACCOUNT.id,
  budgetId,
  amountCents,
  date: period == null ? null : `${period}-05`,
});
const out = entry(TRANSACTION_KINDS.OUTFLOW);
const inn = entry(TRANSACTION_KINDS.INFLOW);

function seed(data = {}) {
  const file = { accounts: [ACCOUNT], assignments: [], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <ReportsPage />
      </MemoryRouter>
    </AppProviders>
  );
}

const summary = () => screen.getByRole("region", { name: "Report summary" });

/** A `<dt>` takes no accessible name from its content, so a tile's figure is
 *  reached through its term's text and the element beside it. */
const tile = (label) =>
  within(summary()).getByText(label).nextElementSibling.textContent;

const pickRange = (label) => fireEvent.click(screen.getByRole("button", { name: label }));

beforeEach(() => {
  localStorage.clear();
});

test("an empty ledger sends the reader to the register rather than drawing an empty chart", () => {
  seed();
  renderPage();

  expect(screen.getByRole("link", { name: "Start the register" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Report summary" })).not.toBeInTheDocument();
});

describe("a year of books", () => {
  const setup = () =>
    seed({
      budgetGroups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
      budgets: [
        { id: "b1", name: "Rent", groupId: "g1", plannedCents: 100000, goalCents: null, bucket: null },
        { id: "b2", name: "Dining", groupId: null, plannedCents: 20000, goalCents: null, bucket: "fun" },
      ],
      transactions: [
        // Twelve months back, so the window is fully covered and the per-month
        // figures divide by the whole of it.
        ...Array.from({ length: 12 }, (_, index) => inn(monthsBack(11 - index), 500000)),
        ...Array.from({ length: 12 }, (_, index) => out(monthsBack(11 - index), 100000, "b1")),
        out(PERIOD, 60000, "b2"),
        inn(PERIOD, 10000, "b2"), // a refund against dining
      ],
    });

  test("the headline figures are the window's, net of refunds", () => {
    setup();
    renderPage();

    expect(tile("Income")).toBe("$60,000");
    // Twelve months of $1,000 rent, plus a $600 evening out less $100 a friend
    // paid back.
    expect(tile("Spending")).toBe("$12,500");
    expect(tile("Net")).toBe("$47,500");
    // The refund is not income, so it is not counted on both sides — and the
    // gross figure is stated beside the net rather than swallowed by it.
    expect(within(summary()).getByText("$12,600 out, $100 back")).toBeInTheDocument();
  });

  test("the categories are ranked by what they cost, with the plan's estimate beside them", () => {
    setup();
    renderPage();

    const rows = within(screen.getByText("Where the money went").closest("section")).getAllByRole(
      "row"
    );
    // Header, two categories, the footer. Rent is the bigger of the two and
    // comes first, though the plan lists it second — the ranking is the
    // report's own, not the plan's.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Rent");
    expect(rows[2]).toHaveTextContent("Dining");

    // Rent moved in every month of the window; dining in one. The same average
    // means different things at those two counts, which is why the row says.
    // Filed under the heading the plan files them under, including the heading
    // for the ones filed under nothing — the same word the plan itself uses.
    expect(rows[1]).toHaveTextContent("Bills · 12 of 12 months");
    expect(rows[2]).toHaveTextContent("Ungrouped · 1 of 12 months");
    // And the refund is stated on the row it came back to, so the figure beside
    // it is not quietly smaller than the register says.
    expect(rows[2]).toHaveTextContent("$100 back");
    // What it cost, and what that is a month. Rent is $1,000 either way;
    // dining's one $600 evening, less $100 back, amortises to $41.67.
    expect(rows[1]).toHaveTextContent("$12,000");
    expect(rows[1]).toHaveTextContent("$1,000");
    expect(rows[2]).toHaveTextContent("$41.67");
  });

  test("the month-by-month figures are readable as a table, not only off the chart", () => {
    setup();
    renderPage();

    fireEvent.click(screen.getByText("Show these figures as a table"));
    const rows = screen.getAllByRole("row").filter((row) => row.textContent.includes(formatPeriod(PERIOD)));

    // This month: $5,000 in; $1,000 of rent and $600 of dining less $100 back;
    // $3,500 left. The row shows its own arithmetic rather than asking to be
    // trusted, which is what the twin is for.
    expect(rows[0]).toHaveTextContent("$5,000");
    expect(rows[0]).toHaveTextContent("$1,500");
    expect(rows[0]).toHaveTextContent("$100");
    expect(rows[0]).toHaveTextContent("$3,500");
  });

  test("the range moves every figure on the page together", () => {
    setup();
    renderPage();

    expect(tile("Income")).toBe("$60,000");
    expect(screen.getByText(`${formatPeriod(monthsBack(11))} – ${formatPeriod(PERIOD)}`)).toBeInTheDocument();

    pickRange("3M");

    // Three months of the same income, and the ranking with it.
    expect(tile("Income")).toBe("$15,000");
    expect(screen.getByText(`${formatPeriod(monthsBack(2))} – ${formatPeriod(PERIOD)}`)).toBeInTheDocument();
    expect(
      within(screen.getByText("Where the money went").closest("section")).getByText(
        "Per month is over 3 months of records"
      )
    ).toBeInTheDocument();
  });
});

test("a window wider than the books says what it divided by", () => {
  seed({
    budgets: [{ id: "b1", name: "Rent", groupId: null, plannedCents: 0, goalCents: null, bucket: null }],
    transactions: [out(monthsBack(1), 100000, "b1"), out(PERIOD, 100000, "b1")],
  });
  renderPage();

  // Two months of records over a twelve-month window. Dividing by twelve would
  // report a household spending $1,000 a month as spending $167, silently.
  expect(
    screen.getByText(
      `Records start in ${formatPeriod(monthsBack(1))}, so per-month figures are divided by 2 rather than 12.`
    )
  ).toBeInTheDocument();
});

test("undated records are called out rather than quietly left out of every month", () => {
  seed({
    budgets: [{ id: "b1", name: "Rent", groupId: null, plannedCents: 0, goalCents: null, bucket: null }],
    transactions: [out(PERIOD, 100000, "b1"), out(null, 70000, "b1"), inn(null, 30000)],
  });
  renderPage();

  expect(screen.getByText("2 records have no date")).toBeInTheDocument();
  expect(screen.getByText(/\$700 of spending and \$300 of income/)).toBeInTheDocument();
  // And the chart genuinely does not carry them.
  expect(tile("Spending")).toBe("$1,000");
});
