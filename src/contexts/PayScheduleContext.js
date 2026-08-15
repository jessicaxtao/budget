import React, { useCallback, useContext, useMemo } from "react";
import useLocalStorage from "../hooks/useLocalStorage";
import {
  MAX_PAY_DAYS,
  cadenceForDays,
  isPayDay,
  payCadence,
} from "../paySchedule";
import { isValidISODate } from "../utils";

/**
 * When the money lands: how often the user is paid, and whatever that cadence
 * needs to place it on a calendar.
 *
 * The calendar half of the income question, and deliberately not part of
 * IncomePlanContext, which is the *amount* half. That store holds a list of
 * sources described in the abstract — what each pays and how often, averaged
 * into a monthly figure so the plan can be checked against itself — and it says
 * out loud that it carries no date, because the configuration it belongs to has
 * no month in it. This is the opposite kind of fact: a single record about one
 * household, stating real days on a real calendar, and it exists to answer the
 * one question the plan cannot — how long the money on hand has to last.
 *
 * One schedule, not one per source. The user asked for a countdown to their next
 * pay, and a countdown has to name a single date; a per-source schedule would
 * mean a list of them, which is a different feature and a different screen.
 *
 * **Two of the three fields are the answer to a question the cadence does not
 * ask**, and that is deliberate: `lastPaidOn` and `periodDays` belong to the
 * interval cadences, `daysOfMonth` to the twice-monthly and monthly ones, and
 * whichever is not in force is *kept* rather than cleared. Switching between
 * fortnightly and twice-monthly to see which describes the new job is the point,
 * and a switch that destroys what it switches away from can only be used once.
 * `src/paySchedule.js` decides which fields a cadence reads; this store only has
 * to know that each is separately valid.
 *
 * Every field is nullable and independent of the others. A schedule needs all of
 * a cadence's fields to say anything, but part of one is a real intermediate
 * state — the user has picked twice-monthly and typed the first day, not the
 * second — and refusing to store it would blank the field they just filled in.
 */
const PayScheduleContext = React.createContext();

/** Nothing stated yet. Not a guess at fortnightly: a countdown to a date nobody
 *  entered is worse than no countdown, and that goes for the cadence too — most
 *  people are paid every two weeks, and the ones who are not are exactly the
 *  ones a guess would mislead. */
export const EMPTY_SCHEDULE = {
  cadence: null,
  lastPaidOn: null,
  periodDays: null,
  daysOfMonth: [],
};

// A pay period longer than a year is not a pay period, and one of zero days
// would put the next paycheque an infinite number of times in the past. The
// upper bound is generous on purpose — this only has to exclude nonsense.
export const MIN_PERIOD_DAYS = 1;
export const MAX_PERIOD_DAYS = 366;

export function usePaySchedule() {
  return useContext(PayScheduleContext);
}

function readPeriodDays(value) {
  const days = Number(value);
  return Number.isInteger(days) && days >= MIN_PERIOD_DAYS && days <= MAX_PERIOD_DAYS ? days : null;
}

/** A day of the month, or null for one the user has not filled in yet. Anything
 *  else is junk, and the caller tells the two apart. */
function readPayDay(value) {
  if (value === null || value === undefined || value === "") return null;
  const day = Number(value);
  return isPayDay(day) ? day : undefined;
}

// Not keyed on field presence like the others, because there are no earlier
// shapes of this record to upgrade — it is a whole-value guard instead, which
// is what a singleton needs: anything unreadable reads as "not set up yet"
// rather than putting a NaN into a countdown.
//
// The one thing it does upgrade is a schedule stored before cadences existed,
// which was a day count and nothing else. Fourteen days was already fortnightly
// and reads as fortnightly now; a count matching no named cadence becomes the
// custom interval, which is the same schedule under a name. Field presence would
// do here too — the rule is safe to re-run either way, since a stored cadence is
// never overwritten.
function migrateSchedule(stored) {
  const schedule = stored && typeof stored === "object" ? stored : {};
  const periodDays = readPeriodDays(schedule.periodDays);
  const cadence = payCadence(schedule.cadence)
    ? schedule.cadence
    : periodDays == null
      ? null
      : cadenceForDays(periodDays);

  return {
    cadence,
    lastPaidOn: isValidISODate(schedule.lastPaidOn) ? schedule.lastPaidOn : null,
    periodDays,
    daysOfMonth: (Array.isArray(schedule.daysOfMonth) ? schedule.daysOfMonth : [])
      .slice(0, MAX_PAY_DAYS)
      .map((day) => (isPayDay(day) ? day : null)),
  };
}

export const PayScheduleProvider = ({ children }) => {
  const [schedule, setSchedule] = useLocalStorage("paySchedule", EMPTY_SCHEDULE, migrateSchedule);

  /**
   * Patch the schedule. Fields left undefined are left alone, as on
   * `updateBudget` — so each input on the Configuration page can commit on its
   * own without the others having been filled in yet.
   *
   * `null` is a real value here and clears the field, which is how a user takes
   * the countdown back off their dashboard.
   */
  const setPaySchedule = useCallback(
    ({ cadence, lastPaidOn, periodDays, daysOfMonth }) => {
      const patch = {};

      if (cadence !== undefined) {
        if (!(cadence === null || payCadence(cadence))) {
          return { ok: false, error: "Choose how often you are paid." };
        }
        patch.cadence = cadence;
      }

      if (lastPaidOn !== undefined) {
        if (!(lastPaidOn === null || isValidISODate(lastPaidOn))) {
          return { ok: false, error: "Enter the date of your last paycheck." };
        }
        patch.lastPaidOn = lastPaidOn;
      }

      if (periodDays !== undefined) {
        if (periodDays === null || periodDays === "") {
          patch.periodDays = null;
        } else {
          const days = readPeriodDays(periodDays);
          if (days == null) {
            return {
              ok: false,
              error: `Enter a pay period of ${MIN_PERIOD_DAYS} to ${MAX_PERIOD_DAYS} whole days.`,
            };
          }
          patch.periodDays = days;
          // A day count set while no cadence has been stated names its own —
          // the same rule the migration reads storage by. It is what keeps a
          // bare period a whole answer, and it never overrides a cadence the
          // user picked: someone who has chosen twice-monthly is not moved off
          // it by a stale field.
          if (schedule.cadence == null && cadence === undefined) {
            patch.cadence = cadenceForDays(days);
          }
        }
      }

      if (daysOfMonth !== undefined) {
        if (daysOfMonth === null) {
          patch.daysOfMonth = [];
        } else {
          if (!Array.isArray(daysOfMonth) || daysOfMonth.length > MAX_PAY_DAYS) {
            return { ok: false, error: "Enter the days of the month you are paid on." };
          }
          const days = daysOfMonth.map(readPayDay);
          if (days.some((day) => day === undefined)) {
            return { ok: false, error: "Enter a day of the month from 1 to 31." };
          }
          patch.daysOfMonth = days;
        }
      }

      setSchedule((prev) => ({ ...prev, ...patch }));
      return { ok: true };
    },
    [schedule.cadence, setSchedule]
  );

  const clearPaySchedule = useCallback(() => setSchedule(EMPTY_SCHEDULE), [setSchedule]);

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({ schedule, setPaySchedule, clearPaySchedule }),
    [schedule, setPaySchedule, clearPaySchedule]
  );

  return <PayScheduleContext.Provider value={value}>{children}</PayScheduleContext.Provider>;
};
