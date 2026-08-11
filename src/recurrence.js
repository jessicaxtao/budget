import { isValidISODate, toPeriod } from "./utils";

/**
 * When a recurring income source actually pays out.
 *
 * Expected income for a month is counted, never averaged. The tempting shortcut
 * is `amount × 52 / 12` for a weekly source, but that figure is wrong in every
 * single month — a weekly paycheque lands four times in most months and five
 * times in a few, and a plan that says $4,333 in a month that pays $4,000 sends
 * the user looking for money that was never coming. Counting the paydays gives
 * an exact integer number of cents and, in the months with an extra one, tells
 * the user the truth: this month has room.
 *
 * That is also why a source stores an `anchorDate` — one real payday — rather
 * than a bare day of the month. Without a date on the calendar there is no way
 * to know whether August holds two fortnightly payments or three.
 */

// Day counts, not Date objects: a month that crosses a daylight-saving boundary
// is 30 days and 23 hours long, so stepping a fortnight by milliseconds drifts
// an hour at a time until a payday lands on the wrong side of midnight. Indexed
// against the UTC epoch and converted back the same way, the arithmetic is
// exact and the calendar never enters into it.
const MS_PER_DAY = 86400000;

const pad = (n) => String(n).padStart(2, "0");

function dayIndex(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function isoFromDayIndex(index) {
  const date = new Date(index * MS_PER_DAY);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Day 0 of the following month is the last day of this one. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The cadences a source can be paid on, in the order they appear in the picker:
 * shortest interval first. `monthsBetween` is null for the two that step in days
 * rather than months.
 */
export const CADENCES = {
  weekly: { label: "Weekly", days: 7, monthsBetween: null },
  biweekly: { label: "Every 2 weeks", days: 14, monthsBetween: null },
  semimonthly: { label: "Twice a month", days: null, monthsBetween: 1 },
  monthly: { label: "Monthly", days: null, monthsBetween: 1 },
  quarterly: { label: "Quarterly", days: null, monthsBetween: 3 },
  annually: { label: "Annually", days: null, monthsBetween: 12 },
};

export const CADENCE_KEYS = Object.keys(CADENCES);

export const DEFAULT_CADENCE = "monthly";

export function cadenceLabel(cadence) {
  return CADENCES[cadence]?.label ?? "Unknown cadence";
}

/**
 * Every date this source pays out inside `period`, in order, as "YYYY-MM-DD".
 *
 * Empty when the source has not started yet, has ended, or simply does not pay
 * this month — a quarterly source is silent two months in three, and that is a
 * real answer rather than a gap in the data.
 *
 * Anything malformed yields no payments rather than a guess: a source that
 * cannot say when it pays must not quietly inflate the month's expected income.
 */
export function occurrencesInPeriod(source, period) {
  if (!source || toPeriod(period) == null) return [];

  const cadence = CADENCES[source.cadence];
  if (!cadence || !isValidISODate(source.anchorDate)) return [];

  const [year, month] = period.split("-").map(Number);
  const monthLength = daysInMonth(year, month);
  const firstIndex = dayIndex(`${period}-01`);
  const lastIndex = firstIndex + monthLength - 1;

  const anchorIndex = dayIndex(source.anchorDate);
  // An open-ended source runs forever; a closed one stops on its last payday.
  const endIndex = isValidISODate(source.endDate) ? dayIndex(source.endDate) : Infinity;

  const dates = [];
  const collect = (index) => {
    if (index < anchorIndex || index > endIndex) return;
    if (index < firstIndex || index > lastIndex) return;
    dates.push(isoFromDayIndex(index));
  };

  if (cadence.days) {
    // Jump straight to the first payday on or after the 1st rather than walking
    // forward from the anchor: a source anchored years ago would otherwise cost
    // hundreds of iterations on every render.
    const stridesAhead = Math.max(0, Math.ceil((firstIndex - anchorIndex) / cadence.days));
    for (
      let index = anchorIndex + stridesAhead * cadence.days;
      index <= lastIndex;
      index += cadence.days
    ) {
      collect(index);
    }
    return dates;
  }

  const [anchorYear, anchorMonth, anchorDay] = source.anchorDate.split("-").map(Number);
  const monthsElapsed = (year - anchorYear) * 12 + (month - anchorMonth);
  if (monthsElapsed < 0 || monthsElapsed % cadence.monthsBetween !== 0) return [];

  // Clamped to the length of the month, so a source anchored on the 31st pays on
  // the 28th in February rather than spilling into March.
  const day = Math.min(anchorDay, monthLength);
  collect(firstIndex + day - 1);

  if (source.cadence === "semimonthly") {
    // The second payment falls a fortnight after the first — the 1st-and-16th or
    // 15th-and-30th rhythm most semi-monthly payroll runs on. Skipped when the
    // clamp collapses it onto the first, which is what a short month does to a
    // source anchored late in the month.
    const secondDay = Math.min(anchorDay + 15, monthLength);
    if (secondDay > day) collect(firstIndex + secondDay - 1);
  }

  return dates;
}

/** What this source is expected to pay across the whole of `period`. */
export function expectedCentsInPeriod(source, period) {
  return occurrencesInPeriod(source, period).length * (source?.amountCents ?? 0);
}
