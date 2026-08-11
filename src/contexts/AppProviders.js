import { BudgetsProvider } from "./BudgetsContext";
import { IncomeProvider } from "./IncomeContext";
import { IncomePlanProvider } from "./IncomePlanContext";
import { AssignmentsProvider } from "./AssignmentsContext";
import { AccountsProvider } from "./AccountsContext";
import { RetirementProvider } from "./RetirementContext";

// Composes every store in one place so index.js and the tests wrap the app the
// same way, and adding a store does not mean editing both.
//
// AssignmentsProvider sits outside BudgetsProvider deliberately: it owns what a
// category was actually given, and deleting a budget has to take that with it.
// It references budgets by id and never reads them back, so the dependency only
// runs one way — keep it that way. Anything needing to read across stores
// belongs in src/hooks/useEnvelopes.js, not in a provider.
//
// A category's monthly estimate needs no provider of its own: it is a standing
// figure on the budget record, and BudgetsContext owns it along with the groups
// categories are filed under.
//
// IncomePlan sits next to Income and is independent of it in both directions.
// One holds the paycheques the user expects, the other the money that actually
// arrived; nothing maps a record to the source that predicted it, so neither
// delete may cascade into the other.
export default function AppProviders({ children }) {
  return (
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
  );
}
