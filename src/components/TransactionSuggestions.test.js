import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import AddTransactionModal from "./AddTransactionModal";
import ScheduleList from "./ScheduleList";
import AddScheduleModal from "./AddScheduleModal";
import DashboardPage from "../pages/DashboardPage";
import { routerFuture } from "../routerFuture";
import { addDays, todayISO, formatDateMedium } from "../utils";

const TODAY = todayISO();
const base = { kind: "outflow", payeeId: "p", accountId: "a", budgetId: "b2", amountCents: 10000 };
const transactions = [-14, -7, 0].map((offset, index) => ({ ...base, id: `t${index}`, date: addDays(TODAY, offset) }));
const stored = (key) => JSON.parse(localStorage.getItem(key));
function seed(changes = {}) {
  localStorage.clear();
  localStorage.setItem("dashboardBudgetExplainerDismissed", "true");
  for (const [key, value] of Object.entries({ transactions, schedules: [],
    payees: [{ id: "p", name: "Gym" }, { id: "other", name: "Market" }],
    budgets: [{ id: "b1", name: "Groceries", plannedCents: 0 }, { id: "b2", name: "Fitness", plannedCents: 0 }],
    accounts: [{ id: "a", name: "Checking", type: "asset", scope: "on-budget", assetClass: "Cash", openingBalanceCents: 50000 }], ...changes })) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}
function mount(children) {
  return render(<AppProviders><MemoryRouter future={routerFuture}>{children}</MemoryRouter></AppProviders>);
}
function choosePayee(name = "Gym") {
  fireEvent.change(screen.getByLabelText("Paid to"), { target: { value: name } });
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
}

