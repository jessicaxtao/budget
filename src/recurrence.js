import { addDays, daysBetween, formatDayShort, isValidISODate, todayISO } from "./utils";

/**
 * Which days a recurring transaction lands on.
 *
 * The third module in this family and the only one about a *bill*. The other two
 * answer questions this one must not be confused with:
 *
 *   src/cadence.js      — how much a recurring figure comes to in an average
 *                         month. No dates in it, deliberately.
 *   src/paySchedule.js  — when the household's own paycheque lands. One schedule,
 *                         the household's, with a payroll's rules on it.
 *
 * Four names appear in all three tables by coincidence of English, exactly as
 * `paySchedule.js` already says of its own overlap with `cadence.js`. They are
 * not to be consolidated, and the clearest proof is the **weekend rule**: a
 * payday that falls on a Saturday is paid the Friday before, because that is what
 * payroll departments do. A direct debit on a Saturday is taken on the Saturday.
 * Applying payroll's courtesy to a water bill would quietly report every bill due
 * on the 1st of a month beginning on a Sunday as due two days early, which is the
 * wrong way to be wrong about a bill.
 *
 * **A schedule is anchored on one date and stepped.** `startDate` is the first
 * occurrence, not a vague "from around here": every later one is computed from it
 * rather than from the one before, which is what keeps a bill due on the 31st
 * from ratcheting down to the 28th forever the first time it passes February.
 * See `occurrenceAt`.
 *
 * **Nothing here is stored.** The occurrences are a closed form over the anchor,
 * the same treatment envelope rollover and the paycheque countdown both get, and
 * for the reason `paySchedule.js` states outright: a stored "next date" would
 * need advancing by something, and nothing in an app with no backend runs at
 * midnight. What *is* stored is how far the user has dealt with — one cursor per
 * schedule — which is a record of a decision rather than a derived date.
 */

export const RECURRENCES = {
  weekly: { label: "Weekly", kind: "interval", days: 7 },
  biweekly: { label: "Every 2 weeks", kind: "interval", days: 14 },
  monthly: { label: "Monthly", kind: "months", months: 1 },
  quarterly: { label: "Quarterly", kind: "months", months: 3 },
  annually: { label: "Annually", kind: "months", months: 12 },
};

/** In the order the picker offers them: shortest first. */
export const RECURRENCE_KEYS = Object.keys(RECURRENCES);

/** Most bills are monthly, and the ones that are not are obvious to their owner. */
export const DEFAULT_RECURRENCE = "monthly";

/**
 * The most occurrences any one schedule contributes to a window.
 *
 * A guard rather than a preference. A weekly schedule anchored two years back
 * that nobody has entered would otherwise produce a hundred rows on the
 * dashboard, which is not a list anybody can act on — the honest reading of that
 * state is "the oldest few, and there are more".
 */
export const MAX_OCCURRENCES = 12;

export function recurrence(cadence) {
  return RECURRENCES[cadence] ?? null;
}

export function recurrenceLabel(cadence) {
  return RECURRENCES[cadence]?.label ?? "Not set";
}

/** A cadence this module knows, anchored on a real date. */
export function isRecurring(schedule) {
  return recurrence(schedule?.cadence) != null && isValidISODate(schedule?.startDate);
}

