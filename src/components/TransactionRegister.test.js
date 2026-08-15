import { fireEvent, render, screen, within } from "@testing-library/react";
import TransactionRegister from "./TransactionRegister";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { UNCATEGORIZED_BUDGET_ID } from "../contexts/constants";

/**
 * The register with its rows handed to it, since that is how the page gives
 * them — what this pins down is the editing contract of a cell, not how the
 * records got there or what the store does with them. The store end is in
 * `dataModel.test.js` and the round trip is in `TransactionsPage.test.js`.
 *
 * `onChange` is a spy so a rejection can be staged: what matters at this level
 * is which patch a cell sends and what it does with the answer.
 */
const PERIOD = "2026-08";

const BUDGETS = [
  { id: "b1", name: "Groceries" },
  { id: "b2", name: "Fuel" },
];

const ACCOUNTS = [
  { id: "acc1", name: "Everyday", scope: "on-budget" },
  { id: "acc2", name: "Visa", scope: "credit-card" },
  { id: "acc3", name: "401(k)", scope: "off-budget" },
];

const SPEND = {
  id: "t1",
  kind: TRANSACTION_KINDS.OUTFLOW,
  description: "Trader Joe's",
  amountCents: 7840,
  date: "2026-08-11",
  accountId: "acc1",
  budgetId: "b1",
};

const PAY = {
  id: "t2",
  kind: TRANSACTION_KINDS.INFLOW,
  description: "Paycheck",
  amountCents: 214000,
  date: "2026-08-09",
  accountId: "acc1",
  budgetId: null,
};

function renderRegister({ transactions = [SPEND, PAY], onChange, onDelete = () => {} } = {}) {
  const change = onChange ?? jest.fn(() => ({ ok: true }));
  render(
    <TransactionRegister
      period={PERIOD}
      transactions={transactions}
      budgets={BUDGETS}
      accounts={ACCOUNTS}
      onChange={change}
      onDelete={onDelete}
      onAdd={() => {}}
    />
  );
  return change;
}

test("money in and money out get a column each, and the month totals both", () => {
  renderRegister();

  // Money at rest, not the raw number: `type="number"` would render $78.40 as
  // "78.4" and a column of figures would never line up on its decimal point.
  expect(screen.getByLabelText("In for Trader Joe's")).toHaveValue("");
  expect(screen.getByLabelText("Out for Trader Joe's")).toHaveValue("$78.40");
  expect(screen.getByLabelText("In for Paycheck")).toHaveValue("$2,140");
  expect(screen.getByLabelText("Out for Paycheck")).toHaveValue("");

  const footer = within(screen.getByRole("row", { name: /August 2026/ }));
  expect(footer.getByText("$2,140")).toBeInTheDocument();
  expect(footer.getByText("$78.40")).toBeInTheDocument();
});

test("a cell hands over the plain figure to edit and takes the symbol back", () => {
  const onChange = renderRegister();
  const cell = screen.getByLabelText("Out for Trader Joe's");

  fireEvent.focus(cell);
  expect(cell).toHaveValue("78.40");

  // Whatever the field wrote, it has to accept back — a user who edits around
  // the formatting rather than through it is typing something valid.
  fireEvent.change(cell, { target: { value: "$1,204.50" } });
  fireEvent.blur(cell);

  expect(onChange).toHaveBeenCalledWith({
    id: "t1",
    kind: TRANSACTION_KINDS.OUTFLOW,
    amountCents: 120450,
  });
});

test("a figure typed into the other column moves the row across", () => {
  const onChange = renderRegister();

  // The register's whole answer to "I filed this the wrong way round": no
  // delete, no re-entry, and everything else on the row survives.
  const inCell = screen.getByLabelText("In for Trader Joe's");
  fireEvent.change(inCell, { target: { value: "78.40" } });
  fireEvent.blur(inCell);

  expect(onChange).toHaveBeenCalledWith({
    id: "t1",
    kind: TRANSACTION_KINDS.INFLOW,
    amountCents: 7840,
  });
});

test("clearing a cell is an abandoned edit, not a value", () => {
  const onChange = renderRegister();

  // A blank amount is not a transaction of nothing, and a blank date does not
  // un-date a record. Both put back what is stored, which is what leaves
  // select-all-and-retype free to pass through an empty state.
  const outCell = screen.getByLabelText("Out for Trader Joe's");
  fireEvent.change(outCell, { target: { value: "" } });
  fireEvent.blur(outCell);

  const dateCell = screen.getByLabelText("Date of Trader Joe's");
  fireEvent.change(dateCell, { target: { value: "" } });
  fireEvent.blur(dateCell);

  expect(onChange).not.toHaveBeenCalled();
  expect(outCell).toHaveValue("$78.40");
  expect(dateCell).toHaveValue("2026-08-11");
});

