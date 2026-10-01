import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import TransactionsPage from "./TransactionsPage";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addMonths, currentPeriod } from "../utils";

/**
 * The register through the real stores, because an edit is only worth anything
 * if it lands: what this covers is the round trip a cell makes, which a
 * props-only test of the component cannot see. `TransactionRegister.test.js`
 * covers the cell contract itself.
 *
 * Wrapped in a router — the transaction modal points at the budget plan when
 * there is nothing to book against.
 */
const PERIOD = currentPeriod();

function seed(overrides = {}) {
  const data = {
    accounts: [
      {
        id: "acc1",
        name: "Everyday",
        type: "asset",
        scope: "on-budget",
        assetClass: "Cash",
        openingBalanceCents: 200000,
        openingDate: null,
        reconciledOn: null,
      },
    ],
    budgets: [
      { id: "b1", name: "Groceries", groupId: null, plannedCents: 60000, bucket: "essentials" },
      { id: "b2", name: "Fuel", groupId: null, plannedCents: 12000, bucket: "essentials" },
    ],
    transactions: [
      {
        id: "t1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Trader Joe's",
        amountCents: 7840,
        date: `${PERIOD}-11`,
        accountId: "acc1",
        budgetId: "b1",
      },
      {
        id: "t2",
        kind: TRANSACTION_KINDS.INFLOW,
        description: "Paycheck",
        amountCents: 214000,
        date: `${PERIOD}-09`,
        accountId: "acc1",
        budgetId: null,
      },
    ],
    // Written explicitly so the day-one seed does not open every category with
    // an assignment equal to its spend.
    assignments: [],
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
        <TransactionsPage />
      </MemoryRouter>
    </AppProviders>
  );
}

const ledger = () => JSON.parse(localStorage.getItem("transactions"));
const entry = (id) => ledger().find((transaction) => transaction.id === id);

beforeEach(() => {
  localStorage.clear();
});

test("the month's movements are the page, newest first", () => {
  seed();
  renderPage();

  // Newest first, so the entry just logged is where the eye already is.
  const dates = screen
    .getAllByRole("textbox")
    .map((input) => input.getAttribute("aria-label"))
    .filter((label) => label.startsWith("Description of "));
  expect(dates).toEqual(["Description of Trader Joe's", "Description of Paycheck"]);
});

test("what is left to assign is stated, and the flow it opens is reachable", () => {
  seed();
  renderPage();

  // $2,000 opening + $2,140 income, none of it assigned.
  expect(screen.getByText("$4,140")).toBeInTheDocument();
  expect(screen.getByText("Unassigned")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /assign income/i }));
  expect(screen.getByLabelText("Assign to Groceries")).toBeInTheDocument();
});

test("a category picked on the row lands in the ledger", () => {
  seed();
  renderPage();

  fireEvent.change(screen.getByLabelText("Category of Trader Joe's"), { target: { value: "b2" } });

  expect(entry("t1").budgetId).toBe("b2");
  expect(screen.getByLabelText("Category of Trader Joe's")).toHaveValue("b2");
});

test("a date typed on the row files it into that month", () => {
  seed();
  renderPage();

  const dateCell = screen.getByLabelText("Date of Trader Joe's");
  fireEvent.change(dateCell, { target: { value: `${PERIOD}-02` } });
  fireEvent.blur(dateCell);

  expect(entry("t1").date).toBe(`${PERIOD}-02`);
});

test("typing into the other column turns an expense into a refund, keeping the row", () => {
  seed();
  renderPage();

  const inCell = screen.getByLabelText("In for Trader Joe's");
  fireEvent.change(inCell, { target: { value: "78.40" } });
  fireEvent.blur(inCell);

  // Same category, same account, same date — an inflow filed against a
  // category is money going back into that envelope.
  expect(entry("t1")).toEqual({
    id: "t1",
    kind: TRANSACTION_KINDS.INFLOW,
    description: "Trader Joe's",
    amountCents: 7840,
    date: `${PERIOD}-11`,
    accountId: "acc1",
    toAccountId: null,
    budgetId: "b1",
  });
  expect(screen.getByLabelText("In for Trader Joe's")).toHaveValue("$78.40");
  expect(screen.getByLabelText("Out for Trader Joe's")).toHaveValue("");
});

test("a flip the books cannot take is refused on the row, not written", () => {
  seed();
  renderPage();

  // Income has no category, and an expense must name one. The store refuses it
  // and the register says which cell has to be answered first.
  const outCell = screen.getByLabelText("Out for Paycheck");
  fireEvent.change(outCell, { target: { value: "2140" } });
  fireEvent.blur(outCell);

  expect(screen.getByRole("alert")).toHaveTextContent(/category/i);
  expect(entry("t2").kind).toBe(TRANSACTION_KINDS.INFLOW);
  expect(screen.getByLabelText("Out for Paycheck")).toHaveValue("");
});

