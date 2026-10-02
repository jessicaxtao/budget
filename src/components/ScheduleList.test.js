import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppProviders from "../contexts/AppProviders";
import ScheduleList from "./ScheduleList";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { routerFuture } from "../routerFuture";
import { addDays, formatDateMedium, todayISO } from "../utils";

/**
 * The panel and its modal through the real stores, `PayeeList.test.js`'s call and
 * its reason: this one reads four of its own, and what is worth covering is the
 * round trip — a schedule written here is a schedule the dashboard can offer, and
 * the payee typed into the form has to become a real payee for the row to name one.
 *
 * The store's refusals and the cursor rules are in `useUpcoming.test.js`. What is
 * here is the panel's contract and the form's seeding.
 *
 * Wrapped in a router: the form's blocked state links to Configuration.
 */
const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 500000,
  openingDate: null,
  reconciledOn: null,
};

const BUDGETS = [
  { id: "b1", name: "Rent", groupId: null, plannedCents: 180000, bucket: "essentials" },
  { id: "b2", name: "Fuel", groupId: null, plannedCents: 12000, bucket: "essentials" },
];

const TODAY = todayISO();

const schedule = (fields = {}) => ({
  id: "s1",
  kind: TRANSACTION_KINDS.OUTFLOW,
  payeeId: "p1",
  amountCents: 180000,
  accountId: "acc1",
  budgetId: "b1",
  description: "",
  cadence: "monthly",
  startDate: "2026-01-15",
  endsOn: null,
  enteredThrough: null,
  ...fields,
});

function seed({ schedules = [], payees = [{ id: "p1", name: "Landlord", defaultBudgetId: "b1" }], ...rest } = {}) {
  localStorage.setItem("accounts", JSON.stringify([ACCOUNT]));
  localStorage.setItem("budgets", JSON.stringify(BUDGETS));
  localStorage.setItem("payees", JSON.stringify(payees));
  localStorage.setItem("schedules", JSON.stringify(schedules));
  for (const [key, value] of Object.entries(rest)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function renderPanel() {
  return render(
    <AppProviders>
      <MemoryRouter future={routerFuture}>
        <ScheduleList />
      </MemoryRouter>
    </AppProviders>
  );
}

const stored = (key) => JSON.parse(localStorage.getItem(key));
const rowOf = (name) => screen.getByText(name).closest("tr");

beforeEach(() => {
  localStorage.clear();
});

describe("the list", () => {
  test("a row says what the schedule is, in the one phrase both screens use", () => {
    seed({ schedules: [schedule()] });
    renderPanel();

    const row = within(rowOf("Landlord"));
    expect(row.getByText("monthly on the 15th")).toBeInTheDocument();
    expect(row.getByText("$1,800")).toBeInTheDocument();
    // Where it comes from and what it counts as, stacked under the name.
    expect(row.getByText("Everyday · Rent")).toBeInTheDocument();
  });

  test("the next one still outstanding is the date shown, even in the past", () => {
    seed({ schedules: [schedule({ startDate: addDays(TODAY, -40), cadence: "monthly" })] });
    renderPanel();

    // Reading a date a month gone is how this panel says a bill has been sitting
    // there — flooring it at today would hide exactly that.
    expect(
      within(rowOf("Landlord")).getByText(formatDateMedium(addDays(TODAY, -40)))
    ).toBeInTheDocument();
  });

  test("one past its end date reads as finished rather than as due", () => {
    seed({
      schedules: [
        schedule({
          startDate: "2026-01-15",
          endsOn: "2026-03-15",
          enteredThrough: "2026-03-15",
        }),
      ],
    });
    renderPanel();

    expect(within(rowOf("Landlord")).getByText("Finished")).toBeInTheDocument();
    expect(within(rowOf("Landlord")).getByText("until Mar 15, 2026")).toBeInTheDocument();
  });

  test("a schedule with no payee reads by its note", () => {
    seed({ schedules: [schedule({ payeeId: null, description: "Storage unit" })] });
    renderPanel();

    expect(screen.getByText("Storage unit")).toBeInTheDocument();
  });

  test("money in is signed, and files itself as income", () => {
    seed({
      schedules: [
        schedule({ kind: TRANSACTION_KINDS.INFLOW, budgetId: null, amountCents: 40000 }),
      ],
    });
    renderPanel();

    const row = within(rowOf("Landlord"));
    expect(row.getByText("+$400")).toBeInTheDocument();
    expect(row.getByText("Everyday · Income to assign")).toBeInTheDocument();
  });

  test("removing one keeps the ledger alone", () => {
    seed({ schedules: [schedule()] });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Remove schedule: Landlord" }));

    expect(stored("schedules")).toEqual([]);
    // Stopping a standing order does not unpay the rent, which is the whole reason
    // no transaction names a schedule.
    expect(screen.getByText(/nothing scheduled yet/i)).toBeInTheDocument();
  });

  test("nothing scheduled says what belongs here", () => {
    seed();
    renderPanel();

    expect(screen.getByText(/nothing scheduled yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule a transaction" })).toBeInTheDocument();
  });
});

describe("writing one down", () => {
  function openForm() {
    seed();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Schedule a transaction" }));
  }

  test("a whole one lands, and the payee typed becomes a real payee", () => {
    openForm();

    const payee = screen.getByLabelText("Paid to");
    fireEvent.focus(payee);
    fireEvent.change(payee, { target: { value: "Storage Co" } });
    fireEvent.blur(payee);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "$95.50" } });
    fireEvent.change(screen.getByLabelText("Date of the first one"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));

    const created = stored("payees").find((entry) => entry.name === "Storage Co");
    expect(created).toBeTruthy();
    expect(stored("schedules")).toEqual([
      {
        id: expect.any(String),
        kind: TRANSACTION_KINDS.OUTFLOW,
        payeeId: created.id,
        amountCents: 9550,
        accountId: "acc1",
        budgetId: "b1",
        description: "",
        cadence: "monthly",
        startDate: "2026-10-01",
        endsOn: null,
        enteredThrough: null,
      },
    ]);
  });

  test("a payee's default category seeds the form, as it does the entry form", () => {
    seed({ payees: [{ id: "p1", name: "Shell", defaultBudgetId: "b2" }] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Schedule a transaction" }));

    const payee = screen.getByLabelText("Paid to");
    fireEvent.focus(payee);
    fireEvent.change(payee, { target: { value: "shell" } });
    fireEvent.blur(payee);

    // A schedule *is* an entry form, one written in advance — so the default
    // applies here for the same reason it applies there.
    expect(screen.getByLabelText("Category")).toHaveValue("b2");
  });

  test("money in asks for no category and takes none", () => {
    openForm();

    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    expect(screen.getByLabelText("Refund to category")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));

    expect(stored("schedules")[0]).toMatchObject({
      kind: TRANSACTION_KINDS.INFLOW,
      budgetId: null,
    });
  });

  test("a refused figure keeps the form open with the reason on it", () => {
    openForm();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));

    expect(screen.getByRole("alert")).toHaveTextContent("greater than zero");
    expect(stored("schedules")).toEqual([]);
  });

  test("the first date defaults to today, not to a date already overdue", () => {
    openForm();
    expect(screen.getByLabelText("Date of the first one")).toHaveValue(TODAY);
  });
});

