import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UpcomingBills from "./UpcomingBills";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";

/**
 * The panel on props, with `onEnter` and `onSkip` as spies — the way
 * `ReconciliationList`'s siblings and `SavingsGoalList` take theirs. What it pins
 * down is the panel's own contract: which of the two actions a row reports, and
 * that being late is a word on the row rather than only a colour.
 *
 * Where the rows came from is `useUpcoming.test.js`'s, and whether pressing Enter
 * actually writes anything is `DashboardPage.test.js`'s.
 *
 * Wrapped in a router: the empty state links to Configuration.
 */
const schedule = (fields = {}) => ({
  id: "s1",
  kind: TRANSACTION_KINDS.OUTFLOW,
  amountCents: 180000,
  ...fields,
});

const row = (fields = {}) => ({
  key: `${fields.schedule?.id ?? "s1"}:${fields.date ?? "2026-10-01"}`,
  schedule: schedule(),
  date: "2026-10-01",
  dueInDays: 2,
  overdue: false,
  ...fields,
});

const describe_ = (entry) => ({
  name: entry.kind === TRANSACTION_KINDS.INFLOW ? "The lodger" : "Landlord",
  filing: "Everyday · Rent",
});

function renderPanel(props = {}) {
  const onEnter = jest.fn();
  const onSkip = jest.fn();
  render(
    <MemoryRouter future={routerFuture}>
      <UpcomingBills
        rows={[row()]}
        overdueCount={0}
        dueCents={180000}
        windowDays={28}
        scheduleCount={1}
        describe={describe_}
        onEnter={onEnter}
        onSkip={onSkip}
        {...props}
      />
    </MemoryRouter>
  );
  return { onEnter, onSkip };
}

test("a row says who, what for, how much and when", () => {
  renderPanel();

  expect(screen.getByText("Landlord")).toBeInTheDocument();
  // The account and the category stacked under the name rather than in two more
  // columns — the register's payee cell, one panel over.
  expect(screen.getByText("Everyday · Rent")).toBeInTheDocument();
  expect(screen.getByText("$1,800")).toBeInTheDocument();
  expect(screen.getByText(/in 2 days/)).toBeInTheDocument();
});

test("the total is what is going out, said as a sentence", () => {
  renderPanel({ dueCents: 245000 });
  expect(screen.getByText("$2,450 going out in the next 28 days.")).toBeInTheDocument();
});

test("being late is a word, not only a colour", () => {
  renderPanel({
    rows: [row({ dueInDays: -3, overdue: true, date: "2026-09-26" })],
    overdueCount: 1,
  });

  // Colour is never the only channel here, the rule `ReconciliationList` keeps for
  // a reconciliation nobody has done.
  expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
  expect(screen.getByText("1 is overdue")).toBeInTheDocument();
});

test("more than one overdue reads as more than one", () => {
  renderPanel({
    rows: [row({ overdue: true, dueInDays: -1 }), row({ key: "s2:x", overdue: true, dueInDays: -2 })],
    overdueCount: 2,
  });
  expect(screen.getByText("2 are overdue")).toBeInTheDocument();
});

test("nothing late says so, rather than saying nothing", () => {
  renderPanel();
  expect(screen.getByText("Nothing overdue")).toBeInTheDocument();
});

test("a bill due today is due today", () => {
  renderPanel({ rows: [row({ dueInDays: 0 })] });
  expect(screen.getByText(/Today/)).toBeInTheDocument();
});

test("money in is signed, since there is one column for both directions", () => {
  renderPanel({
    rows: [row({ schedule: schedule({ kind: TRANSACTION_KINDS.INFLOW, amountCents: 40000 }) })],
  });

  // The accents that mean income and expense are tuned for the dark chrome and
  // cannot carry text on this surface, so the sign is the channel.
  expect(screen.getByText("+$400")).toBeInTheDocument();
});

describe("the two actions", () => {
  test("Enter reports the occurrence, and writes nothing itself", () => {
    const { onEnter, onSkip } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /^Enter Landlord due/ }));

    // The occurrence and not the schedule: a weekly bill's rows are four different
    // things to record.
    expect(onEnter).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-01" }));
    expect(onSkip).not.toHaveBeenCalled();
  });

  test("Skip reports it too, and the two are told apart", () => {
    const { onEnter, onSkip } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /^Skip Landlord due/ }));

    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-01" }));
    expect(onEnter).not.toHaveBeenCalled();
  });

  test("each row's buttons name the date, so a weekly bill is unambiguous", () => {
    renderPanel({
      rows: [row({ date: "2026-10-01" }), row({ key: "s1:2026-10-08", date: "2026-10-08" })],
    });

    expect(screen.getByRole("button", { name: "Enter Landlord due Oct 1, 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Landlord due Oct 8, 2026" })).toBeInTheDocument();
  });
});

describe("with nothing on it", () => {
  test("no schedules at all points at where one is written", () => {
    renderPanel({ rows: [], scheduleCount: 0, dueCents: 0 });

    expect(screen.getByRole("link", { name: /add a scheduled transaction/i })).toHaveAttribute(
      "href",
      "/plan"
    );
  });

  test("everything dealt with is a different fact and reads as one", () => {
    renderPanel({ rows: [], scheduleCount: 3, dueCents: 0 });

    // A household with three schedules and nothing due has done the work; telling
    // it to go and add a schedule would be telling it the opposite.
    expect(screen.getByText(/everything scheduled is up to date/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("no rows means no count either way", () => {
    renderPanel({ rows: [], scheduleCount: 0 });
    // "Nothing overdue" beside "nothing scheduled" would be noise dressed as
    // reassurance.
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });
});

test("the heading is the panel's, not the page's h1", () => {
  renderPanel();
  expect(within(screen.getByRole("heading", { level: 2 })).getByText("Upcoming")).toBeInTheDocument();
});
