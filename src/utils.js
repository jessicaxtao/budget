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
 *  alongside it, so the two can never disagree. */
export function toPeriod(isoDate) {
  if (typeof isoDate !== "string" || isoDate.length < 7) return null;
  return isoDate.slice(0, 7);
}

export function currentPeriod(date = new Date()) {
  return toPeriod(todayISO(date));
}

export function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
