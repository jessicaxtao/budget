import { useMemo } from "react";
import { usePaySchedule } from "../contexts/PayScheduleContext";
import {
  describeSchedule,
  intervalDaysFor,
  isScheduleConfigured,
  nextPayday,
  payCadenceLabel,
  payDaysFor,
} from "../paySchedule";
import { daysBetween, todayISO } from "../utils";

/**
 * When the next paycheque lands, and how long that is from now.
 *
 * The arithmetic is in `src/paySchedule.js`, which knows about calendars and
 * nothing about React — a fortnight stepped from a recorded payday, or named
 * days of the month clamped to the month's length and moved off a weekend. This
 * hook is the join: it reads the stored schedule and says what the dashboard
 * tile and the Configuration panel both need.
 *
 * `daysSinceLast` is counted from the payday **before** the next one rather than
 * from the date the user typed. For a schedule kept up to date the two are the
 * same day; for one nobody has touched in months, the derived one is the honest
 * answer, and it is the only answer at all under a monthdays cadence, which
 * records no payday to count from.
 */
export default function useNextPaycheck(today = todayISO()) {
  const { schedule } = usePaySchedule();

  return useMemo(() => {
    const configured = isScheduleConfigured(schedule);
    const { nextDate, previousDate } = nextPayday(schedule, today);
    const countFrom = previousDate ?? schedule.lastPaidOn ?? null;

    return {
      configured,
      cadence: schedule.cadence,
      cadenceLabel: payCadenceLabel(schedule.cadence),
      // What the schedule says, in words: "every 2 weeks", "on the 15th and the
      // last day". One phrase, so the tile and the panel cannot describe the
      // same schedule differently.
      summary: describeSchedule(schedule),
      // What the user recorded, and the payday the countdown actually runs from
      // — the same day for a schedule kept up to date, and only the second one
      // exists under a monthdays cadence.
      lastPaidOn: schedule.lastPaidOn ?? null,
      previousDate,
      periodDays: intervalDaysFor(schedule),
      daysOfMonth: payDaysFor(schedule),
      nextDate,
      daysUntil: nextDate == null ? null : daysBetween(today, nextDate),
      daysSinceLast: countFrom == null ? null : daysBetween(countFrom, today),
    };
  }, [schedule, today]);
}