// Field by field rather than from the ISO string, which the Date constructor
// reads as UTC — the rule `localDate` keeps in utils and paySchedule both.
function partsOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year, month) {
  // Day zero of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/**
 * The `index`th occurrence, counting the anchor itself as zero.
 *
 * The months family is stepped **from the anchor**, never from the previous
 * occurrence, and the day is clamped to the month's length — so a bill due on the
 * 31st is the 28th in February and the 31st again in March. Stepping from the
 * last computed date instead would clamp once and never recover: the bill would
 * be due on the 28th for the rest of its life after one February.
 */
function occurrenceAt(schedule, index) {
  const def = recurrence(schedule.cadence);
  if (def.kind === "interval") return addDays(schedule.startDate, index * def.days);

  const { year, month, day } = partsOf(schedule.startDate);
  const cursor = new Date(year, month - 1 + index * def.months, 1);
  const targetYear = cursor.getFullYear();
  const targetMonth = cursor.getMonth() + 1;
  return todayISO(
    new Date(targetYear, targetMonth - 1, Math.min(day, daysInMonth(targetYear, targetMonth)))
  );
}

/**
 * The index of the first occurrence on or after `date`.
 *
 * Closed form for the interval family. For the months family the clamp makes the
 * closed form a near miss rather than an answer — the 31st of a short month lands
 * earlier than the arithmetic expects — so the month count is deliberately
 * *under*-estimated by one step and then walked forward. Occurrences increase
 * strictly, so the walk is one or two steps and always terminates.
 */
function indexOnOrAfter(schedule, date) {
  const def = recurrence(schedule.cadence);
  if (def.kind === "interval") {
    return Math.max(0, Math.ceil(daysBetween(schedule.startDate, date) / def.days));
  }

  const from = partsOf(schedule.startDate);
  const to = partsOf(date);
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  let index = Math.max(0, Math.floor(months / def.months) - 1);
  while (occurrenceAt(schedule, index) < date) index += 1;
  return index;
}

/** Where the walk starts: the anchor, or `from` if that is later. */
function floorFor(schedule, from) {
  return from > schedule.startDate ? from : schedule.startDate;
}

/**
 * Every occurrence in `[from, to]`, oldest first.
 *
 * Inclusive of both ends, the treatment `REPORT_RANGES` gives a window of months.
 * `endsOn` is honoured as a second, earlier ceiling — a lease that ends in March
 * has no April.
 */
export function occurrencesBetween(schedule, from, to, { limit = MAX_OCCURRENCES } = {}) {
  if (!isRecurring(schedule) || !isValidISODate(from) || !isValidISODate(to)) return [];

  const ceiling = isValidISODate(schedule.endsOn) && schedule.endsOn < to ? schedule.endsOn : to;
  const cap = Math.min(limit, MAX_OCCURRENCES);

  const dates = [];
  let index = indexOnOrAfter(schedule, floorFor(schedule, from));
  while (dates.length < cap) {
    const date = occurrenceAt(schedule, index);
    if (date > ceiling) break;
    dates.push(date);
    index += 1;
  }
  return dates;
}

/**
 * The first occurrence on or after `onOrAfter`, or null past the end.
 *
 * On or after rather than strictly after: a bill due today is due today, which is
 * the same stance `nextPayday` takes for the family it counts from the calendar.
 */
export function nextOccurrence(schedule, onOrAfter) {
  if (!isRecurring(schedule) || !isValidISODate(onOrAfter)) return null;
  const date = occurrenceAt(schedule, indexOnOrAfter(schedule, floorFor(schedule, onOrAfter)));
  if (isValidISODate(schedule.endsOn) && date > schedule.endsOn) return null;
  return date;
}

/**
 * "15th", "1st", "22nd".
 *
 * Deliberately not `payDayLabel` from `paySchedule.js`, which reads 31 as "last
 * day" — true of a payroll that pays on the last day of the month, and wrong
 * here: a card whose statement falls on the 31st is due on the 31st, and in
 * February it is clamped like any other overlong day rather than *meaning* the
 * end of the month.
 */
export function ordinalDay(day) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/**
 * The schedule said in words — "monthly on the 1st", "every 2 weeks", "every year
 * on Mar 15" — lower case, so it reads as a clause after whatever precedes it.
 *
 * One phrase, shared by the list on Configuration and the panel on the dashboard,
 * so the two cannot describe one schedule differently. `describeSchedule` keeps
 * the same discipline for the pay schedule.
 */
export function describeRecurrence(schedule) {
  const def = recurrence(schedule?.cadence);
  if (!def) return "";
  if (!isValidISODate(schedule.startDate)) return def.label.toLowerCase();

  const { day } = partsOf(schedule.startDate);

  if (def.kind === "interval") {
    return def.days === 7 ? "every week" : `every ${def.days / 7} weeks`;
  }
  if (def.months === 1) return `monthly on the ${ordinalDay(day)}`;
  if (def.months === 12) return `every year on ${formatDayShort(schedule.startDate)}`;
  return `every ${def.months} months on the ${ordinalDay(day)}`;
}

/**
 * The window the dashboard asks about: today, and the next four weeks.
 *
 * Four weeks and not a calendar month, so the answer does not change size with
 * the month it is asked in — and long enough that a monthly bill appears exactly
 * once, which is what makes the list stable enough to act on day after day.
 */
export const UPCOMING_DAYS = 28;

/** The last day of the upcoming window, given today. */
export function upcomingThrough(today, days = UPCOMING_DAYS) {
  return addDays(today, days);
}
