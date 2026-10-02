import { useMemo } from "react";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { occurrencesBetween, upcomingThrough, UPCOMING_DAYS } from "../recurrence";
import { addDays, daysBetween, todayISO } from "../utils";

/**
 * What is due, and what is late.
 *
 * The join between the stored schedules and the calendar, the way
 * `useNextPaycheck` joins the stored pay schedule to `paySchedule.js`. It reads
 * **one store**, so it is not one of the seven cross-store hooks and must not
 * become one: a schedule is a prediction, and the moment this hook read the
 * ledger somebody would be tempted to match an occurrence against a transaction
 * that looks like it — which is guesswork about the household's intent, and wrong
 * the first time a bill is paid twice on purpose.
 *
 * The arithmetic is in `src/recurrence.js`. What is here is the one rule the
 * calendar cannot state: **the window opens at the cursor, not at today.** Every
 * occurrence after `enteredThrough` is still outstanding however long ago it fell,
 * so a bill due on the 1st that nobody entered is on this list on the 9th, marked
 * overdue. A list that started at today would let it disappear in silence, which
 * is the one failure a bill reminder cannot have.
 *
 * One row per occurrence, not per schedule — a weekly bill is genuinely four
 * things to do this month, and each is entered or skipped on its own.
 */
export default function useUpcoming(today = todayISO(), { days = UPCOMING_DAYS } = {}) {
  const { schedules } = useSchedules();

  return useMemo(() => {
    const through = upcomingThrough(today, days);
    const rows = [];

    for (const schedule of schedules) {
      // From the day after the cursor: the cursor names a date already dealt
      // with, so including it would offer the same bill twice.
      const from =
        schedule.enteredThrough == null
          ? schedule.startDate
          : addDays(schedule.enteredThrough, 1);

      for (const date of occurrencesBetween(schedule, from, through)) {
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
