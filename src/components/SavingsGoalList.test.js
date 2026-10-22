import { fireEvent, render, screen, within } from "@testing-library/react";
import SavingsGoalList from "./SavingsGoalList";

/**
 * The goal list with its rows handed to it. What this pins down is the Add
 * input's contract — additive semantics (any typed figure adds to the running
 * total), pace display, and error surfacing. The store end is in
 * `SavingsGoalAssignmentsContext`'s own coverage.
 */

const goal = (fields) => ({
  goalId: fields.name,
  targetCents: 500000,
  targetDate: null,
  carriedInCents: 0,
  assignedCents: 0,
  availableCents: 0,
  heldCents: 0,
  holdings: [],
  savedCents: 0,
  remainingCents: 500000,
  ...fields,
});

const CAMERA = goal({ name: "Camera", targetDate: "2027-05-01", assignedCents: 1234050 });

const WEDDING = goal({ name: "Wedding" });

function renderList({ rows = [CAMERA, WEDDING], onAssign } = {}) {
  const assign = onAssign ?? jest.fn(() => ({ ok: true }));
  render(
    <SavingsGoalList
      rows={rows}
      onAssign={assign}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  );
  return assign;
}

const addField = (name) => screen.getByLabelText(`Add to ${name}`);

test("the add input always starts blank — it adds, it does not display a stored total", () => {
  renderList();

  // Camera has $12,340.50 already assigned, but the field is blank: the user
  // is typing how much to add, not restating what is already there.
  expect(addField("Camera")).toHaveValue("");
  expect(addField("Wedding")).toHaveValue("");
});

test("the field clears after a successful add", () => {
  renderList();

  const field = addField("Camera");
  fireEvent.change(field, { target: { value: "500" } });
  fireEvent.blur(field);

  expect(field).toHaveValue("");
});

test("a refused assignment says why, under the row, and the field clears", () => {
  const assign = renderList({
    onAssign: jest.fn(() => ({ ok: false, error: "Not enough to assign." })),
  });

  const field = addField("Camera");
  fireEvent.change(field, { target: { value: "500" } });
  fireEvent.blur(field);

  // Camera has 1234050 assigned; adding 50000 yields 1284050.
  expect(assign).toHaveBeenCalledWith(expect.objectContaining({ goalId: "Camera" }), 1284050);
  expect(screen.getByRole("alert")).toHaveTextContent("Not enough to assign.");
  expect(field).toHaveValue("");
});

test("invalid input clears silently without calling onAssign", () => {
  const assign = renderList();

  const field = addField("Camera");
  fireEvent.change(field, { target: { value: "twelve" } });
  fireEvent.blur(field);

  expect(assign).not.toHaveBeenCalled();
  expect(field).toHaveValue("");
});

test("the message belongs to one row, and a later success clears it", () => {
  const assign = jest.fn(() => ({ ok: false, error: "Not enough to assign." }));
  renderList({ onAssign: assign });

  const camera = addField("Camera");
  fireEvent.change(camera, { target: { value: "500" } });
  fireEvent.blur(camera);

  // The alert sits under the row it is about — inside the table, spanning all
  // columns. Seven columns: goal, target, saved, remaining, pace, add, actions.
  const alertRow = screen.getByRole("alert").closest("tr");
  expect(within(alertRow).getByRole("cell")).toHaveAttribute("colspan", "7");
  expect(screen.getByRole("table").contains(alertRow)).toBe(true);

  assign.mockReturnValue({ ok: true });
  const wedding = addField("Wedding");
  fireEvent.change(wedding, { target: { value: "250" } });
  fireEvent.blur(wedding);

  // Wedding has 0 assigned; adding 25000 = 25000.
  expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Wedding" }), 25000);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a target date reads as a date rather than as the ISO string it is stored as", () => {
  renderList();

  expect(screen.getByText("By May 1, 2027")).toBeInTheDocument();
});

/**
 * Every typed figure is a delta — the amount being added to the running total.
 * A leading plus is redundant but accepted (it means the same thing). A leading
 * minus subtracts. This is a deliberate change from the old "bare figure sets,
 * plus-prefix adds" contract: goals accumulate, they do not have a monthly
 * figure to reset.
 */
describe("additive input: every figure is added to what is already there", () => {
  test("a bare figure and a plus-prefixed figure both add to the running total", () => {
    const assign = renderList();
    const field = addField("Camera");

    fireEvent.change(field, { target: { value: "250" } });
    fireEvent.blur(field);
    // Camera has 1234050 assigned; adding 25000 = 1259050.
    expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Camera" }), 1259050);

    fireEvent.change(field, { target: { value: "+250" } });
    fireEvent.blur(field);
    // Row is static in this test (mock does not update the store), so
    // assignedCents is still 1234050.
    expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Camera" }), 1259050);
  });

  test("money notation ($, commas, spaces) is parsed the way toCents reads it", () => {
    const assign = renderList();

    const field = addField("Camera");
    fireEvent.change(field, { target: { value: "+ $1,250.50" } });
    fireEvent.blur(field);
    // Camera has 1234050 assigned; adding 125050 = 1359100.
    expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Camera" }), 1359100);
  });

  test("a minus subtracts: typing −250 pulls $250 back out of the goal", () => {
    const assign = renderList();

    const field = addField("Camera");
    fireEvent.change(field, { target: { value: "-250" } });
    fireEvent.blur(field);
    // Camera has 1234050 assigned; subtracting 25000 = 1209050.
    expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Camera" }), 1209050);
  });

  test("adding to a goal with nothing assigned yet is just the typed figure", () => {
    const assign = renderList();

    const field = addField("Wedding");
    fireEvent.change(field, { target: { value: "250" } });
    fireEvent.blur(field);

    expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Wedding" }), 25000);
  });
});

/**
 * A goal whose money is already invested. The two piles are stated apart — the
 * holding under the goal's name, the assignment under the headline — because
 * the household is the only thing that can move one into the other, and a
 * single total would hide money that was assigned *and* already swept across.
 */
test("held money counts towards the goal and is named apart from what the budget assigned", () => {
  const HOUSE = goal({
    name: "House deposit",
    targetCents: 4_000_000,
    availableCents: 120000,
    assignedCents: 0,
    heldCents: 1_850_000,
    holdings: [{ accountId: "a1", name: "Brokerage", countedCents: 1_850_000 }],
    savedCents: 1_970_000,
    remainingCents: 2_030_000,
  });
  renderList({ rows: [HOUSE] });

  expect(screen.getByRole("columnheader", { name: "Saved" })).toBeInTheDocument();
  expect(screen.getByText("$19,700")).toBeInTheDocument();
  expect(screen.getByText("$18,500 held in Brokerage")).toBeInTheDocument();
  expect(screen.getByText("$1,200 assigned")).toBeInTheDocument();
  expect(screen.getByText("$20,300")).toBeInTheDocument();
});

test("a goal funded out of the budget alone says nothing about holdings", () => {
  renderList();

  expect(screen.queryByText(/held/)).not.toBeInTheDocument();
  expect(screen.queryByText(/assigned$/)).not.toBeInTheDocument();
});
