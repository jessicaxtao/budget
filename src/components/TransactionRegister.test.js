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

// The payees a row can name. Two of them share a prefix on purpose, since that
// is what the search has to rank rather than merely match.
const PAYEES = [
  { id: "p1", name: "Trader Joe's", defaultBudgetId: "b1" },
  { id: "p2", name: "Traeger Grills", defaultBudgetId: null },
  { id: "p3", name: "Acme Payroll", defaultBudgetId: null },
];

const PAYEE_BY_ID = new Map(PAYEES.map((payee) => [payee.id, payee]));

const SPEND = {
  id: "t1",
  kind: TRANSACTION_KINDS.OUTFLOW,
  payeeId: "p1",
  description: "weekly shop",
  amountCents: 7840,
  date: "2026-08-11",
  accountId: "acc1",
  budgetId: "b1",
};

const PAY = {
  id: "t2",
  kind: TRANSACTION_KINDS.INFLOW,
  payeeId: "p3",
  description: "",
  amountCents: 214000,
  date: "2026-08-09",
  accountId: "acc1",
  budgetId: null,
};

function renderRegister({
  transactions = [SPEND, PAY],
  payees = PAYEES,
  onChange,
  onPayeeChange = () => ({ ok: true }),
  onDelete = () => {},
  onSplit = () => {},
} = {}) {
  const change = onChange ?? jest.fn(() => ({ ok: true }));
  render(
    <TransactionRegister
      period={PERIOD}
      transactions={transactions}
      budgets={BUDGETS}
      accounts={ACCOUNTS}
      payees={payees}
      payeeById={PAYEE_BY_ID}
      onChange={change}
      onPayeeChange={onPayeeChange}
      onDelete={onDelete}
      onAdd={() => {}}
      onSplit={onSplit}
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
  expect(screen.getByLabelText("In for Acme Payroll")).toHaveValue("$2,140");
  expect(screen.getByLabelText("Out for Acme Payroll")).toHaveValue("");

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

  const description = screen.getByLabelText("Note on Trader Joe's");
  fireEvent.change(description, { target: { value: "Aldi" } });
  fireEvent.blur(description);

  expect(screen.getByRole("alert")).toHaveTextContent(/choose a category/i);
  // The rest of the app still knows this row by the stored note.
  expect(description).toHaveValue("weekly shop");
});

test("no repeat of a value the store already holds", () => {
  const onChange = renderRegister();

  const description = screen.getByLabelText("Note on Trader Joe's");
  fireEvent.change(description, { target: { value: "  weekly shop  " } });
  fireEvent.blur(description);

  const outCell = screen.getByLabelText("Out for Trader Joe's");
  fireEvent.change(outCell, { target: { value: "78.40" } });
  fireEvent.blur(outCell);

  expect(onChange).not.toHaveBeenCalled();
});

describe("the payee cell", () => {
  test("it searches the list as the letters go in, best match first", () => {
    renderRegister();

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "tra" } });

    const list = within(screen.getByRole("listbox"));
    // Both payees start with "Tra", and the apostrophe in one of them is folded
    // away rather than getting in the way.
    expect(list.getByRole("option", { name: /Traeger Grills/ })).toBeInTheDocument();
    expect(list.getByRole("option", { name: /Trader Joe's/ })).toBeInTheDocument();
    // And the last row is the way out of the list, since "tra" is nobody yet.
    expect(list.getByRole("option", { name: /New payee/ })).toBeInTheDocument();
  });

  test("picking one sends the payee, never a name", () => {
    const onPayeeChange = jest.fn(() => ({ ok: true }));
    renderRegister({ onPayeeChange });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "traeger" } });
    fireEvent.click(screen.getByRole("option", { name: /Traeger Grills/ }));

    expect(onPayeeChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1" }),
      { payeeId: "p2", name: "Traeger Grills" }
    );
  });

  test("a name that is nobody yet is sent as a name, for the page to create", () => {
    const onPayeeChange = jest.fn(() => ({ ok: true }));
    renderRegister({ onPayeeChange });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "Ace Hardware" } });
    fireEvent.blur(cell);

    expect(onPayeeChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), {
      payeeId: null,
      name: "Ace Hardware",
    });
  });

  test("clearing it is a real answer, unlike clearing a date or an amount", () => {
    const onPayeeChange = jest.fn(() => ({ ok: true }));
    renderRegister({ onPayeeChange });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);

    expect(onPayeeChange).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), {
      payeeId: null,
      name: "",
    });
  });

  test("the name it already holds is not an edit", () => {
    const onPayeeChange = jest.fn(() => ({ ok: true }));
    renderRegister({ onPayeeChange });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.blur(cell);

    expect(onPayeeChange).not.toHaveBeenCalled();
  });

  test("a refusal is put back with the reason on the row", () => {
    renderRegister({
      onPayeeChange: () => ({ ok: false, error: "A payee named “Aldi” already exists." }),
    });

    const cell = screen.getByLabelText("Payee of Trader Joe's");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "Aldi" } });
    fireEvent.blur(cell);

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    // The stored payee is what the cell reads again, because that is what the row
    // still says.
    expect(cell).toHaveValue("Trader Joe's");
  });

});

