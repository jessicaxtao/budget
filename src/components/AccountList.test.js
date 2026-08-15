import { fireEvent, render, screen, within } from "@testing-library/react";
import AccountList from "./AccountList";

/**
 * `AccountList` takes its rows as a prop and holds no state, so these render it
 * directly rather than through `AppProviders` — what is under test is how the
 * list is divided, not how the accounts got there.
 */
const account = (fields) => ({
  id: fields.name,
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  ...fields,
});

/** The section panel with the given heading. */
const section = (title) => screen.getByRole("heading", { name: title }).closest("section");

function renderList(accounts, balanceById, handlers = {}) {
  render(
    <AccountList
      accounts={accounts}
      balanceById={balanceById}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      {...handlers}
    />
  );
}

test("splits the accounts by scope rather than by side of the balance sheet", () => {
  renderList([
    account({ name: "Everyday" }),
    account({ name: "Visa", type: "liability", assetClass: "Other" }),
    account({ name: "401(k)", scope: "off-budget", assetClass: "Stocks" }),
    account({ name: "Mortgage", scope: "off-budget", type: "liability", assetClass: "Other" }),
  ]);

  // The overdraft sits with the everyday account because the same month's
  // spending runs through both, and the mortgage sits with the 401(k) because
  // neither is spent from.
  const onBudget = within(section("On budget"));
  expect(onBudget.getByText("Everyday")).toBeInTheDocument();
  expect(onBudget.getByText("Visa")).toBeInTheDocument();
  expect(onBudget.queryByText("401(k)")).not.toBeInTheDocument();

  const offBudget = within(section("Off budget"));
  expect(offBudget.getByText("401(k)")).toBeInTheDocument();
  expect(offBudget.getByText("Mortgage")).toBeInTheDocument();
});

test("an account with no scope stated is listed on budget", () => {
  // What a record saved before the field existed looks like if it reaches the
  // list unmigrated. Filtering it into neither section would hide it from the
  // only screen it can be deleted from.
  renderList([{ id: "a1", name: "Everyday", type: "asset", assetClass: "Cash" }]);

  expect(within(section("On budget")).getByText("Everyday")).toBeInTheDocument();
});

test("owned and owed are called out only once a section holds a debt", () => {
  renderList([
    account({ name: "Everyday" }),
    account({ name: "401(k)", scope: "off-budget", assetClass: "Stocks" }),
    account({ name: "Mortgage", scope: "off-budget", type: "liability", assetClass: "Other" }),
  ]);

  // Three bank accounts need no heading telling them they are not a mortgage.
  expect(within(section("On budget")).queryByText("Owned")).not.toBeInTheDocument();

  const offBudget = within(section("Off budget"));
  expect(offBudget.getByText("Owned")).toBeInTheDocument();
  expect(offBudget.getByText("Owed")).toBeInTheDocument();
});

test("credit cards get their own section, with what is owed as its own figure", () => {
  // The whole reason cards are a scope rather than just an on-budget liability:
  // the total owed is the figure the user comes to this panel for, and it is
  // buried the moment a current account is added into the same sum.
  renderList(
    [
      account({ name: "Everyday" }),
      account({ name: "Visa", scope: "credit-card", type: "liability", assetClass: "Other" }),
      account({ name: "Amex", scope: "credit-card", type: "liability", assetClass: "Other" }),
    ],
    new Map([
      ["Everyday", 250000],
      ["Visa", -45000],
      ["Amex", -15000],
    ])
  );

  const cards = within(section("Credit cards"));
  expect(cards.getByText("Visa")).toBeInTheDocument();
  expect(cards.getByText("Amex")).toBeInTheDocument();
  expect(cards.getByText("-$600")).toBeInTheDocument();

  // The everyday account keeps its own total: the cards are not netted into it.
  const onBudget = within(section("On budget"));
  expect(onBudget.queryByText("Visa")).not.toBeInTheDocument();
  expect(onBudget.queryByText("-$600")).not.toBeInTheDocument();

  // Everything in the section is owed, so a band saying so on every row would
  // only repeat the heading above it.
  expect(cards.queryByText("Owed")).not.toBeInTheDocument();
});

test("each section counts only its own accounts", () => {
  renderList([
    account({ name: "Everyday" }),
    account({ name: "401(k)", scope: "off-budget", assetClass: "Stocks" }),
  ]);

  expect(within(section("On budget")).getByText("1 account")).toBeInTheDocument();
  expect(within(section("Off budget")).getByText("1 account")).toBeInTheDocument();
});

test("the zebra runs across the band rather than restarting under it", () => {
  renderList([
    account({ name: "401(k)", scope: "off-budget", assetClass: "Stocks" }),
    account({ name: "Mortgage", scope: "off-budget", type: "liability", assetClass: "Other" }),
  ]);

  // The band sits between them, so restarting the stripe would put two rows of
  // the same shade either side of it.
  const row = (name) => screen.getByText(name).closest("div.flex");
  expect(row("401(k)")).toHaveClass("bg-sheet");
  expect(row("Mortgage")).toHaveClass("bg-sheet-alt");
});

test("each row hands back the whole account to edit, named so the two can be told apart", () => {
  // The panel is a column of the same two words otherwise, and the record is
  // handed back whole: the form has to sign the stored balance back the way it
  // was entered, which it cannot do from a name alone.
  const onEdit = jest.fn();
  const everyday = account({ name: "Everyday" });
  renderList([everyday, account({ name: "401(k)", scope: "off-budget" })], undefined, { onEdit });

  fireEvent.click(screen.getByRole("button", { name: "Edit account: Everyday" }));

  expect(onEdit).toHaveBeenCalledWith(everyday);
  expect(screen.getByRole("button", { name: "Edit account: 401(k)" })).toBeInTheDocument();
});

test("each panel offers its own add button", () => {
  renderList([]);

  expect(screen.getByRole("button", { name: "Add an on-budget account" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add a credit card" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add an off-budget account" })).toBeInTheDocument();
});
