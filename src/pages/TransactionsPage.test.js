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

    const out = screen.getByLabelText("Out for Card payment");
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
    expect(payeeList()).toEqual([{ id: expect.any(String), name: "Aldi", defaultBudgetId: null }]);
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

/**
 * The bar, scoped — a chip reading "#road" and a row's own Remove button both
 * answer to the same text, so every query for a facet is made inside the
 * section rather than across the page.
 */
const filters = () => within(screen.getByRole("region", { name: "Search and filter" }));

describe("searching and filtering the register", () => {
  const search = () => screen.getByRole("searchbox", { name: "Search the register" });
  const type = (value) => fireEvent.change(search(), { target: { value } });
  const openFacets = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

  test("a search narrows the register and says what it is holding back", () => {
    seed();
    renderPage();

    type("paycheck");

    expect(screen.getByLabelText("Note on Paycheck")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Trader Joe's")).not.toBeInTheDocument();
    // "1 of 2" rather than "1": what is missing has to be a figure on screen,
    // or the register would be quietly lying about the month.
    expect(screen.getByText(/1 of 2 entries/i)).toBeInTheDocument();
  });

  test("the amount is searchable, because that is how a statement is reconciled", () => {
    seed();
    renderPage();

    type("78.40");

    expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Paycheck")).not.toBeInTheDocument();
  });

  test("a search reaches the whole ledger once the window says all time", () => {
    const previous = addMonths(PERIOD, -3);
    seed({
      transactions: [
        {
          id: "t5",
          kind: TRANSACTION_KINDS.OUTFLOW,
          description: "Costco",
          amountCents: 12400,
          date: `${previous}-14`,
          accountId: "acc1",
          budgetId: "b1",
        },
      ],
    });
    renderPage();

    // The month on screen has nothing in it, which is the whole reason the
    // window is a control: a search bounded by the month cannot find the receipt
    // from the spring.
    type("costco");
    expect(screen.queryByLabelText("Note on Costco")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All time" }));

    expect(screen.getByLabelText("Note on Costco")).toBeInTheDocument();
    // The footing is a footing of the window, so it stops naming a month it is
    // no longer about.
    expect(screen.getByRole("row", { name: /Every month/ })).toBeInTheDocument();
  });

  test("a category and a tag narrow together", () => {
    seed({
      transactions: [
        {
          id: "t5",
          kind: TRANSACTION_KINDS.OUTFLOW,
          description: "Fuel up #road",
          amountCents: 5000,
          date: `${PERIOD}-03`,
          accountId: "acc1",
          budgetId: "b2",
        },
        {
          id: "t6",
          kind: TRANSACTION_KINDS.OUTFLOW,
          description: "Snacks #road",
          amountCents: 800,
          date: `${PERIOD}-03`,
          accountId: "acc1",
          budgetId: "b1",
        },
      ],
    });
    renderPage();

    openFacets();
    fireEvent.click(filters().getByRole("button", { name: "#road · 2" }));
    expect(screen.getByLabelText("Note on Fuel up #road")).toBeInTheDocument();
    expect(screen.getByLabelText("Note on Snacks #road")).toBeInTheDocument();

    fireEvent.click(filters().getByRole("button", { name: "Fuel" }));
    expect(screen.getByLabelText("Note on Fuel up #road")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note on Snacks #road")).not.toBeInTheDocument();
  });

  test("a filter that matches nothing offers to clear rather than to add", () => {
    seed();
    renderPage();

    type("nothing like this");
    // Offering "Add a transaction" to somebody who has just searched would
    // answer a question they did not ask.
    expect(screen.queryByRole("button", { name: /Add a transaction/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear the filter/ }));

    expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();
    expect(search()).toHaveValue("");
  });
});

describe("keeping a search", () => {
  const saved = () => JSON.parse(localStorage.getItem("savedFilters"));

  function keepItAs(name) {
    fireEvent.click(screen.getByRole("button", { name: "Save this search" }));
    fireEvent.change(screen.getByLabelText("Name for this search"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  }

  test("a named search is one click away afterwards", () => {
    seed();
    renderPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "paycheck" },
    });
    keepItAs("Pay");

    // The filter itself is what is stored — the question, not a description of
    // it — so it can be applied again without anything being interpreted.
    expect(saved()).toEqual([
      { id: expect.any(String), name: "Pay", filter: expect.objectContaining({ text: "paycheck" }) },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Clear$/ }));
    expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(screen.queryByLabelText("Note on Trader Joe's")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Note on Paycheck")).toBeInTheDocument();
  });

  test("a clashing name is refused with the form still open on what was typed", () => {
    seed();
    renderPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "paycheck" },
    });
    keepItAs("Pay");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "trader" },
    });
    keepItAs("pay");

    expect(screen.getByRole("alert")).toHaveTextContent(/already a filter called/i);
    expect(screen.getByLabelText("Name for this search")).toHaveValue("pay");
    expect(saved()).toHaveLength(1);
  });

  test("a search with nothing in it is not worth a name", () => {
    seed();
    renderPage();

    // Nothing is saveable until something is in force, so the button is not even
    // on screen — a chip that did nothing when clicked would be worse.
    expect(screen.queryByRole("button", { name: "Save this search" })).not.toBeInTheDocument();
  });
});

