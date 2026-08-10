import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import AddExpenseModal from "./AddExpenseModal";
import AddBudgetModal from "./AddBudgetModal";
import AddIncomeModal from "./AddIncomeModal";
import AppProviders from "../contexts/AppProviders";

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
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: "500" } });
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
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: "500" } });
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
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("budgets"))).toHaveLength(2);
  });
});
