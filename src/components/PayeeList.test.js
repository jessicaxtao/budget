import { fireEvent, render, screen, within } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import PayeeList from "./PayeeList";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { todayISO } from "../utils";

/**
 * The payee panel through the real stores rather than on props, because it reads
 * its own — the payees, the categories a default is chosen from, and a count off
 * the ledger — and because what is worth covering here is the round trip: a
 * rename is only worth anything if every row that names the payee follows it, and
 * that is not visible from inside a props-only render.
 *
 * The store's own rules — the clash, the unknown id, the merge validated whole —
 * are in `dataModel.test.js`. What is here is the row's editing contract and the
 * two cascades as a user reaches them.
 */
const PAYEES = [
  { id: "p1", name: "Costco", defaultBudgetId: "b1" },
  { id: "p2", name: "COSTCO", defaultBudgetId: null },
  { id: "p3", name: "Shell", defaultBudgetId: null },
];

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

const BUDGETS = [
  { id: "b1", name: "Groceries", groupId: null, plannedCents: 60000, bucket: "essentials" },
  { id: "b2", name: "Fuel", groupId: null, plannedCents: 12000, bucket: "essentials" },
];

const spend = (fields) => ({
  kind: TRANSACTION_KINDS.OUTFLOW,
  accountId: "acc1",
  amountCents: 1000,
  date: todayISO(),
  budgetId: "b1",
  splits: null,
  toAccountId: null,
  description: "",
  ...fields,
});

function seed({ payees = PAYEES, transactions = [] } = {}) {
  localStorage.clear();
  localStorage.setItem("accounts", JSON.stringify([ACCOUNT]));
  localStorage.setItem("budgets", JSON.stringify(BUDGETS));
  localStorage.setItem("payees", JSON.stringify(payees));
  localStorage.setItem("transactions", JSON.stringify(transactions));
  // Written explicitly so the day-one seed does not open every category with an
  // assignment equal to its spend.
  localStorage.setItem("assignments", JSON.stringify([]));
}

function renderPanel(options) {
  seed(options);
  render(
    <AppProviders>
      <PayeeList />
    </AppProviders>
  );
}

const ledger = () => JSON.parse(localStorage.getItem("transactions"));
const payees = () => JSON.parse(localStorage.getItem("payees"));

test("payees are listed alphabetically with what is filed under each", () => {
  renderPanel({
    transactions: [spend({ id: "t1", payeeId: "p1" }), spend({ id: "t2", payeeId: "p1" })],
  });

  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  // Two rows name Costco, and the count is the figure a merge has to state.
  expect(within(rows[0]).getByText("2")).toBeInTheDocument();
  expect(within(rows[2]).getByText("0")).toBeInTheDocument();
});

test("a rename commits on blur and every transaction follows it", () => {
  renderPanel({ transactions: [spend({ id: "t1", payeeId: "p3" })] });

  const name = screen.getByLabelText("Name of Shell");
  fireEvent.change(name, { target: { value: "Shell Gas" } });
  fireEvent.blur(name);

  expect(payees().find((payee) => payee.id === "p3").name).toBe("Shell Gas");
  // Nothing in the ledger moved, because no row was ever holding the name — which
  // is the whole reason a payee is a record and not a string.
  expect(ledger()[0].payeeId).toBe("p3");
});

test("a rename the store refuses puts the old name back and says why", () => {
  renderPanel();

  const name = screen.getByLabelText("Name of Shell");
  // "costco" is Costco by identity, and two payees cannot share a name.
  fireEvent.change(name, { target: { value: "costco" } });
  fireEvent.blur(name);

  expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
  // The rest of the app still knows this payee by the stored name.
  expect(name).toHaveValue("Shell");
  expect(payees().find((payee) => payee.id === "p3").name).toBe("Shell");
});

test("the default category commits on change, and blank takes it off", () => {
  renderPanel();

  fireEvent.change(screen.getByLabelText("Default category for Shell"), {
    target: { value: "b2" },
  });
  expect(payees().find((payee) => payee.id === "p3").defaultBudgetId).toBe("b2");

  fireEvent.change(screen.getByLabelText("Default category for Costco"), { target: { value: "" } });
  expect(payees().find((payee) => payee.id === "p1").defaultBudgetId).toBeNull();
});

test("a default naming a category that is gone keeps an option of its own", () => {
  renderPanel({ payees: [{ id: "p1", name: "Costco", defaultBudgetId: "deleted" }] });

  const select = screen.getByLabelText("Default category for Costco");
  // Inert rather than cleared, and shown as what it is: without its own option the
  // select would display Groceries and the payee would look re-filed by being
  // looked at.
  expect(select).toHaveValue("deleted");
  expect(within(select).getByRole("option", { name: "Unknown category" })).toBeInTheDocument();
});

test("removing a payee keeps its transactions, unnamed", () => {
  renderPanel({ transactions: [spend({ id: "t1", payeeId: "p3" })] });

  fireEvent.click(screen.getByRole("button", { name: "Remove payee: Shell" }));

  expect(payees().map((payee) => payee.id)).toEqual(["p1", "p2"]);
  expect(ledger()).toHaveLength(1);
  expect(ledger()[0]).toMatchObject({ payeeId: null, amountCents: 1000, budgetId: "b1" });
});

describe("merging", () => {
  test("it states how many rows will move before anything is done", () => {
    renderPanel({
      transactions: [spend({ id: "t1", payeeId: "p2" }), spend({ id: "t2", payeeId: "p2" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Merge payees into Costco" }));
    // Nothing ticked yet, so there is nothing to say about a consequence.
    expect(screen.getByRole("status")).toHaveTextContent(/nothing ticked/i);

    fireEvent.click(screen.getByRole("checkbox", { name: /COSTCO/ }));

    // A merge cannot be undone and it moves rows the user cannot see from here, so
    // the figure is on screen before the button is worth pressing.
    expect(screen.getByRole("status")).toHaveTextContent(/2 transactions will move to Costco/i);
  });

  test("it repoints the ledger and drops the merged payee in one go", () => {
    renderPanel({ transactions: [spend({ id: "t1", payeeId: "p2" })] });

    fireEvent.click(screen.getByRole("button", { name: "Merge payees into Costco" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /COSTCO/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(payees().map((payee) => payee.name)).toEqual(["Costco", "Shell"]);
    expect(ledger()[0].payeeId).toBe("p1");
    // The money is untouched: a merge is about names.
    expect(ledger()[0].amountCents).toBe(1000);
  });

  test("the target itself is never on offer to be merged into itself", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Merge payees into Shell" }));

    // Each checkbox is named by its row — the payee and what is filed under it.
    const offered = screen.getAllByRole("checkbox").map((box) => box.closest("label").textContent);
    expect(offered).toHaveLength(2);
    expect(offered.some((text) => text.startsWith("Costco"))).toBe(true);
    expect(offered.some((text) => text.startsWith("Shell"))).toBe(false);
  });
});