describe("editing several rows at once", () => {
  const pick = (name) => fireEvent.click(screen.getByLabelText(`Select ${name}`));

  test("refiling a selection lands on every row in one commit", () => {
    seed();
    renderPage();

    pick("Trader Joe's");
    pick("Paycheck");
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Refile the 2 entries selected into a category"), {
      target: { value: "b2" },
    });

    expect(entry("t1").budgetId).toBe("b2");
    expect(entry("t2").budgetId).toBe("b2");
  });

  test("the header box ticks what is shown and nothing more", () => {
    seed();
    renderPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "paycheck" },
    });
    fireEvent.click(screen.getByLabelText("Select every entry shown"));

    // The rows a filter is hiding are not the rows a select-all would tick: a
    // bulk edit that reached what nobody can see would be the worst button here.
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();
  });

  test("a batch that moves nothing says so rather than sitting there", () => {
    seed();
    renderPage();

    pick("Trader Joe's");
    pick("Paycheck");
    fireEvent.change(screen.getByLabelText("Move the 2 entries selected to an account"), {
      target: { value: "acc1" },
    });

    // Both rows already name that account, so the store writes nothing — which
    // is right, and is also indistinguishable from a broken button unless the
    // page says it.
    expect(entry("t1").accountId).toBe("acc1");
    expect(screen.getByRole("status")).toHaveTextContent(/already reads that way/i);
  });

  test("a tag added to a selection lands in the notes and can be searched for", () => {
    seed();
    renderPage();

    pick("Trader Joe's");
    fireEvent.change(screen.getByLabelText("Tag to add or remove"), {
      target: { value: "#holiday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(entry("t1").description).toBe("Trader Joe's #holiday");
    // Anchored, because `toHaveTextContent` matches a substring and "##holiday"
    // would pass a loose one — the `#` is how a tag is written, not part of its
    // name, and the bar hands it over without one.
    expect(screen.getByRole("status")).toHaveTextContent(/^#holiday is now on 1 entry\.$/);

    // And the tag is now a facet, because a tag is a reading of the note rather
    // than a field beside it.
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(filters().getByRole("button", { name: "#holiday · 1" }));
    expect(screen.queryByLabelText("Note on Paycheck")).not.toBeInTheDocument();
  });

  test("a tag that is not one word is refused before anything is written", () => {
    seed();
    renderPage();

    pick("Trader Joe's");
    fireEvent.change(screen.getByLabelText("Tag to add or remove"), {
      target: { value: "two words" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/one word/i);
    expect(entry("t1").description).toBe("Trader Joe's");
  });

  test("a divided receipt is left alone when a selection is refiled, and said so", () => {
    seed({
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
          id: "t4",
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
        },
      ],
    });
    renderPage();

    pick("Trader Joe's");
    pick("Costco");
    fireEvent.change(screen.getByLabelText("Refile the 2 entries selected into a category"), {
      target: { value: "b2" },
    });

    // A division is an answer of its own to the question that select asks, and
    // storing a category behind it would read as refiled while the money went on
    // going where the parts say.
    expect(entry("t1").budgetId).toBe("b2");
    expect(entry("t4").splits).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(/divided receipt was left alone/i);
  });

  test("removing a selection takes it off the books, and undo puts it back", () => {
    seed();
    renderPage();

    pick("Trader Joe's");
    pick("Paycheck");
    fireEvent.click(screen.getByRole("button", { name: "Remove 2" }));

    expect(ledger()).toEqual([]);

    // No confirm dialog on the way out, because this is what protects the
    // decision rather than the keystroke.
    fireEvent.click(screen.getByRole("button", { name: "Undo removing 2 entries" }));

    expect(ledger().map((transaction) => transaction.id)).toEqual(["t1", "t2"]);
    expect(screen.getByLabelText("Note on Trader Joe's")).toBeInTheDocument();
  });
});

describe("the running balance", () => {
  function filterToTheAccount() {
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Everyday" }));
  }

  test("takes the account column's place once the filter names one account", () => {
    seed();
    renderPage();

    expect(screen.getByLabelText("Account of Trader Joe's")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Balance" })).not.toBeInTheDocument();

    filterToTheAccount();

    // The two trade places: the account the filter names is not worth repeating
    // on sixty rows, and the grid has no width for a seventh column.
    expect(screen.getByRole("columnheader", { name: "Balance" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Account of Trader Joe's")).not.toBeInTheDocument();
  });

  test("is the account's own running figure, in the books' order and not the screen's", () => {
    seed();
    renderPage();
    filterToTheAccount();

    // $2,000 opening, then the paycheque on the 9th, then the shop on the 11th —
    // even though the register draws them the other way up.
    const pay = within(screen.getByRole("row", { name: /Paycheck/ }));
    expect(pay.getByText("$4,140")).toBeInTheDocument();
    const shop = within(screen.getByRole("row", { name: /Trader Joe's/ }));
    expect(shop.getByText("$4,061.60")).toBeInTheDocument();
  });

  test("a figure the filter hides does not change the figures it shows", () => {
    seed();
    renderPage();
    filterToTheAccount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "trader" },
    });

    // The balance is a property of the row and the account, not of the view —
    // so narrowing to one row leaves it the number the statement will show.
    const shop = within(screen.getByRole("row", { name: /Trader Joe's/ }));
    expect(shop.getByText("$4,061.60")).toBeInTheDocument();
  });
});

describe("walking the ledger back", () => {
  test("the button names what it will put back, and is dead until there is something", () => {
    seed();
    renderPage();

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Category of Trader Joe's"), { target: { value: "b2" } });

    const undo = screen.getByRole("button", { name: "Undo that edit" });
    fireEvent.click(undo);

    expect(entry("t1").budgetId).toBe("b1");
    expect(screen.getByRole("status")).toHaveTextContent("Undone — that edit.");
    fireEvent.click(screen.getByRole("button", { name: "Redo that edit" }));
    expect(entry("t1").budgetId).toBe("b2");
  });

  test("Ctrl+Z walks it back from the page, and leaves a text field's own typing alone", () => {
    seed();
    renderPage();

    fireEvent.change(screen.getByLabelText("Category of Trader Joe's"), { target: { value: "b2" } });

    // Inside a text field the gesture means the typing, and taking it over would
    // be worse than not offering it.
    fireEvent.keyDown(screen.getByLabelText("Note on Trader Joe's"), { key: "z", ctrlKey: true });
    expect(entry("t1").budgetId).toBe("b2");

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(entry("t1").budgetId).toBe("b1");

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(entry("t1").budgetId).toBe("b2");
  });

  test("a removed row comes back where it sat", () => {
    seed();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Remove entry: Trader Joe's" }));
    expect(ledger()).toHaveLength(1);

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });

    expect(ledger().map((transaction) => transaction.id)).toEqual(["t1", "t2"]);
  });
});
