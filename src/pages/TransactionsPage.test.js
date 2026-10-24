import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import TransactionsPage from "./TransactionsPage";
import DashboardPage from "./DashboardPage";
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

function HistoryControls() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Go back</button>;
}

function renderPage(initialEntry = "/transactions") {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture} initialEntries={[initialEntry]}>
        <HistoryControls />
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

describe("finding transactions", () => {
  const transaction = (id, fields = {}) => ({
    id, description: id, kind: TRANSACTION_KINDS.OUTFLOW,
    amountCents: 1000, date: `${PERIOD}-05`, accountId: "acc1", budgetId: "b1",
    ...fields,
  });
  const account = (id, fields = {}) => ({
    id, name: id, type: "asset", scope: "on-budget", assetClass: "Cash",
    openingBalanceCents: 0, openingDate: null, reconciledOn: null, ...fields,
  });
  const visibleNotes = () => screen.queryAllByRole("textbox")
    .map((input) => input.getAttribute("aria-label"))
    .filter((label) => label?.startsWith("Note on "));

  test.each([
    ["View transactions for account: Everyday", "Account", "acc1"],
    ["Groceries transactions", "Category", "b1"],
  ])("the dashboard shortcut %s opens the full history", (linkName, filterName, value) => {
    seed({ transactions: [transaction("Older", { date: `${addMonths(PERIOD, -2)}-04` })] });
    localStorage.setItem("dashboardBudgetExplainerDismissed", "true");
    render(
      <AppProviders>
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>
    );
    fireEvent.click(screen.getByRole("link", { name: linkName }));
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: filterName })).toHaveValue(value);
    expect(screen.getByRole("button", { name: "All dates" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Note on Older")).toBeInTheDocument();
  });

  test("all dates includes older and undated entries; the month selector narrows them again", () => {
    seed({ transactions: [transaction("Current"), transaction("Older", { date: `${addMonths(PERIOD, -1)}-04` }), transaction("Legacy", { date: null })] });
    renderPage();
    expect(visibleNotes()).toEqual(["Note on Current", "Note on Legacy"]);
    fireEvent.click(screen.getByRole("button", { name: "All dates" }));
    expect(visibleNotes()).toEqual(["Note on Current", "Note on Older", "Note on Legacy"]);
    fireEvent.click(screen.getByRole("button", { name: "By month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(visibleNotes()).toEqual(["Note on Older", "Note on Legacy"]);
  });

  test("an account link includes incoming and outgoing transfers, including archived history", () => {
    seed({
      accounts: [account("acc1"), account("acc2", { archived: true }), account("acc3")],
      transactions: [
        transaction("Purchase", { accountId: "acc2" }),
        transaction("Incoming", { kind: TRANSACTION_KINDS.TRANSFER, toAccountId: "acc2", budgetId: null }),
        transaction("Outgoing", { kind: TRANSACTION_KINDS.TRANSFER, accountId: "acc2", toAccountId: "acc3", budgetId: null }),
        transaction("Unrelated"),
        transaction("Former transfer", { toAccountId: "acc2" }),
      ],
    });
    renderPage("/transactions?account=acc2&dates=all");
    expect(screen.getByRole("combobox", { name: "Account" })).toHaveValue("acc2");
    expect(screen.getByRole("option", { name: "acc2 (archived)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note on Purchase")).toBeInTheDocument();
    expect(screen.getByLabelText("Transferred to, for Incoming")).toBeInTheDocument();
    expect(screen.getByLabelText("Transferred from, for Outgoing")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Unrelated")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Former transfer")).not.toBeInTheDocument();
  });

  test("category filters read split parts, refunds and effective transfer categories; filters combine and clear", () => {
    seed({
      accounts: [account("acc1"), account("acc2"), account("investment", { scope: "off-budget" })],
      transactions: [
        transaction("Groceries"),
        transaction("Refund", { kind: TRANSACTION_KINDS.INFLOW }),
        transaction("Split", { budgetId: "b2", splits: [{ budgetId: "b1", amountCents: 400 }, { budgetId: "b2", amountCents: 600 }] }),
        transaction("Stale category", { splits: [{ budgetId: "b2", amountCents: 400 }, { budgetId: "b2", amountCents: 600 }] }),
        transaction("Invested", { kind: TRANSACTION_KINDS.TRANSFER, toAccountId: "investment" }),
        transaction("Internal", { kind: TRANSACTION_KINDS.TRANSFER, toAccountId: "acc2" }),
        transaction("Withdrawal", { kind: TRANSACTION_KINDS.TRANSFER, accountId: "investment", toAccountId: "acc1" }),
        transaction("Other account", { accountId: "acc2" }),
      ],
    });
    renderPage("/transactions?category=b1&dates=all");
    expect(screen.getByRole("status")).toHaveTextContent("Matching split transactions show their full amount.");
    expect(screen.getByLabelText("Note on Refund")).toBeInTheDocument();
    expect(screen.getByLabelText("Split of Split, 2 parts")).toBeInTheDocument();
    expect(screen.getByLabelText("Transferred to, for Invested")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Stale category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Transferred to, for Internal")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Transferred to, for Withdrawal")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "acc1" } });
    expect(screen.queryByLabelText("Note on Other account")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("combobox", { name: "Account" })).toHaveValue("acc1");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("b1");
    expect(screen.getByRole("status")).toHaveTextContent("Matching split transactions show their full amount.");
  });

  test("an empty filter can be cleared without losing the ledger", () => {
    seed();
    renderPage("/transactions?category=b2&dates=all");
    expect(screen.getByText("No transactions match these filters.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Matching split transactions show their full amount.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();
  });
});

test("the month's movements are the page, newest first", () => {
  seed();
  renderPage();

  // Newest first, so the entry just logged is where the eye already is.
  const dates = screen
    .getAllByRole("textbox")
    .map((input) => input.getAttribute("aria-label"))
    .filter((label) => label.startsWith("Note on "));
  expect(dates).toEqual(["Note on Trader Joe's", "Note on Paycheck"]);
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

test("a typed sign changes an expense into a refund without replacing its row", () => {
  seed();
  renderPage();

  expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
  expect(screen.getByLabelText("Amount for Trader Joe's")).toHaveValue("$78.40");
  const amount = screen.getByLabelText("Amount for Trader Joe's");
  fireEvent.change(amount, { target: { value: "+78.40" } });
  fireEvent.blur(amount);

  // Same category, same account, same date — an inflow filed against a
  // category is money going back into that envelope.
  expect(entry("t1")).toEqual({
    id: "t1",
    kind: TRANSACTION_KINDS.INFLOW,
    // A row seeded before payees existed names nobody, and a direction flip is no
    // occasion to invent one.
    payeeId: null,
    description: "Trader Joe's",
    amountCents: 7840,
    date: `${PERIOD}-11`,
    accountId: "acc1",
    toAccountId: null,
    splits: null,
    budgetId: "b1",
  });
  expect(screen.getByLabelText("Amount for Trader Joe's")).toHaveValue("$78.40");
  expect(screen.queryByRole("button", { name: /Change Trader Joe's to money/ })).not.toBeInTheDocument();
});

test("a flip the books cannot take is refused on the row, not written", () => {
  seed();
  renderPage();

  // Income has no category, and an expense must name one. The store refuses it
  // and the register says which field has to be answered first.
  const amount = screen.getByLabelText("Amount for Paycheck");
  fireEvent.change(amount, { target: { value: "-2140" } });
  fireEvent.blur(amount);

  expect(screen.getByRole("alert")).toHaveTextContent(/category/i);
  expect(entry("t2").kind).toBe(TRANSACTION_KINDS.INFLOW);
  expect(screen.getByLabelText("Amount for Paycheck")).toHaveValue("$2,140");
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

  const description = screen.getByLabelText("Note on Old");
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
  expect(screen.queryByLabelText("Note on Trader Joe's")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();
});

test("removing a row takes it out of the books", () => {
  seed();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Remove entry: Trader Joe's" }));

  expect(ledger()).toHaveLength(1);
  expect(screen.queryByLabelText("Note on Trader Joe's")).not.toBeInTheDocument();
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

describe("a transfer on the register", () => {
  const ACCOUNTS = [
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
      id: "acc2",
      name: "Visa",
      type: "liability",
      scope: "credit-card",
      assetClass: "Other",
      openingBalanceCents: -20000,
      openingDate: null,
      reconciledOn: null,
    },
    {
      id: "acc3",
      name: "401(k)",
      type: "asset",
      scope: "off-budget",
      assetClass: "Stocks",
      openingBalanceCents: 1000000,
      openingDate: null,
      reconciledOn: null,
    },
  ];

  const PAYMENT = {
    id: "t3",
    kind: TRANSACTION_KINDS.TRANSFER,
    description: "Card payment",
    amountCents: 20000,
    date: `${PERIOD}-12`,
    accountId: "acc1",
    toAccountId: "acc2",
    budgetId: null,
  };

  function seedWithTransfer(transfer = PAYMENT) {
    seed({ accounts: ACCOUNTS, transactions: [transfer] });
  }

  test("re-pointing the destination lands in the ledger", () => {
    seedWithTransfer();
    renderPage();

    fireEvent.change(screen.getByLabelText("Transferred to, for Card payment"), {
      target: { value: "acc3" },
    });

    expect(entry("t3").toAccountId).toBe("acc3");
    expect(screen.getByLabelText("Transferred to, for Card payment")).toHaveValue("acc3");
  });

  test("a destination that would make both ends the same is refused on the row", () => {
    seedWithTransfer();
    renderPage();

    // The only way to reach it from here is the source select, since the
    // destination list never offers the account the row already leaves.
    fireEvent.change(screen.getByLabelText("Transferred from, for Card payment"), {
      target: { value: "acc2" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/two different accounts/i);
    expect(entry("t3").accountId).toBe("acc1");
  });

  test("what is left to assign does not move when a card is paid off", () => {
    // $2,000 opening on the everyday account less $200 owed on the card, and
    // nothing assigned.
    seedWithTransfer();
    renderPage();

    expect(screen.getByText("$1,800")).toBeInTheDocument();

    const out = screen.getByLabelText("Amount for Card payment");
    fireEvent.change(out, { target: { value: "250" } });
    fireEvent.blur(out);

    // The figure changed and the pool did not: the money was budgeted on its way
    // out through the card, so settling it is not a second call on the plan.
    expect(entry("t3").amountCents).toBe(25000);
    expect(screen.getByText("$1,800")).toBeInTheDocument();
  });

  test("a contribution comes out of the category named on its row", () => {
    seedWithTransfer({
      ...PAYMENT,
      description: "Contribution",
      toAccountId: "acc3",
      budgetId: "b1",
    });
    renderPage();

    // $2,000 opening, less $200 owed, less the $200 that left for the holding.
    expect(screen.getByText("$1,800")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category of Contribution"), {
      target: { value: "b2" },
    });

    expect(entry("t3").budgetId).toBe("b2");
  });
});

describe("dividing a row already in the ledger", () => {
  const RECEIPT = {
    id: "t3",
    kind: TRANSACTION_KINDS.OUTFLOW,
    description: "Costco",
    amountCents: 12400,
    date: `${PERIOD}-14`,
    accountId: "acc1",
    budgetId: null,
    splits: [
      { id: "p1", budgetId: "b1", amountCents: 9000 },
      { id: "p2", budgetId: "b2", amountCents: 3400 },
    ],
  };

  const type = (label, value) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  test("the editor opens seeded on what the row already says, and the division lands", () => {
    seed();
    renderPage();

    fireEvent.change(screen.getByLabelText("Category of Trader Joe's"), {
      target: { value: "__split__" },
    });

    // One part, holding the whole, filed where the record is filed now — the
    // honest starting state, and the one that makes "left to split" appear as
    // the first part is typed down.
    expect(screen.getByLabelText("Category of part 1")).toHaveValue("b1");
    expect(screen.getByLabelText("Amount of part 1")).toHaveValue("$78.40");

    type("Amount of part 1", "50");
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));
    expect(screen.getByLabelText("Amount of part 2")).toHaveValue("$28.40");
    type("Category of part 2", "b2");
    fireEvent.click(screen.getByRole("button", { name: "Save the split" }));

    expect(entry("t1").amountCents).toBe(7840);
    expect(entry("t1").splits).toEqual([
      { id: expect.any(String), budgetId: "b1", amountCents: 5000 },
      { id: expect.any(String), budgetId: "b2", amountCents: 2840 },
    ]);
    // And the row now says so where its category used to be.
    expect(screen.getByLabelText("Split of Trader Joe's, 2 parts")).toBeInTheDocument();
  });

  test("the total and the parts move together in one commit", () => {
    seed({ transactions: [RECEIPT] });
    renderPage();

    fireEvent.click(screen.getByLabelText("Split of Costco, 2 parts"));
    type("Total", "130");
    type("Amount of part 1", "96");
    fireEvent.click(screen.getByRole("button", { name: "Save the split" }));

    // The register cannot take a split row's figure on its own — the sum rule
    // would refuse it every time — so the editor is where both move at once.
    expect(entry("t3").amountCents).toBe(13000);
    expect(entry("t3").splits.map((part) => part.amountCents)).toEqual([9600, 3400]);
  });

  test("a division that does not add up is refused with the shortfall, and nothing lands", () => {
    seed({ transactions: [RECEIPT] });
    renderPage();

    fireEvent.click(screen.getByLabelText("Split of Costco, 2 parts"));
    type("Amount of part 1", "80");
    fireEvent.click(screen.getByRole("button", { name: "Save the split" }));

    expect(screen.getByRole("alert")).toHaveTextContent("$10 short of the $124 total");
    expect(entry("t3").splits.map((part) => part.amountCents)).toEqual([9000, 3400]);
  });

  test("undoing puts the whole back under one category", () => {
    seed({ transactions: [RECEIPT] });
    renderPage();

    fireEvent.click(screen.getByLabelText("Split of Costco, 2 parts"));
    fireEvent.click(screen.getByRole("button", { name: /undo the split/i }));

    // Named on the button before it is pressed, so where the money lands is not
    // a surprise.
    expect(entry("t3").splits).toBeNull();
    expect(entry("t3").budgetId).toBe("b1");
    expect(entry("t3").amountCents).toBe(12400);
    expect(screen.getByLabelText("Category of Costco")).toHaveValue("b1");
  });

  test("a part is removed on the row it sits on", () => {
    seed({ transactions: [RECEIPT] });
    renderPage();

    fireEvent.click(screen.getByLabelText("Split of Costco, 2 parts"));
    fireEvent.click(screen.getByRole("button", { name: "Remove part 2" }));

    expect(screen.queryByLabelText("Amount of part 2")).not.toBeInTheDocument();
    // One part is not a division, and the editor says so rather than writing it.
    fireEvent.click(screen.getByRole("button", { name: "Save the split" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/two parts or more/i);
    expect(entry("t3").splits).toHaveLength(2);
  });
});

describe("naming a payee on a row", () => {
  const ALDI = { id: "p1", name: "Aldi", defaultBudgetId: null };

  /** The seeded books plus a payee list, and optionally a row already naming one. */
  function open({ payees = [], namedRow = false } = {}) {
    seed({
      payees,
      transactions: [
        {
          id: "t1",
          kind: TRANSACTION_KINDS.OUTFLOW,
          payeeId: namedRow ? payees[0].id : null,
          description: namedRow ? "weekly shop" : "Trader Joe's",
          amountCents: 7840,
          date: `${PERIOD}-11`,
          accountId: "acc1",
          budgetId: "b1",
        },
      ],
    });
    renderPage();
  }

  const payeeList = () => JSON.parse(localStorage.getItem("payees"));

  test("a name that is nobody yet becomes a payee, and the row points at it", () => {
    open();

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "Aldi" } });
    fireEvent.blur(cell);

    // Created on blur, because a cell has no submit to wait for — the opposite of
    // the entry form, which holds a typed name as a draft until it is submitted.
    expect(payeeList()).toEqual([
      {
        id: expect.any(String),
        name: "Aldi",
        defaultBudgetId: null,
        defaultSplit: null,
        defaultAccountId: null,
        defaultKind: null,
      },
    ]);
    expect(entry("t1").payeeId).toBe(payeeList()[0].id);
    // And the row now reads by its payee rather than by its note — so the note
    // it was identified by until a moment ago folds into the mark at the end of
    // the name, which still says what it is holding.
    expect(
      screen.getByRole("button", { name: "Note on Aldi: Trader Joe's" })
    ).toBeInTheDocument();
  });

  test("a payee already on the list is taken, not created again", () => {
    open({ payees: [ALDI] });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "ald" } });
    fireEvent.click(screen.getByRole("option", { name: /Aldi/ }));

    expect(payeeList()).toHaveLength(1);
    expect(entry("t1").payeeId).toBe("p1");
  });

  test("the same name differently typed is the same payee", () => {
    open({ payees: [ALDI] });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "  aldi " } });
    fireEvent.blur(cell);

    expect(payeeList()).toHaveLength(1);
    expect(entry("t1").payeeId).toBe("p1");
  });

  test("naming a payee never re-files the row's category", () => {
    open({ payees: [{ ...ALDI, defaultBudgetId: "b2" }] });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "aldi" } });
    fireEvent.blur(cell);

    // The payee's default seeds a *new* transaction. Money already filed is not
    // moved between envelopes because a name was corrected.
    expect(entry("t1").payeeId).toBe("p1");
    expect(entry("t1").budgetId).toBe("b1");
  });

  test("clearing the cell takes the payee off and keeps the row", () => {
    open({ payees: [ALDI], namedRow: true });

    const cell = screen.getByLabelText("Payee of Aldi");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);

    expect(entry("t1").payeeId).toBeNull();
    expect(entry("t1").amountCents).toBe(7840);
    // The payee itself is untouched — clearing a cell is not a delete.
    expect(payeeList()).toHaveLength(1);
  });

  test("a legacy row keeps its text as a note and can be corrected without a payee", () => {
    open();

    // Every row seeded without a payee predates the field, so the free text it
    // carries is its note and nothing has been promoted out of it.
    expect(entry("t1").payeeId).toBeNull();
    expect(entry("t1").description).toBe("Trader Joe's");

    const note = screen.getByLabelText("Note on Trader Joe's");
    fireEvent.change(note, { target: { value: "weekly shop" } });
    fireEvent.blur(note);

    // Corrected without being asked to invent a payee first, which is the same
    // courtesy an undated row already gets.
    expect(entry("t1").description).toBe("weekly shop");
    expect(entry("t1").payeeId).toBeNull();
  });
});