describe("editing one", () => {
  test("the form opens on the record, with both faces of the amount right", () => {
    seed({ schedules: [schedule({ amountCents: 125050 })] });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule: Landlord" }));

    // `amountEditing`, not a bare `fromCents`: $1,250.50 must not seed as "1250.5".
    expect(screen.getByLabelText("Amount")).toHaveValue("1250.50");
    expect(screen.getByLabelText("Date of the first one")).toHaveValue("2026-01-15");
    expect(screen.getByLabelText("Category")).toHaveValue("b1");
    expect(screen.getByLabelText("Paid to")).toHaveValue("Landlord");
  });

  test("saving restates the schedule and leaves the cursor where it was", () => {
    seed({ schedules: [schedule({ enteredThrough: "2026-02-15" })] });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule: Landlord" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1,850.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(stored("schedules")[0].amountCents).toBe(185000);
    // A rent rise is not a reason to re-offer every month already entered.
    expect(stored("schedules")[0].enteredThrough).toBe("2026-02-15");
  });

  test("correcting the payee on an existing schedule does not refile it", () => {
    seed({
      schedules: [schedule({ budgetId: "b1" })],
      payees: [
        { id: "p1", name: "Landlord", defaultBudgetId: "b1" },
        { id: "p2", name: "Shell", defaultBudgetId: "b2" },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule: Landlord" }));
    const payee = screen.getByLabelText("Paid to");
    fireEvent.focus(payee);
    fireEvent.change(payee, { target: { value: "shell" } });
    fireEvent.blur(payee);

    // The category question already has an answer here, and a default is only a
    // default until there is one — the line the register draws, one surface over.
    expect(screen.getByLabelText("Category")).toHaveValue("b1");
  });

  test("an account the list no longer offers keeps an option of its own", () => {
    seed({ schedules: [schedule({ accountId: "gone" })] });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule: Landlord" }));

    // A select given a value it has no option for falls back to its first, which
    // would silently re-point the schedule by being looked at.
    expect(screen.getByLabelText("Paid from")).toHaveValue("gone");
  });
});
