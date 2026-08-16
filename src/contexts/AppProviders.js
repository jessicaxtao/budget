import { DonationsProvider } from "./DonationsContext";
import { TransactionsProvider } from "./TransactionsContext";
import { BudgetsProvider } from "./BudgetsContext";
import { IncomePlanProvider } from "./IncomePlanContext";
import { PayScheduleProvider } from "./PayScheduleContext";
import { AssignmentsProvider } from "./AssignmentsContext";
import { AccountsProvider } from "./AccountsContext";
import { RetirementProvider } from "./RetirementContext";
import { SavingsGoalsProvider } from "./SavingsGoalsContext";
import { SavingsGoalAssignmentsProvider } from "./SavingsGoalAssignmentsContext";

// Composes every store in one place so index.js and the tests wrap the app the
// same way, and adding a store does not mean editing both.
//
// **Provider order is a cascade order.** A store that has to clean up after
// another's delete sits *outside* it, so the inner one can call into it:
//
//   - Transactions and Assignments wrap Budgets, because deleting a category
//     has to hand its spend and its funding to Uncategorized.
//   - Transactions also wraps Accounts, because deleting an account has to cut
//     its transactions loose without destroying them.
//   - Donations wraps Transactions, because a donation record is a statement
//     *about* an outflow — which organisation it went to, how much of it is
//     deductible — and deleting the money has to take the statement with it.
//     It is the only store outside the ledger, and it holds no money of its
//     own: a gift is an ordinary outflow on the register like any other.
//
// Each of those references the other by id and never reads it back, so the
// dependency only ever runs one way — keep it that way. Anything needing to
// read *across* stores belongs in a hook: src/hooks/useEnvelopes.js for the
// envelope figures, src/hooks/useAccountBalances.js for what each account
// holds. Never in a provider.
//
// A category's monthly estimate needs no provider of its own: it is a standing
// figure on the budget record, and BudgetsContext owns it along with the groups
// categories are filed under.
//
// IncomePlan is independent of the ledger in both directions. One holds the
// paycheques the user expects, the other the money that actually arrived;
// nothing maps a record to the source that predicted it, so neither delete may
// cascade into the other. PaySchedule is independent of both again — it is one
// record saying when the next paycheque lands, and nothing deletes into it — so
// its position in the cascade is free.
//
// SavingsGoals is independent of everything: a goal names no category, no
// account, and no transaction, so nothing deletes into or out of it. Its
// position in the cascade is free for the same reason PaySchedule's is.
// SavingsGoalAssignments sits beside it for the same reason AssignmentsContext
// sits beside BudgetsContext: it is the money-actually-put-in half of a goal,
// keyed on the goal's id. It draws from the *same* to-be-assigned pool a
// category does — see useEnvelopes — but nothing yet deletes a goal, so
// there is no cascade to order it against.
export default function AppProviders({ children }) {
  return (
    <DonationsProvider>
      <TransactionsProvider>
        <AssignmentsProvider>
          <BudgetsProvider>
            <IncomePlanProvider>
              <PayScheduleProvider>
                <AccountsProvider>
                  <RetirementProvider>
                    <SavingsGoalsProvider>
                      <SavingsGoalAssignmentsProvider>{children}</SavingsGoalAssignmentsProvider>
                    </SavingsGoalsProvider>
                  </RetirementProvider>
                </AccountsProvider>
              </PayScheduleProvider>
            </IncomePlanProvider>
          </BudgetsProvider>
        </AssignmentsProvider>
      </TransactionsProvider>
    </DonationsProvider>
  );
}
