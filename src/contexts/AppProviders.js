import { BudgetsProvider } from "./BudgetsContext";
import { IncomeProvider } from "./IncomeContext";
import { BudgetPlanProvider } from "./BudgetPlanContext";
import { AccountsProvider } from "./AccountsContext";
import { RetirementProvider } from "./RetirementContext";

// Composes every store in one place so index.js and the tests wrap the app the
// same way, and adding a store does not mean editing both.
//
// BudgetPlanProvider sits outside BudgetsProvider deliberately: plans own what a
// category is allowed to spend, and deleting a budget has to take its plan
// history with it. Plans reference budgets by id and never read them back, so
// the dependency only runs one way.
export default function AppProviders({ children }) {
  return (
    <BudgetPlanProvider>
      <BudgetsProvider>
        <IncomeProvider>
          <AccountsProvider>
            <RetirementProvider>{children}</RetirementProvider>
          </AccountsProvider>
        </IncomeProvider>
      </BudgetsProvider>
    </BudgetPlanProvider>
  );
}
