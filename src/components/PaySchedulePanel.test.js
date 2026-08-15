import { fireEvent, render, screen } from "@testing-library/react";
import PaySchedulePanel from "./PaySchedulePanel";
import { EMPTY_SCHEDULE } from "../contexts/PayScheduleContext";
import { nextPayday, describeSchedule, isScheduleConfigured } from "../paySchedule";

/**
 * Props in, patches out — the same contract `CategoryPlanner.test.js` covers,
 * and for the same reason: the panel holds no state, so what is worth pinning
 * down is which fields a cadence asks for and which patch each one sends.
 *
 * `paycheck` is built here the way the page builds it, through the real
 * `paySchedule` functions, so the status line is read off the same arithmetic
 * the dashboard tile is.
 */
const TODAY = "2026-08-13";

function renderPanel(fields = {}, onChange = jest.fn()) {
  const schedule = { ...EMPTY_SCHEDULE, ...fields };
  const { nextDate } = nextPayday(schedule, TODAY);
  const paycheck = {
    configured: isScheduleConfigured(schedule),
    summary: describeSchedule(schedule),
    nextDate,
    daysUntil: nextDate == null ? null : 1,
  };

  render(
    <PaySchedulePanel schedule={schedule} paycheck={paycheck} error={null} onChange={onChange} />
  );
  return onChange;
}

test("asks nothing until the cadence is answered", () => {
  renderPanel();

  expect(screen.getByRole("combobox", { name: /how often/i })).toHaveValue("");
  expect(screen.queryByLabelText(/last paycheck/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/first payday/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/say how often you are paid/i);
});

test("an interval cadence asks for one real payday and nothing else", () => {
  renderPanel({ cadence: "biweekly", lastPaidOn: "2026-08-07" });

  expect(screen.getByLabelText(/last paycheck/i)).toHaveValue("2026-08-07");
  expect(screen.queryByLabelText(/pay period/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/first payday/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/paid every 2 weeks/i);
});

test("a custom interval asks for its length as well", () => {
  renderPanel({ cadence: "custom", lastPaidOn: "2026-08-07", periodDays: 10 });

  expect(screen.getByLabelText(/pay period/i)).toHaveValue(10);
});

test("twice a month asks for two days and no date", () => {
  renderPanel({ cadence: "semimonthly", daysOfMonth: [15, 31] });

  expect(screen.getByLabelText(/first payday/i)).toHaveValue(15);
  expect(screen.getByLabelText(/second payday/i)).toHaveValue(31);
  expect(screen.queryByLabelText(/last paycheck/i)).not.toBeInTheDocument();
  // Aug 15 2026 is a Saturday, so the pay lands on the Friday.
  expect(screen.getByRole("status")).toHaveTextContent(/on the 15th and the last day/i);
  expect(screen.getByRole("status")).toHaveTextContent(/Aug 14, 2026/);
});

test("monthly asks for one day, and the second field is not on screen", () => {
  renderPanel({ cadence: "monthly", daysOfMonth: [15, 31] });

  expect(screen.getByLabelText(/first payday/i)).toHaveValue(15);
  expect(screen.queryByLabelText(/second payday/i)).not.toBeInTheDocument();
});

test("editing one day sends both, so the other is not cleared by the patch", () => {
  const onChange = renderPanel({ cadence: "semimonthly", daysOfMonth: [15, 31] });

  fireEvent.blur(screen.getByLabelText(/second payday/i), { target: { value: "28" } });

  expect(onChange).toHaveBeenCalledWith({ daysOfMonth: [15, 28] });
});

test("a day cleared out is a blank the store can tell from a figure", () => {
  const onChange = renderPanel({ cadence: "semimonthly", daysOfMonth: [15, 31] });

  fireEvent.blur(screen.getByLabelText(/first payday/i), { target: { value: "" } });

  expect(onChange).toHaveBeenCalledWith({ daysOfMonth: [null, 31] });
});

test("the second day can be filled in before the first", () => {
  const onChange = renderPanel({ cadence: "semimonthly", daysOfMonth: [] });

  fireEvent.blur(screen.getByLabelText(/second payday/i), { target: { value: "31" } });

  expect(onChange).toHaveBeenCalledWith({ daysOfMonth: [null, 31] });
});

test("the cadence commits on change, since there is nothing to half-type", () => {
  const onChange = renderPanel({ cadence: "biweekly", lastPaidOn: "2026-08-07" });

  fireEvent.change(screen.getByRole("combobox", { name: /how often/i }), {
    target: { value: "semimonthly" },
  });

  expect(onChange).toHaveBeenCalledWith({ cadence: "semimonthly" });
});

test("the help text describes the fields rather than naming them", () => {
  renderPanel({ cadence: "semimonthly", daysOfMonth: [15, 31] });

  // Outside the label and pointed at, so the sentence is not folded into the
  // field's own accessible name.
  expect(screen.getByLabelText(/first payday/i)).toHaveAccessibleDescription(
    /31 means the last day of the month.*Friday before/i
  );
});
