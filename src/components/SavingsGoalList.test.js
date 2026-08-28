import { fireEvent, render, screen, within } from "@testing-library/react";
import SavingsGoalList from "./SavingsGoalList";

/**
 * The goal list with its rows handed to it, since that is how the page gives
 * them — what this pins down is the row's editing contract, not how the goals
 * got there or what the store does with an assignment. The store end is in
 * `SavingsGoalAssignmentsContext`'s own coverage.
 *
 * `onAssign` is a spy so a rejection can be staged: what matters at this level
 * is what the row does with the answer it gets back, and a refusal that reverts
 * the figure without saying why reads as the app having lost the edit.
 */
const PERIOD = "2026-08";

const goal = (fields) => ({
  goalId: fields.name,
  targetCents: 500000,
  targetDate: null,
  carriedInCents: 0,
  assignedCents: 0,
  availableCents: 0,
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
      period={PERIOD}
      onAssign={assign}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  );
  return assign;
}

const assignField = (name) => screen.getByLabelText(`Assign to ${name} this period`);

test("the period's figure is seeded raw with both decimal places, and a goal nobody has funded stays blank", () => {
  renderList();

  // "1234050" cents is $12,340.50 — a bare `fromCents` would seed "12340.5" and
  // the column would never line up on its decimal point, which is the same
  // defect that keeps every money field in the app off `type="number"`.
  expect(assignField("Camera")).toHaveValue("12340.50");
  // Blank rather than "0": a row nobody has put anything into this month has no
  // stored record at all, and the placeholder is what says so.
  expect(assignField("Wedding")).toHaveValue("");
});

test("a refused assignment says why, on the row it belongs to, and puts the stored figure back", () => {
  const assign = renderList({
    onAssign: jest.fn(() => ({ ok: false, error: "Enter an amount." })),
  });

  const field = assignField("Camera");
  fireEvent.change(field, { target: { value: "twelve" } });
  fireEvent.blur(field);

  expect(assign).toHaveBeenCalledWith(expect.objectContaining({ goalId: "Camera" }), null);
  expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount.");
  // Reverted to what the store actually holds, in the shape the field seeds in.
  expect(field).toHaveValue("12340.50");
});

test("the message belongs to one row, and a later success clears it", () => {
  const assign = jest.fn(() => ({ ok: false, error: "Enter an amount." }));
  renderList({ onAssign: assign });

  const camera = assignField("Camera");
  fireEvent.change(camera, { target: { value: "twelve" } });
  fireEvent.blur(camera);

  // The alert sits under the row it is about, not beside the cell — so it is
  // inside the table and spans it, rather than widening a column the eye is
  // reading down. Six columns, one of them the actions column added later:
  // the span is derived from the list, so it cannot go stale.
  const alertRow = screen.getByRole("alert").closest("tr");
  expect(within(alertRow).getByRole("cell")).toHaveAttribute("colspan", "6");
  expect(screen.getByRole("table").contains(alertRow)).toBe(true);

  // A rejection is a reply to the edit just made: one message at a time, on the
  // row that earned it.
  assign.mockReturnValue({ ok: true });
  const wedding = assignField("Wedding");
  fireEvent.change(wedding, { target: { value: "250" } });
  fireEvent.blur(wedding);

  expect(assign).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: "Wedding" }), 25000);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a target date reads as a date rather than as the ISO string it is stored as", () => {
  renderList();

  expect(screen.getByText("By May 1, 2027")).toBeInTheDocument();
});