test("only an inflow is offered the blank category, which is what makes it income", () => {
  renderRegister();

  const income = within(screen.getByLabelText("Category of Acme Payroll"));
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
  // No payee, which is what every row folded in from before payees existed looks
  // like — so the row is known by its note, exactly as it always was.
  const undated = {
    ...SPEND,
    id: "t3",
    payeeId: null,
    description: "Old",
    amountCents: 2000,
    date: null,
  };
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

describe("a transfer row", () => {
  // Between two accounts the budget spends through: a card payment, the case
  // that had no correct shape at all before transfers existed.
  const PAYMENT = {
    id: "t3",
    kind: TRANSACTION_KINDS.TRANSFER,
    description: "Card payment",
    amountCents: 20000,
    date: "2026-08-12",
    accountId: "acc1",
    toAccountId: "acc2",
    budgetId: null,
  };

  test("it names nobody, so it keeps a note and gets no payee cell", () => {
    renderRegister({ transactions: [PAYMENT] });

    // A transfer moves money between the household's own accounts — there is no
    // other end to name — so the column holds the note alone.
    expect(screen.queryByLabelText(/^Payee of/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Note on Card payment")).toBeInTheDocument();
  });

  // And one that leaves the budget for a holding, which does come out of a
  // category.
  const CONTRIBUTION = {
    ...PAYMENT,
    id: "t4",
    description: "Contribution",
    toAccountId: "acc3",
    budgetId: "b1",
  };

  test("both of its accounts are on the row, and the second one commits", () => {
    const onChange = renderRegister({ transactions: [PAYMENT] });

    expect(screen.getByLabelText("Transferred from, for Card payment")).toHaveValue("acc1");
    expect(screen.getByLabelText("Transferred to, for Card payment")).toHaveValue("acc2");

    fireEvent.change(screen.getByLabelText("Transferred to, for Card payment"), {
      target: { value: "acc3" },
    });
    expect(onChange).toHaveBeenCalledWith({ id: "t3", toAccountId: "acc3" });
  });

  test("a holding is on offer on both ends, where no other row would offer one", () => {
    renderRegister({ transactions: [PAYMENT] });

    const from = screen.getByLabelText("Transferred from, for Card payment");
    expect(within(from).getByRole("option", { name: "401(k)" })).toBeInTheDocument();

    // And the account this row already names is not offered as its own
    // destination — a transfer to itself is no movement, and the store refuses it.
    const to = screen.getByLabelText("Transferred to, for Card payment");
    expect(within(to).queryByRole("option", { name: "Everyday" })).not.toBeInTheDocument();
  });

  test("the amount sits in Out, and In is not a field at all", () => {
    renderRegister({ transactions: [PAYMENT] });

    expect(screen.getByLabelText("Out for Card payment")).toHaveValue("$200");
    // Not an empty textbox: a figure typed into the other column is what flips an
    // ordinary row's direction, and a transfer has no direction to flip — its
    // direction is the pair of accounts above.
    expect(screen.queryByLabelText("In for Card payment")).not.toBeInTheDocument();
  });

  test("its figure commits without naming a direction", () => {
    const onChange = renderRegister({ transactions: [PAYMENT] });

    const out = screen.getByLabelText("Out for Card payment");
    fireEvent.change(out, { target: { value: "150" } });
    fireEvent.blur(out);

    // No `kind` in the patch: sending one would ask the store to re-check a
    // direction that never moved.
    expect(onChange).toHaveBeenCalledWith({ id: "t3", amountCents: 15000 });
  });

  test("only a transfer that leaves the budget has a category to file", () => {
    renderRegister({ transactions: [PAYMENT, CONTRIBUTION] });

    // Paying a card moves no envelope, so there is nothing to file it under and
    // no select offering to.
    expect(screen.queryByLabelText("Category of Card payment")).not.toBeInTheDocument();
    // Money leaving for a holding is spending, and the category it came out of is
    // editable on the row like any other.
    expect(screen.getByLabelText("Category of Contribution")).toHaveValue("b1");
  });

  test("the month footings leave transfers out of both columns", () => {
    renderRegister({ transactions: [SPEND, PAY, PAYMENT] });

    const footer = screen.getByRole("table").querySelector("tfoot");
    // The paycheque and the groceries, and not the $200 that merely changed
    // accounts — counted, the month would read as having spent it twice.
    expect(within(footer).getByText("$2,140")).toBeInTheDocument();
    expect(within(footer).getByText("$78.40")).toBeInTheDocument();
  });
});

describe("a divided row", () => {
  const RECEIPT = {
    id: "t5",
    kind: TRANSACTION_KINDS.OUTFLOW,
    description: "Costco",
    amountCents: 12400,
    date: "2026-08-14",
    accountId: "acc1",
    budgetId: null,
    splits: [
      { id: "p1", budgetId: "b1", amountCents: 9000 },
      { id: "p2", budgetId: "b2", amountCents: 3400 },
    ],
  };

  test("its category cell says how many ways, and opens the editor", () => {
    const onSplit = jest.fn();
    renderRegister({ transactions: [RECEIPT], onSplit });

    // Not a select: the answer is several categories, and no single option can
    // state it.
    expect(screen.queryByLabelText("Category of Costco")).not.toBeInTheDocument();
    const cell = screen.getByLabelText("Split of Costco, 2 parts");
    expect(cell).toHaveTextContent("Split (2)");

    fireEvent.click(cell);
    expect(onSplit).toHaveBeenCalledWith(RECEIPT);
  });

  test("the figure opens the editor too, and the other column is not a field", () => {
    const onSplit = jest.fn();
    const onChange = renderRegister({ transactions: [RECEIPT], onSplit });

    // The whole, in the column the row is going — the parts are what add up to
    // it, so it cannot be retyped here without them.
    const figure = screen.getByLabelText("Out for Costco — open the split to change it");
    expect(figure).toHaveTextContent("$124");
    fireEvent.click(figure);
    expect(onSplit).toHaveBeenCalledWith(RECEIPT);

    // A figure typed into In is what flips an ordinary row's direction, and a
    // division cannot follow a flip — so there is nothing there to type into.
    expect(screen.queryByLabelText("In for Costco")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an ordinary row is divided from the question its category column asks", () => {
    const onSplit = jest.fn();
    const onChange = renderRegister({ onSplit });

    const cell = screen.getByLabelText("Category of Trader Joe's");
    fireEvent.change(cell, { target: { value: "__split__" } });

    // The editor opens and nothing is committed — picking it is not an answer
    // about which category, it is a request to give several.
    expect(onSplit).toHaveBeenCalledWith(SPEND);
    expect(onChange).not.toHaveBeenCalled();
    expect(cell).toHaveValue("b1");
  });

  test("the month footings count a divided receipt once, at its whole", () => {
    renderRegister({ transactions: [SPEND, RECEIPT] });

    const footer = within(screen.getByRole("row", { name: /August 2026/ }));
    // $78.40 and $124, not the three figures the two rows hold between them.
    expect(footer.getByText("$202.40")).toBeInTheDocument();
  });
});