test("a legacy row can be corrected without being asked to invent the rest", () => {
  seed({
    transactions: [
      // Folded in from before the ledger tracked dates or accounts.
      {
        id: "t9",
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Old",
        amountCents: 2000,
        date: null,
        accountId: null,
        budgetId: "b1",
      },
    ],
  });
  renderPage();

  const description = screen.getByLabelText("Description of Old");
  fireEvent.change(description, { target: { value: "Parking, 2019" } });
  fireEvent.blur(description);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(entry("t9")).toMatchObject({ description: "Parking, 2019", date: null, accountId: null });
});

test("stepping the month changes what is on the register", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

  expect(screen.getByText(new RegExp(`nothing recorded in`, "i"))).toBeInTheDocument();
  expect(screen.queryByLabelText("Description of Trader Joe's")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByLabelText("Description of Trader Joe's")).toBeInTheDocument();
});

test("removing a row takes it out of the books", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Remove entry: Trader Joe's" }));

  expect(ledger()).toHaveLength(1);
  expect(screen.queryByLabelText("Description of Trader Joe's")).not.toBeInTheDocument();
});

test("an empty file renders the page rather than nothing at all", () => {
  renderPage();

  expect(screen.getByRole("heading", { level: 1, name: /transactions/i })).toBeInTheDocument();
  expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument();
  // The bar renders at zero rather than disappearing: it is the entry point to
  // the assign flow, not an overflow bucket.
  expect(screen.getByText("All assigned")).toBeInTheDocument();
});

test("an undated entry is reachable from whichever month is on screen", () => {
  seed({
    transactions: [
      {
        id: "t9",
        kind: TRANSACTION_KINDS.OUTFLOW,
        description: "Old",
        amountCents: 2000,
        date: null,
        accountId: "acc1",
        budgetId: "b1",
      },
    ],
  });
  renderPage();

  expect(screen.getByLabelText("Date of Old")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.getByLabelText("Date of Old")).toBeInTheDocument();

  // Giving it one files it, and it leaves the band for the month it names.
  const dateCell = screen.getByLabelText("Date of Old");
  const previous = addMonths(PERIOD, -1);
  fireEvent.change(dateCell, { target: { value: `${previous}-04` } });
  fireEvent.blur(dateCell);

  expect(entry("t9").date).toBe(`${previous}-04`);
  expect(screen.queryByRole("row", { name: /undated/i })).not.toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /Old/ })).getByLabelText("Date of Old")).toHaveValue(
    `${previous}-04`
  );
});

describe("transfers", () => {
  const accounts = [
    {
      id: "acc1",
      name: "Everyday",
      type: "asset",
      scope: "on-budget",
      assetClass: "Cash",
      openingBalanceCents: 200000,
      openingDate: null,
      reconciledOn: null,
    },
    {
      id: "sav",
      name: "Savings",
      type: "asset",
      scope: "on-budget",
      assetClass: "Cash",
      openingBalanceCents: 0,
      openingDate: null,
      reconciledOn: null,
    },
    {
      id: "brk",
      name: "Brokerage",
      type: "asset",
      scope: "off-budget",
      assetClass: "Equities",
      openingBalanceCents: 0,
      openingDate: null,
      reconciledOn: null,
    },
  ];

  const toBeAssigned = () => screen.getByText("To be assigned").nextElementSibling.textContent;

  function transfer({ to, amount }) {
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: `To ${to}` } });
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: to } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
  }

  test("between two on-budget accounts, the register shows it and the pool does not move", () => {
    seed({ accounts });
    renderPage();
    // $2,000 opening and $2,140 paid in, none of it assigned.
    expect(toBeAssigned()).toBe("$4,140");

    transfer({ to: "sav", amount: "300" });

    expect(toBeAssigned()).toBe("$4,140");
    expect(screen.getByLabelText("From account of To sav")).toHaveValue("acc1");
    expect(screen.getByLabelText("To account of To sav")).toHaveValue("sav");
    expect(screen.getByLabelText("Amount for To sav")).toHaveValue("$300");
    expect(screen.queryByText(/moved out this month/i)).toBeNull();
  });

  test("out to an off-budget account with no envelope, it comes out of the pool and says so", () => {
    seed({ accounts });
    renderPage();

    transfer({ to: "brk", amount: "500" });

    expect(toBeAssigned()).toBe("$3,640");
    expect(screen.getByText(/moved out this month/i).nextElementSibling).toHaveTextContent("$500");
    expect(entry(ledger().find((t) => t.kind === "transfer").id)).toMatchObject({
      accountId: "acc1",
      toAccountId: "brk",
      budgetId: null,
    });
  });

  test("re-pointing a transfer off budget from the register moves the pool", () => {
    seed({ accounts });
    renderPage();
    transfer({ to: "sav", amount: "300" });

    fireEvent.change(screen.getByLabelText("To account of To sav"), {
      target: { value: "brk" },
    });

    expect(toBeAssigned()).toBe("$3,840");
    // Now it crosses the budget's edge, so the row has an envelope to name.
    expect(screen.getByLabelText("Category of To sav")).toHaveValue("");
  });
});
