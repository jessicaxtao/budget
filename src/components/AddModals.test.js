import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import AddExpenseModal from "./AddExpenseModal";
import AddBudgetModal from "./AddBudgetModal";
import AddIncomeModal from "./AddIncomeModal";
import AssignIncomeModal from "./AssignIncomeModal";
import AppProviders from "../contexts/AppProviders";
import { addMonths, currentPeriod, todayISO } from "../utils";

// Mirrors how TransactionsPage drives the modals: mounted once for the life of
// the page and toggled with `show`, with the budget it was opened from varying
// between openings. The bugs these tests cover only appear across repeated
// open/close cycles, which is exactly what a conditionally-rendered modal would
// have hidden.
function ExpenseHarness({ budgetIds }) {
  const [show, setShow] = useState(false);
  const [budgetId, setBudgetId] = useState();
  return (
    <>
      {budgetIds.map((id) => (
        <button
          key={id ?? "header"}
          onClick={() => {
            setBudgetId(id);
            setShow(true);
          }}
        >
          open {id ?? "header"}
        </button>
      ))}
      <AddExpenseModal show={show} defaultBudgetId={budgetId} handleClose={() => setShow(false)} />
    </>
  );
}

// The assign modal is period-scoped, so the harness can step the month the same
// way the page's stepper does — including while the modal is open.
function AssignHarness() {
  const [show, setShow] = useState(false);
  const [period, setPeriod] = useState(currentPeriod);
  return (
    <>
      <button onClick={() => setShow(true)}>open</button>
      <button onClick={() => setPeriod(addMonths(period, 1))}>next month</button>
      <AssignIncomeModal show={show} period={period} handleClose={() => setShow(false)} />
    </>
  );
}

function SimpleHarness({ Modal }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button onClick={() => setShow(true)}>open</button>
      <Modal show={show} handleClose={() => setShow(false)} />
    </>
  );
}

const TWO_BUDGETS = [
  { id: "a", name: "Groceries", max: 400 },
  { id: "b", name: "Fuel", max: 120 },
];

beforeEach(() => {
  localStorage.clear();
});

function seedBudgets(budgets) {
  localStorage.setItem("budgets", JSON.stringify(budgets));
}

function seedIncome(dollars) {
  localStorage.setItem(
    "income",
    JSON.stringify([{ id: "i1", description: "Pay", amount: dollars, date: todayISO() }])
  );
}

describe("assigning income to categories", () => {
  function openWith(budgets, dollars) {
    seedBudgets(budgets);
    if (dollars != null) seedIncome(dollars);
    render(
      <AppProviders>
        <AssignHarness />
      </AppProviders>
    );
    fireEvent.click(screen.getByText("open"));
  }

  test("filling a category tops it up to its estimate and the pool drops", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    expect(screen.getByRole("status")).toHaveTextContent("$1,000");

    fireEvent.click(screen.getByRole("button", { name: "Fill" }));

    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue(400);
    expect(screen.getByRole("status")).toHaveTextContent("$600");
  });

  test("the remaining figure tracks typing, and goes negative past the pool", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "250" } });
    expect(screen.getByRole("status")).toHaveTextContent("$750");

    // Over-assigning is allowed and has to be visible, not blocked.
    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "1200" } });
    expect(screen.getByRole("status")).toHaveTextContent("-$200");
  });

  test("saving writes every row, and reopening shows what was stored", () => {
    openWith(
      [
        { id: "a", name: "Groceries", max: 400 },
        { id: "b", name: "Fuel", max: 120 },
      ],
      1000
    );

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Assign to Fuel"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem("assignments"))).toHaveLength(2);

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue(300);
    expect(screen.getByRole("status")).toHaveTextContent("$580");
  });

  test("abandoned typing does not survive a reopen", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue(null);
    expect(screen.getByRole("status")).toHaveTextContent("$1,000");
  });

  test("a negative assignment is accepted — it pulls money back out", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem("assignments"))[0].assignedCents).toBe(-5000);
  });

  test("stepping the month underneath an open modal re-seeds it", () => {
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    fireEvent.change(screen.getByLabelText("Assign to Groceries"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue(300);

    fireEvent.click(screen.getByText("next month"));

    // Next month has its own assignment, not this month's carried over.
    expect(screen.getByLabelText("Assign to Groceries")).toHaveValue(null);
  });

  test("Uncategorized is offered when it owes money, even with no activity now", () => {
    // An empty assignments key so the day-one seed does not run and zero it out.
    localStorage.setItem("assignments", JSON.stringify([]));
    localStorage.setItem(
      "expenses",
      JSON.stringify([
        {
          id: "e1",
          description: "Parking",
          amountCents: 900,
          budgetId: "Uncategorized",
          date: "2020-01-05",
        },
      ])
    );
    openWith([{ id: "a", name: "Groceries", max: 400 }], 1000);

    // Keyed on the balance rather than this month's activity: an overspend
    // carried in from years ago is exactly the row the user came here to cover.
    expect(screen.getByLabelText("Assign to Uncategorized")).toBeInTheDocument();
  });

  test("a category with no estimate cannot be filled", () => {
    openWith([{ id: "a", name: "Groceries" }], 1000);

    expect(screen.getByRole("button", { name: "Fill" })).toBeDisabled();
  });
});

