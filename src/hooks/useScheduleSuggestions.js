import { useMemo } from "react";
import { spendsThroughBudget, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useSchedules } from "../contexts/SchedulesContext";
import { useTransactions } from "../contexts/TransactionsContext";
import { discoverSchedules, matchSchedulePayments } from "../domain/transactionSuggestions";
import { isOccurrenceOutstanding } from "../domain/scheduleOccurrences";
import { todayISO } from "../utils";

export function useDiscoveredSchedules(today = todayISO()) {
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();
  const { schedules } = useSchedules();
  const { transactions } = useTransactions();
  return useMemo(() => discoverSchedules({ transactions, schedules, payees, budgets,
    accounts: accounts.filter(spendsThroughBudget), today }),
  [transactions, schedules, payees, budgets, accounts, today]);
}

export function useSchedulePaymentMatches(rows, today = todayISO()) {
  const { schedules, resolveOccurrence } = useSchedules();
  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();
  const eligible = useMemo(() => {
    const accountIds = new Set(accounts.filter(spendsThroughBudget).map((row) => row.id));
    const budgetIds = new Set(budgets.map((row) => row.id));
    const payeeIds = new Set(payees.map((row) => row.id));
    return schedules.filter((schedule) => accountIds.has(schedule.accountId) && payeeIds.has(schedule.payeeId) &&
      (budgetIds.has(schedule.budgetId) || (schedule.kind === "inflow" && schedule.budgetId == null)));
  }, [accounts, budgets, payees, schedules]);
  const matches = useMemo(() => new Map(rows.map((row) => [row.key,
    eligible.some((schedule) => schedule.id === row.schedule.id)
      ? matchSchedulePayments({ ...row, transactions, schedules, today }) : []])),
  [rows, eligible, transactions, schedules, today]);

  function confirmMatch(row, transactionId) {
    const schedule = eligible.find((item) => item.id === row.schedule.id);
    if (!schedule || !isOccurrenceOutstanding(schedule, row.date) ||
      !matchSchedulePayments({ schedule, date: row.date, transactions, schedules, today })
        .some((transaction) => transaction.id === transactionId)) {
      return { ok: false, error: "That payment no longer matches this outstanding reminder. Review the updated suggestions." };
    }
    return resolveOccurrence({ id: schedule.id, date: row.date, status: "recorded", transactionId });
  }
  return { matches, confirmMatch };
}
