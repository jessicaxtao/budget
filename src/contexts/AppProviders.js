import { BudgetsProvider } from "./BudgetsContext";
import { IncomeProvider } from "./IncomeContext";
import { IncomePlanProvider } from "./IncomePlanContext";
import { BudgetPlanProvider } from "./BudgetPlanContext";
import { AssignmentsProvider } from "./AssignmentsContext";
import { AccountsProvider } from "./AccountsContext";
import { RetirementProvider } from "./RetirementContext";

// Composes every store in one place so index.js and the tests wrap the app the
// same way, and adding a store does not mean editing both.
//
// BudgetPlanProvider and AssignmentsProvider both sit outside BudgetsProvider
// deliberately: they own what a category was estimated to need and what it was
// actually given, and deleting a budget has to take both with it. Each
// references budgets by id and never reads them back, so the dependency only
// runs one way — keep it that way. Anything needing to read across stores
// belongs in src/hooks/useEnvelopes.js, not in a provider.
//
// Assignments sits inside BudgetPlan rather than outside it: nothing connects
// them today, but filling a category to its estimate is an assignment that
// needs a plan, and never the reverse.
//
// IncomePlan sits next to Income and is independent of it in both directions.
// One holds the paycheques the user expects, the other the money that actually
// arrived; nothing maps a record to the source that predicted it, so neither
// delete may cascade into the other.
export default function AppProviders({ children }) {
  return (
    <BudgetPlanProvider>
      <AssignmentsProvider>
        <BudgetsProvider>
          <IncomeProvider>
            <IncomePlanProvider>
              <AccountsProvider>
                <RetirementProvider>{children}</RetirementProvider>
              </AccountsProvider>
            </IncomePlanProvider>
          </IncomeProvider>
        </BudgetsProvider>
      </AssignmentsProvider>
    </BudgetPlanProvider>
  );
}