describe("expense modal budget preselection", () => {
  test("opening from a budget card preselects that budget, and updates on reopen", () => {
    seedBudgets(TWO_BUDGETS);
    render(
      <AppProviders>
        <ExpenseHarness budgetIds={["a", "b"]} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByRole("combobox")).toHaveValue("a");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open b"));
    expect(screen.getByRole("combobox")).toHaveValue("b");
  });

  test("opening from the page header falls back to Uncategorized", () => {
    seedBudgets(TWO_BUDGETS);
    render(
      <AppProviders>
        <ExpenseHarness budgetIds={["a", undefined]} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByRole("combobox")).toHaveValue("a");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("open header"));
    expect(screen.getByRole("combobox")).toHaveValue("Uncategorized");
  });

  test("a budget deleted since the modal last opened falls back to Uncategorized", () => {
    seedBudgets([{ id: "a", name: "Groceries", max: 400 }]);
    render(
      <AppProviders>
        <ExpenseHarness budgetIds={["gone"]} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open gone"));
    expect(screen.getByRole("combobox")).toHaveValue("Uncategorized");
  });
});

describe("forms do not keep stale input", () => {
  test("the expense form is empty when reopened after a submit", () => {
    seedBudgets(TWO_BUDGETS);
    render(
      <AppProviders>
        <ExpenseHarness budgetIds={["a"]} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open a"));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "4.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/description/i)).toHaveValue("");
    expect(screen.getByLabelText(/amount/i)).toHaveValue(null);
  });

  test("the expense form is empty when reopened after a cancel", () => {
    seedBudgets(TWO_BUDGETS);
    render(
      <AppProviders>
        <ExpenseHarness budgetIds={["a"]} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open a"));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("open a"));
    expect(screen.getByLabelText(/description/i)).toHaveValue("");
  });

  test("the income form is empty when reopened after a submit", () => {
    render(
      <AppProviders>
        <SimpleHarness Modal={AddIncomeModal} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Salary" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText(/description/i)).toHaveValue("");
  });

  test("the budget form is empty when reopened after a submit", () => {
    render(
      <AppProviders>
        <SimpleHarness Modal={AddBudgetModal} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
  });
});

describe("duplicate budget names", () => {
  test("a clashing name reports the problem instead of closing silently", () => {
    seedBudgets([{ id: "a", name: "Groceries", max: 400 }]);
    render(
      <AppProviders>
        <SimpleHarness Modal={AddBudgetModal} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "groceries" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    // still open, with the typed name intact so it can be edited
    expect(screen.getByLabelText(/name/i)).toHaveValue("groceries");
    expect(JSON.parse(localStorage.getItem("budgets"))).toHaveLength(1);
  });

  test("a fresh name saves and closes", () => {
    seedBudgets([{ id: "a", name: "Groceries", max: 400 }]);
    render(
      <AppProviders>
        <SimpleHarness Modal={AddBudgetModal} />
      </AppProviders>
    );

    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/monthly estimate/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("budgets"))).toHaveLength(2);
  });
});
