import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import DashboardPage from "./DashboardPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addDays, currentPeriod, formatDateLong, formatDateMedium, todayISO } from "../utils";

/**
 * The dashboard through the real stores, because almost everything on it is
 * derived across several of them and a page test that mocked them would only
 * assert that the mocks were wired up.
 *
 * Wrapped in a router: the empty states and the pay-schedule tile link to the
 * budget plan.
 */
const PERIOD = currentPeriod();
const TODAY = todayISO();

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 200000,
  openingDate: null,
  reconciledOn: null,
};

function seed(overrides = {}) {
  const data = {
    accounts: [ACCOUNT],
    budgetGroups: [{ id: "g1", name: "Bills", bucket: "essentials" }],
    budgets: [
      { id: "b1", name: "Rent", groupId: "g1", plannedCents: 150000, bucket: null },
      {
        id: "b2",
        name: "Groceries",
        groupId: null,
        plannedCents: 60000,
        bucket: null,
        goalCents: 250000,
      },
    ],
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc1",
        budgetId: "b1",
        amountCents: 120000,
        date: `${PERIOD}-03`,
        description: "August rent",
      },
    ],
    assignments: [{ id: "as1", budgetId: "b1", period: PERIOD, assignedCents: 150000 }],
    ...overrides,
  };

  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPage() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <DashboardPage />
      </MemoryRouter>
    </AppProviders>
  );
}

/** The row of a table whose first cell holds this name. */
const row = (name) => screen.getByRole("rowheader", { name }).closest("tr");

beforeEach(() => {
  localStorage.clear();
});

test("states today's date, since every figure on the page is as of today", () => {
  seed();
  renderPage();

  expect(screen.getByText(formatDateLong(TODAY))).toBeInTheDocument();
});

test("the headline figures are this month's, not all time", () => {
  seed();
  renderPage();

  const tile = (label) => screen.getByText(label).closest("div");

  // 200,000 opening − 150,000 assigned. Nothing has come in this month.
  expect(within(tile("Available to budget")).getByText("$500")).toBeInTheDocument();
  expect(within(tile("Budgeted this month")).getByText("$1,500")).toBeInTheDocument();
  expect(within(tile("Spent this month")).getByText("$1,200")).toBeInTheDocument();
});

test("categories are grouped, with the figures on each row", () => {
  seed();
  renderPage();

  expect(screen.getByRole("columnheader", { name: "Goal" })).toBeInTheDocument();

  const rent = within(row("Rent"));
  expect(rent.getByText("$300")).toBeInTheDocument(); // available
  expect(rent.getAllByText("$1,500")).toHaveLength(2); // budgeted, and target
  // Signed, so the row adds up as it reads: $0 carried in + $1,500 − $1,200.
  expect(rent.getByText("-$1,200")).toBeInTheDocument();
  // Nothing being saved towards here, which is a dash rather than $0.
  expect(rent.getAllByText("—")).toHaveLength(1);

  // A category with no funding and no spend still appears, at zero.
  const groceries = within(row("Groceries"));
  expect(groceries.getAllByText("$0").length).toBeGreaterThan(0);
  expect(groceries.getByText("$600")).toBeInTheDocument(); // its target
  // The goal set for it on the budget plan, carried through to the row.
  expect(groceries.getByText("$2,500")).toBeInTheDocument();

  expect(screen.getByRole("columnheader", { name: "Bills" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Ungrouped" })).toBeInTheDocument();
});

test("a refund shows on the category's row as the net of the month", () => {
  seed({
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        accountId: "acc1",
        budgetId: "b2",
        amountCents: 10000,
        date: `${PERIOD}-03`,
        description: "Dinner",
      },
      {
        id: "t2",
        kind: TRANSACTION_KINDS.INFLOW,
        accountId: "acc1",
        budgetId: "b2",
        amountCents: 6000,
        date: `${PERIOD}-04`,
        description: "Their half",
      },
    ],
    assignments: [{ id: "as1", budgetId: "b2", period: PERIOD, assignedCents: 10000 }],
  });
  renderPage();

  // $100 out, $60 back: groceries cost the household $40 this month.
  expect(within(row("Groceries")).getByText("-$40")).toBeInTheDocument();
});

test("an account shows what it holds and when it last agreed with the bank", () => {
  seed();
  renderPage();

  // 200,000 opening − 120,000 spent through it.
  expect(screen.getByText("$800")).toBeInTheDocument();
  expect(screen.getByText(/Never/)).toBeInTheDocument();
  expect(screen.getByText("1 need checking")).toBeInTheDocument();
});

test("reconciling stamps today without touching the balance", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Mark Everyday reconciled" }));

  expect(screen.getByText(new RegExp(formatDateMedium(TODAY)))).toBeInTheDocument();
  expect(screen.getByText("All up to date")).toBeInTheDocument();
  expect(screen.getByText("$800")).toBeInTheDocument();
});

test("the paycheck tile counts down once a schedule is set", () => {
  seed({ paySchedule: { lastPaidOn: addDays(TODAY, -4), periodDays: 14 } });
  renderPage();

  expect(screen.getByText("in 10 days")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(formatDateMedium(addDays(TODAY, 10))))).toBeInTheDocument();
});

test("with no schedule the tile points at where one is set rather than guessing", () => {
  seed();
  renderPage();

  expect(screen.getByRole("link", { name: /set a pay schedule/i })).toHaveAttribute("href", "/plan");
});

test("an empty file renders the page rather than a wall of zeroes with no way out", () => {
  renderPage();

  expect(screen.getByRole("link", { name: /add one on the budget plan/i })).toBeInTheDocument();
  expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
});
