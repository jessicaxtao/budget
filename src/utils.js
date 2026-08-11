// The app books a single currency. Locale is pinned alongside it on purpose:
// leaving the locale undefined while hardcoding the currency meant the symbol
// was fixed while grouping and placement followed whatever machine happened to
// be viewing.
export const CURRENCY = "USD";
export const CURRENCY_LOCALE = "en-US";

export const currencyFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  currency: CURRENCY,
  style: "currency",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Money is stored as an integer number of cents, never as floating-point
 * dollars — summing 0.1 + 0.2 across a few hundred expenses drifts, and a
 * ledger that disagrees with itself is worse than no ledger.
 */
export function toCents(value) {
  const dollars = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(dollars)) return null;
  // `dollars * 100` is itself lossy — 1.005 * 100 is 100.49999999999999, which
  // rounds down to the wrong cent. Settle the representation error at a
  // precision well past a cent before rounding.
  return Math.round(Number((dollars * 100).toFixed(4)));
}

export function fromCents(cents) {
  return (cents ?? 0) / 100;
}

export function formatCents(cents) {
  return currencyFormatter.format(fromCents(cents));
}

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar date as "YYYY-MM-DD" — not toISOString(), which is UTC and
 *  silently reports yesterday for anyone west of Greenwich in the evening. */
export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Periods are "YYYY-MM". Derived from the date on a record, never stored
 *  alongside it, so the two can never disagree.
 *
 *  Matched strictly rather than sliced at 7 characters. A malformed legacy date
 *  like "2026-1-5" used to yield the period "2026-1-", which sorts after
 *  "2026-08" but before "2026-11" — so the record vanished from August and
 *  reappeared in November. Anything that is not a real period sorts nowhere;
 *  it has to become null and be handled as undated. */
export function toPeriod(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
}

export function currentPeriod(date = new Date()) {
  return toPeriod(todayISO(date));
}

/**
 * `period <= limit` for two periods, guarded.
 *
 * Zero-padded "YYYY-MM" compares lexicographically the same way it compares
 * chronologically, so a bare `<=` is tempting — but `null <= null` is *true* in
 * JavaScript, since both sides coerce to 0. A single undated record and a null
 * period would then land inside a cumulative sum that also counts it in the
 * undated bucket, double-counting real money with nothing on screen to show it.
 * Never write the bare comparison against a period that might be null.
 */
export function periodLTE(period, limit) {
  if (typeof period !== "string" || typeof limit !== "string") return false;
  return period <= limit;
}

/**
 * Step a period by whole months. Real Date arithmetic rather than string math,
 * which yields "2026-13" — and that sorts *before* "2027-01", so December plus
 * one month would quietly read January's data as if it were the future.
 */
export function addMonths(period, delta) {
  if (toPeriod(period) == null) return null;
  const [year, month] = period.split("-").map(Number);
  const shifted = new Date(year, month - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

/** "2026-08" -> "August 2026", for period steppers and headings. */
export function formatPeriod(period) {
  if (toPeriod(period) == null) return "Undated";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(CURRENCY_LOCALE, {
    month: "long",
    year: "numeric",
  });
}

export function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * "2026-08-07" -> "Aug 7", for listing several dates inside a month whose name
 * is already on screen. Split field by field rather than handed to the Date
 * constructor, which reads a bare ISO date as UTC and so renders the previous
 * day for anyone west of Greenwich.
 */
export function formatDayShort(isoDate) {
  if (!isValidISODate(isoDate)) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(CURRENCY_LOCALE, {
    month: "short",
    day: "numeric",
  });
}