test("an edit the store refuses is put back, with the reason on the row", () => {
  const onChange = jest.fn(() => ({ ok: false, error: "Choose a category for this expense." }));
  renderRegister({ onChange });

  const description = screen.getByLabelText("Description of Trader Joe's");
  fireEvent.change(description, { target: { value: "Aldi" } });
  fireEvent.blur(description);

  expect(screen.getByRole("alert")).toHaveTextContent(/choose a category/i);
  // The rest of the app still knows this row by the stored description.
  expect(description).toHaveValue("Trader Joe's");
});

test("no repeat of a value the store already holds", () => {
  const onChange = renderRegister();

  const description = screen.getByLabelText("Description of Paycheck");
  fireEvent.change(description, { target: { value: "  Paycheck  " } });
  fireEvent.blur(description);

  const outCell = screen.getByLabelText("Out for Trader Joe's");
  fireEvent.change(outCell, { target: { value: "78.40" } });
  fireEvent.blur(outCell);

  expect(onChange).not.toHaveBeenCalled();
});

test("only an inflow is offered the blank category, which is what makes it income", () => {
  renderRegister();

  const income = within(screen.getByLabelText("Category of Paycheck"));
  expect(income.getByRole("option", { name: /none — income/i })).toBeInTheDocument();

  const expense = within(screen.getByLabelText("Category of Trader Joe's"));
  expect(expense.queryByRole("option", { name: /none/i })).not.toBeInTheDocument();
});

test("the selects commit on change, since there is nothing to type", () => {
  const onChange = renderRegister();

  fireEvent.change(screen.getByLabelText("Category of Trader Joe's"), { target: { value: "b2" } });
  expect(onChange).toHaveBeenCalledWith({ id: "t1", budgetId: "b2" });

  fireEvent.change(screen.getByLabelText("Account of Trader Joe's"), { target: { value: "acc2" } });
  expect(onChange).toHaveBeenCalledWith({ id: "t1", accountId: "acc2" });
});

test("a value the form would not offer keeps an option of its own", () => {
  renderRegister({
    transactions: [
      // A category deleted out from under it, and an account the transaction
      // form does not offer. Without an option apiece the selects would show
      // their first entry, and the row would look refiled by being looked at.
      { ...SPEND, budgetId: UNCATEGORIZED_BUDGET_ID, accountId: "acc3" },
    ],
  });

  expect(screen.getByLabelText("Category of Trader Joe's")).toHaveValue(UNCATEGORIZED_BUDGET_ID);
  expect(screen.getByLabelText("Account of Trader Joe's")).toHaveValue("acc3");
  expect(screen.getByRole("option", { name: "401(k)" })).toBeInTheDocument();
  // Off-budget accounts are still not on offer to a row that does not hold one.
  expect(screen.queryByRole("option", { name: "Uncategorized", selected: false })).toBeNull();
});

test("undated rows get a band of their own and stay out of the month's total", () => {
  const undated = { ...SPEND, id: "t3", description: "Old", amountCents: 2000, date: null };
  renderRegister({ transactions: [SPEND, PAY, undated] });

  const band = within(screen.getByRole("row", { name: /undated/i }));
  expect(band.getByText("$20")).toBeInTheDocument();

  // The month's figure is unchanged by it: undated money belongs to no month.
  const footer = within(screen.getByRole("row", { name: /August 2026/ }));
  expect(footer.getByText("$78.40")).toBeInTheDocument();

  // And it is reachable, which is the reason it is on screen at all.
  const dateCell = screen.getByLabelText("Date of Old");
  expect(dateCell).toHaveValue("");
  expect(screen.getByText(/give one a date to file it/i)).toBeInTheDocument();
});

test("an empty month says so and offers the way out", () => {
  renderRegister({ transactions: [] });

  expect(screen.getByText(/nothing recorded in August 2026/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add a transaction/i })).toBeInTheDocument();
});

test("a row can be removed", () => {
  const onDelete = jest.fn();
  renderRegister({ onDelete });

  fireEvent.click(screen.getByRole("button", { name: "Remove entry: Trader Joe's" }));

  expect(onDelete).toHaveBeenCalledWith(SPEND);
});
