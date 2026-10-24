import { useState } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import { usePayees } from "../contexts/PayeesContext";
import { formatCents, formatDateMedium } from "../utils";
import Button from "./Button";

export default function ScheduleHistory() {
  const { schedules, reopenOccurrence } = useSchedules();
  const { transactions } = useTransactions();
  const { payeeById } = usePayees();
  const [error, setError] = useState(null);
  const byId = new Map(transactions.map((row) => [row.id, row]));
  const rows = schedules.flatMap((schedule) => Object.entries(schedule.occurrenceDecisions ?? {})
    .map(([date, decision]) => ({ schedule, date, decision })))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return null;
  return (
    <details className="border-t border-edge px-4 py-3 text-row text-chalk">
      <summary className="cursor-pointer">Handled occurrences</summary>
      <p className="my-2 text-chalk-soft">Reopening restores a reminder. It keeps any recorded payment in your ledger.</p>
      {error && <p role="alert" className="text-vermilion">{error}</p>}
      <ul className="space-y-3">
        {rows.map(({ schedule, date, decision }) => {
          const transaction = byId.get(decision.transactionId);
          const name = payeeById.get(schedule.payeeId)?.name ?? schedule.description ?? "Scheduled transaction";
          return <li key={`${schedule.id}:${date}`}>
            <p>{name} · {formatDateMedium(date)} · {decision.status === "skipped" ? "Skipped" : "Recorded"}</p>
            {decision.transactionId && <p className="text-chalk-soft">{transaction
              ? `Linked payment: ${formatDateMedium(transaction.date)} · ${formatCents(transaction.amountCents)}`
              : "The linked payment no longer exists. This reminder stays handled until you reopen it."}</p>}
            <Button variant="row-action" size="sm" aria-label={`Reopen ${name} due ${formatDateMedium(date)}`} onClick={() => {
              const result = reopenOccurrence({ id: schedule.id, date });
              setError(result.ok ? null : result.error);
            }}>Reopen reminder</Button>
          </li>;
        })}
      </ul>
    </details>
  );
}
