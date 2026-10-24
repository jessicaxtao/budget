import { useSchedules } from "../contexts/SchedulesContext";
import { usePayees } from "../contexts/PayeesContext";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useDiscoveredSchedules } from "../hooks/useScheduleSuggestions";
import { describeRecurrence } from "../domain/recurrence";
import { formatCents, formatDateMedium } from "../utils";
import Button from "./Button";

export default function ScheduleSuggestions({ onReview }) {
  const suggestions = useDiscoveredSchedules();
  const { payeeById } = usePayees();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { dismissedSuggestions, dismissSuggestion } = useSchedules();
  const visible = suggestions.filter((suggestion) => !dismissedSuggestions.includes(suggestion.key));
  if (visible.length === 0) return null;
  return (
    <section aria-label="Suggested schedules" className="border-t border-edge px-4 py-3 text-chalk">
      <h3 className="font-semibold">Possible recurring payments</h3>
      <p className="text-row text-chalk-soft">Based on your last three similar payments. Review the dates before creating a schedule.</p>
      <ul className="mt-3 space-y-4">
        {visible.map((suggestion) => (
          <li key={suggestion.key}>
            <p className="text-row font-medium">{payeeById.get(suggestion.payeeId)?.name} · {formatCents(suggestion.amountCents)} · {describeRecurrence(suggestion)}</p>
            <p className="text-row text-chalk-soft">
              {accounts.find((row) => row.id === suggestion.accountId)?.name} · {budgets.find((row) => row.id === suggestion.budgetId)?.name ?? "Income to assign"}
            </p>
            <p className="text-row text-chalk-soft">Next: {formatDateMedium(suggestion.startDate)}</p>
            <ul className="my-2 text-row text-chalk-soft">
              {suggestion.evidence.map((transaction) => <li key={transaction.id}>{formatDateMedium(transaction.date)} · {formatCents(transaction.amountCents)}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onReview(suggestion)}>Review schedule</Button>
              <Button variant="row" size="sm" onClick={() => dismissSuggestion(suggestion.key)}>Dismiss for now</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