test("category is explained and requires Apply; saving does not silently teach a default", () => {
  seed();
  mount(<AddTransactionModal show handleClose={() => {}} />);
  choosePayee();
  expect(screen.getByLabelText("Category")).toHaveValue("b1");
  expect(screen.getByText(/used for 3 of your last 3/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply suggested category" }));
  expect(screen.getByLabelText("Category")).toHaveValue("b2");
  expect(screen.queryByRole("button", { name: "Apply suggested category" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(stored("transactions").find((row) => row.amountCents === 20000).budgetId).toBe("b2");
  expect(stored("payees").find((row) => row.id === "p").defaultBudgetId).toBeNull();
});

test("changing the payee clears stale suggestions and manual filing hides them", () => {
  seed();
  mount(<AddTransactionModal show handleClose={() => {}} />);
  choosePayee();
  choosePayee("Market");
  expect(screen.queryByRole("button", { name: "Apply suggested category" })).not.toBeInTheDocument();
  choosePayee();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "b2" } });
  expect(screen.queryByRole("button", { name: "Apply suggested category" })).not.toBeInTheDocument();
  choosePayee("Market");
  expect(screen.getByLabelText("Category")).toHaveValue("b2");
});

test("saved defaults take priority and a split never exposes the single-category suggestion", () => {
  seed({ payees: [{ id: "p", name: "Gym", defaultBudgetId: "b1" }] });
  const first = mount(<AddTransactionModal show handleClose={() => {}} />);
  choosePayee();
  expect(screen.queryByRole("button", { name: "Apply suggested category" })).not.toBeInTheDocument();
  first.unmount();
  seed();
  mount(<AddTransactionModal show handleClose={() => {}} />);
  choosePayee();
  fireEvent.click(screen.getByRole("button", { name: "Split it between categories" }));
  expect(screen.queryByRole("button", { name: "Apply suggested category" })).not.toBeInTheDocument();
});

test("reviewing a discovered schedule seeds editable values and creates no ledger entries", () => {
  seed();
  mount(<ScheduleList />);
  fireEvent.click(screen.getByText("Scheduled transactions"));
  fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
  const form = within(screen.getByRole("dialog"));
  expect(form.getByLabelText("Amount")).toHaveValue("100.00");
  expect(form.getByLabelText("Category")).toHaveValue("b2");
  expect(form.getByLabelText("Date of the first one")).toHaveValue(addDays(TODAY, 7));
  fireEvent.change(form.getByLabelText("Amount"), { target: { value: "105" } });
  fireEvent.click(form.getByRole("button", { name: "Schedule it" }));
  expect(stored("schedules")).toEqual([expect.objectContaining({ amountCents: 10500, budgetId: "b2", cadence: "weekly", enteredThrough: null, occurrenceDecisions: {} })]);
  expect(stored("transactions")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Review schedule" })).not.toBeInTheDocument();
});

test.each([null, "b2"])("a suggested inflow preserves its income/refund filing on open: %s", (budgetId) => {
  seed();
  const draft = { ...base, kind: "inflow", budgetId, cadence: "monthly", startDate: "2026-11-15" };
  mount(<AddScheduleModal show draft={draft} handleClose={() => {}} />);
  expect(screen.getByLabelText("Refund to category")).toHaveValue(budgetId ?? "");
  fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));
  expect(stored("schedules")[0]).toMatchObject({ kind: "inflow", budgetId });
});

test("a shorter next month preserves the anchor day, while changing the first date resets it", () => {
  seed();
  const draft = { ...base, cadence: "monthly", startDate: "2027-02-28", anchorDay: 31 };
  const first = mount(<AddScheduleModal show draft={draft} handleClose={() => {}} />);
  expect(screen.getByText(/Repeats on the 31st/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));
  expect(stored("schedules")[0]).toMatchObject({ startDate: "2027-02-28", anchorDay: 31 });
  first.unmount();
  mount(<AddScheduleModal show schedule={stored("schedules")[0]} handleClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Date of the first one"), { target: { value: "2027-02-20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(stored("schedules")[0].startDate).toBe("2027-02-20");
  expect(stored("schedules")[0].anchorDay).toBeUndefined();
});

test("a rejected suggestion edit keeps the review form and its evidence intact", () => {
  seed();
  mount(<ScheduleList />);
  fireEvent.click(screen.getByText("Scheduled transactions"));
  fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
  const form = within(screen.getByRole("dialog"));
  fireEvent.change(form.getByLabelText("Amount"), { target: { value: "bad amount" } });
  fireEvent.click(form.getByRole("button", { name: "Schedule it" }));
  expect(form.getByRole("alert")).toHaveTextContent(/greater than zero/);
  expect(form.getByLabelText("Amount")).toHaveValue("bad amount");
  expect(stored("schedules")).toEqual([]);
});

test("dismissing a suggestion writes nothing", () => {
  seed();
  function NavigationHarness() {
    const [visible, setVisible] = useState(true);
    return <><button onClick={() => setVisible(!visible)}>Switch page</button>{visible && <ScheduleList />}</>;
  }
  mount(<NavigationHarness />);
  fireEvent.click(screen.getByText("Scheduled transactions"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss for now" }));
  expect(screen.queryByRole("button", { name: "Review schedule" })).not.toBeInTheDocument();
  expect(stored("schedules")).toEqual([]);
  expect(stored("transactions")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Switch page" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch page" }));
  fireEvent.click(screen.getByText("Scheduled transactions"));
  expect(screen.queryByRole("button", { name: "Review schedule" })).not.toBeInTheDocument();
});

const scheduled = { ...base, id: "s", cadence: "weekly", startDate: addDays(TODAY, -7), enteredThrough: null };
test("dashboard offers competing payments explicitly and confirmation keeps older reminders visible", () => {
  seed({ schedules: [scheduled], transactions: [transactions[2], { ...transactions[2], id: "second", description: "Separate purchase" }] });
  mount(<DashboardPage />);
  expect(screen.getByText(/several payments could match/i)).toBeInTheDocument();
  const before = stored("transactions");
  fireEvent.click(screen.getByRole("button", { name: `Use payment 1 for Gym due ${formatDateMedium(TODAY)}` }));
  expect(stored("transactions")).toEqual(before);
  expect(stored("schedules")[0].occurrenceDecisions[TODAY].status).toBe("recorded");
  expect(screen.getByRole("button", { name: `Enter Gym due ${formatDateMedium(addDays(TODAY, -7))}` })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: `Enter Gym due ${formatDateMedium(TODAY)}` })).not.toBeInTheDocument();
});

test("a reminder changed remotely while its form is open refuses to create another payment", () => {
  seed({ schedules: [scheduled], transactions: [] });
  mount(<DashboardPage />);
  fireEvent.click(screen.getByRole("button", { name: `Enter Gym due ${formatDateMedium(TODAY)}` }));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "schedules", newValue: JSON.stringify([
      { ...scheduled, occurrenceDecisions: { [TODAY]: { status: "skipped" } } },
    ]) }));
  });
  fireEvent.click(screen.getByRole("button", { name: "Record it" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/already handled/);
  expect(stored("transactions")).toEqual([]);
});

test("missing linked payments stay handled and can be explicitly reopened", () => {
  seed({ schedules: [{ ...scheduled, occurrenceDecisions: { [TODAY]: { status: "recorded", transactionId: "gone" } } }] });
  mount(<ScheduleList />);
  fireEvent.click(screen.getByText("Scheduled transactions"));
  fireEvent.click(screen.getByText("Handled occurrences"));
  expect(screen.getByText(/linked payment no longer exists/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `Reopen Gym due ${formatDateMedium(TODAY)}` }));
  expect(stored("schedules")[0].occurrenceDecisions).toEqual({});
  expect(stored("transactions")).toHaveLength(3);
});
