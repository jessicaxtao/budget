import { fireEvent, render, screen, within } from "@testing-library/react";
import PayeeField from "./PayeeField";

/**
 * The combobox on props, the way `TransactionRegister.test.js` and
 * `SavingsGoalList.test.js` take theirs: what this pins down is the control's own
 * contract — when the list opens, what the keyboard does, and which of the two
 * answers it reports — not where the payees came from.
 *
 * The ranking underneath it is `payeeSearch.test.js`'s, and the round trip through
 * the store is in `TransactionsPage.test.js` and `AddModals.test.js`.
 */
const PAYEES = [
  { id: "p1", name: "Costco", defaultBudgetId: null },
  { id: "p2", name: "Costco Gas", defaultBudgetId: null },
  { id: "p3", name: "Shell", defaultBudgetId: null },
];

function renderField({ value = null, draftName = "", onType, describePayee } = {}) {
  const onCommit = jest.fn();
  render(
    <PayeeField
      surface="cell"
      label="Payee of this row"
      payees={PAYEES}
      value={value}
      draftName={draftName}
      onType={onType}
      describePayee={describePayee}
      onCommit={onCommit}
    />
  );
  return { onCommit, field: screen.getByLabelText("Payee of this row") };
}

const optionNames = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

test("the field reads as the payee it names, until it is typed in", () => {
  const { field } = renderField({ value: "p1" });
  expect(field).toHaveValue("Costco");

  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "she" } });
  // Formatted at rest, raw under the caret — the register's own contract for a
  // money cell, applied to a name.
  expect(field).toHaveValue("she");
});

test("a name with no record behind it yet is what the field shows at rest", () => {
  // The entry form's draft: typed, not created, and still on screen after a blur.
  const { field } = renderField({ draftName: "Ace Hardware" });
  expect(field).toHaveValue("Ace Hardware");
});

test("the list opens on focus and offers everything, before a letter is typed", () => {
  const { field } = renderField();
  fireEvent.focus(field);

  expect(screen.getByRole("listbox")).toBeInTheDocument();
  expect(field).toHaveAttribute("aria-expanded", "true");
  expect(optionNames()).toHaveLength(3);
});

test("what is typed narrows it, and the last row is the way out", () => {
  const { field } = renderField();
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "costco g" } });

  const list = within(screen.getByRole("listbox"));
  expect(list.getByRole("option", { name: /Costco Gas/ })).toBeInTheDocument();
  // Nobody is called "costco g", so creating one is offered.
  expect(list.getByRole("option", { name: /New payee/ })).toBeInTheDocument();
});

test("an exact name is not offered as a new payee", () => {
  const { field } = renderField();
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "costco" } });

  // It already exists, whatever the capitalisation.
  expect(screen.queryByRole("option", { name: /New payee/ })).not.toBeInTheDocument();
});

test("an option can carry a second line, which is what makes a default visible", () => {
  const { field } = renderField({ describePayee: (payee) => `usually ${payee.id}` });
  fireEvent.focus(field);

  // The hint rides on the option rather than beside it, so it is part of what a
  // screen reader announces for the row it belongs to.
  expect(screen.getByRole("option", { name: /Shell usually p3|Shellusually p3/ })).toBeInTheDocument();
});

describe("the keyboard", () => {
  test("nothing is active until an arrow key says so", () => {
    const { field } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "co" } });

    // The deliberate starting point: with the first match pre-selected, typing a
    // payee that does not exist and pressing Enter would take a different payee
    // that happens to share two letters with it.
    expect(field).not.toHaveAttribute("aria-activedescendant");
  });

  test("arrows walk the list and say which row is active", () => {
    const { field } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "costco" } });

    fireEvent.keyDown(field, { key: "ArrowDown" });
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveAttribute("aria-activedescendant", first.id);

    fireEvent.keyDown(field, { key: "ArrowDown" });
    const second = screen.getAllByRole("option")[1];
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveAttribute("aria-activedescendant", second.id);
  });

  test("arrowing back past the top returns to what was typed", () => {
    const { field } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "costco" } });

    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowUp" });
    // Rather than wrapping to the bottom of a list the user was walking down from
    // the top of.
    expect(field).not.toHaveAttribute("aria-activedescendant");
  });

  test("Enter takes the active option", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "costco" } });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith({ payeeId: "p1", name: "Costco" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("Enter with nothing active takes what was typed", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Ace Hardware" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith({ payeeId: null, name: "Ace Hardware" });
  });

  test("Enter is consumed while the list is open, so a form cannot submit under it", () => {
    const { field } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "costco" } });

    // Pressing Enter again submits, by which point the list is closed — without
    // this, one keystroke would both pick a payee and save the transaction.
    const consumed = !fireEvent.keyDown(field, { key: "Enter" });
    expect(consumed).toBe(true);
  });

  test("Escape closes the list and is not allowed to reach the dialog around it", () => {
    const { field, onCommit } = renderField({ value: "p1" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "she" } });

    let reachedTheDialog = false;
    const listener = () => {
      reachedTheDialog = true;
    };
    document.addEventListener("keydown", listener);
    fireEvent.keyDown(field, { key: "Escape" });
    document.removeEventListener("keydown", listener);

    // A `<dialog>` closes on Escape, and backing out of a list of payees must not
    // throw away the half-filled form around it.
    expect(reachedTheDialog).toBe(false);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Backing out is not an edit.
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue("Costco");
  });

  test("Tab commits and moves on", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "shell" } });
    fireEvent.keyDown(field, { key: "Tab" });

    expect(onCommit).toHaveBeenCalledWith({ payeeId: "p3", name: "Shell" });
  });
});

describe("what it commits", () => {
  test("a typed name that is a payee resolves to the payee, not to a name", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "  COSTCO  " } });
    fireEvent.blur(field);

    // Identity folds case and spacing, so this is Costco rather than a new payee
    // the store would then refuse as a duplicate.
    expect(onCommit).toHaveBeenCalledWith({ payeeId: "p1", name: "Costco" });
  });

  test("a name that is nobody is reported as a name, for the host to create", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Ace Hardware" } });
    fireEvent.blur(field);

    // The field never creates anything: *when* a payee comes into being differs
    // between the entry form and a register cell, and only they can say.
    expect(onCommit).toHaveBeenCalledWith({ payeeId: null, name: "Ace Hardware" });
  });

  test("clearing it is a real answer", () => {
    const { field, onCommit } = renderField({ value: "p1" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    expect(onCommit).toHaveBeenCalledWith({ payeeId: null, name: "" });
  });

  test("the payee it already names is not an edit", () => {
    const { field, onCommit } = renderField({ value: "p1" });
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("clearing a field that named nobody is not an edit either", () => {
    const { field, onCommit } = renderField();
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("every keystroke is reported where a host asks for it", () => {
    const onType = jest.fn();
    const { field } = renderField({ onType });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Ac" } });
    fireEvent.change(field, { target: { value: "Ace" } });

    // The entry form needs this: its submit can be clicked from a field that was
    // never blurred, and a saved transaction must not depend on the browser
    // firing a blur before the click.
    expect(onType).toHaveBeenNthCalledWith(1, "Ac");
    expect(onType).toHaveBeenNthCalledWith(2, "Ace");
  });
});

test("no payees yet is a plain field rather than a crash", () => {
  render(<PayeeField surface="cell" label="Payee" payees={[]} value={null} onCommit={() => {}} />);
  const field = screen.getByLabelText("Payee");
  fireEvent.focus(field);
  // Nothing to offer and nothing typed, so there is no list to open.
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
