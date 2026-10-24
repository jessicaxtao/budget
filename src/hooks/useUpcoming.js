import { useMemo } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { upcomingThrough, UPCOMING_DAYS } from "../domain/recurrence";
import { outstandingOccurrences } from "../domain/scheduleOccurrences";
import { daysBetween, todayISO } from "../utils";

/**
 * Outstanding calendar occurrences, including overdue bills. Reads schedules
 * only: ledger matches are suggestions in useSchedulePaymentMatches and never
 * settle reminders until the user confirms them. Legacy cursors exclude their
 * handled history; new decisions exclude only their own scheduled dates.
 */
export default function useUpcoming(today = todayISO(), { days = UPCOMING_DAYS } = {}) {
  const { schedules } = useSchedules();

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
  }, [schedules, today, days]);
}
