import { useMemo } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { usePaySchedule } from "../contexts/PayScheduleContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import { isScheduleConfigured, nextPayday } from "../domain/paySchedule";
import { upcomingThrough, UPCOMING_DAYS } from "../domain/recurrence";
import { outstandingOccurrences } from "../domain/scheduleOccurrences";
import { addDays, daysBetween, todayISO } from "../utils";

/**
 * Outstanding calendar occurrences, including overdue bills. Reads schedules
 * only: ledger matches are suggestions in useSchedulePaymentMatches and never
 * settle reminders until the user confirms them. Legacy cursors exclude their
 * handled history; new decisions exclude only their own scheduled dates.
 */
export default function useUpcoming(today = todayISO(), { days = UPCOMING_DAYS } = {}) {
  const { schedules } = useSchedules();
  const { schedule: paySchedule } = usePaySchedule();
  const { transactions } = useTransactions();
  const { sources } = useIncomePlan();

  return useMemo(() => {
    const through = upcomingThrough(today, days);
    const rows = [];

    for (const schedule of schedules) {
      for (const date of outstandingOccurrences(schedule, through)) {
        const dueInDays = daysBetween(today, date);
        rows.push({
          // Keyed by both, because one schedule contributes several rows and the
          // occurrence is what each of them is about.
          key: `${schedule.id}:${date}`,
          schedule,
          date,
          dueInDays,
          // Today is due, not late. A direct debit taken this morning and a bill
          // being paid this afternoon are the same row, and calling it overdue
          // would cry wolf every single month.
          overdue: dueInDays < 0,
        });
      }
    }

    // The payday calendar already knows when household pay arrives. Surface
    // those dates here too, using a cadence-matched income plan amount when
    // available and otherwise the latest recorded paycheck.
    const cadenceByPayCadence = { weekly: "weekly", biweekly: "biweekly", semimonthly: "semimonthly", monthly: "monthly" };
    const plannedPayCents = (sources ?? [])
      .filter((source) => source.cadence === cadenceByPayCadence[paySchedule.cadence])
      .reduce((sum, source) => sum + (source.amountCents ?? 0), 0);
    const lastPaycheck = [...transactions]
      .filter((transaction) => transaction.kind === TRANSACTION_KINDS.INFLOW && !transaction.budgetId && transaction.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const paycheckCents = plannedPayCents || lastPaycheck?.amountCents || 0;
    if (isScheduleConfigured(paySchedule) && paycheckCents > 0) {
      let cursor = today;
      for (let count = 0; count < 20; count += 1) {
        const { nextDate } = nextPayday(paySchedule, cursor);
        if (!nextDate || nextDate > through) break;
        rows.push({
          key: `paycheck:${nextDate}`,
          date: nextDate,
          dueInDays: daysBetween(today, nextDate),
          overdue: false,
          isPaycheck: true,
          amountCents: paycheckCents,
          estimateBasis: plannedPayCents ? "income plan" : "last paycheck",
          schedule: {
            isPaycheck: true,
            kind: TRANSACTION_KINDS.INFLOW,
            amountCents: paycheckCents,
            description: "Paycheck",
            payeeId: null,
            accountId: null,
            budgetId: null,
          },
        });
        cursor = addDays(nextDate, 1);
      }
    }

    // Oldest first, so the most overdue thing is the first thing read. Ties
    // broken by amount, largest first — if two bills fall on one day, the one
    // worth checking the balance for goes above.
    rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || b.schedule.amountCents - a.schedule.amountCents
    );

    const overdueRows = rows.filter((row) => row.overdue);
    // Money out only. An expected inflow is on the list because it is worth
    // knowing about, but adding it to "what is coming out" would net a paycheque
    // off the rent and report a smaller bill than the household has to cover.
    const outflows = rows.filter((row) => row.schedule.kind === TRANSACTION_KINDS.OUTFLOW);

    const sum = (list) => list.reduce((total, row) => total + row.schedule.amountCents, 0);

    return {
      rows,
      overdueRows,
      overdueCount: overdueRows.length,
      dueCents: sum(outflows),
      overdueCents: sum(outflows.filter((row) => row.overdue)),
      expectedCents: sum(rows.filter((row) => row.schedule.kind === TRANSACTION_KINDS.INFLOW)),
      through,
      windowDays: days,
      scheduleCount: schedules.length,
    };
  }, [schedules, paySchedule, transactions, sources, today, days]);
}
