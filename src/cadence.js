/**
 * How often a recurring amount arrives, and what it comes to in a typical month.
 *
 * Configuration describes income *in general* rather than in a named month, so
 * the figure it wants is the average: a fortnightly paycheque is 26 payments a
 * year, which is 2.1667 payments in an average month, not two. Take the two
 * payments and the plan is short by a month's pay every year.
 *
 * This is deliberately not the same question as "what lands in August". That
 * one has an exact answer — count the paydays on the calendar — and it needs a
 * real date to count from. It belongs to whatever screen is looking at a
 * specific month, not to the standing configuration, and nothing here should
 * grow a date to answer it.
 *
 * `src/paySchedule.js` is the other half of that split and the two tables here
 * and there share four names by coincidence of English, not by design: this one
 * asks how *many* payments a year, that one asks *which days*. They are not to
 * be consolidated — "twice a month" is 24 payments here and a pair of days of
 * the month there, and the second answer needs a calendar the first must not
 * have.
 */

/**
 * The cadences a source can be paid on, in the order they appear in the picker:
 * shortest interval first.
 */
export const CADENCES = {
  weekly: { label: "Weekly", perYear: 52 },
  biweekly: { label: "Every 2 weeks", perYear: 26 },
  semimonthly: { label: "Twice a month", perYear: 24 },
  monthly: { label: "Monthly", perYear: 12 },
  quarterly: { label: "Quarterly", perYear: 4 },
  annually: { label: "Annually", perYear: 1 },
};

export const CADENCE_KEYS = Object.keys(CADENCES);

export const DEFAULT_CADENCE = "monthly";

export function cadenceLabel(cadence) {
  return CADENCES[cadence]?.label ?? "Unknown cadence";
}

export function paymentsPerYear(cadence) {
  return CADENCES[cadence]?.perYear ?? 0;
}

/**
 * What one payment of `amountCents` on this cadence comes to per month.
 *
 * Rounded to a whole cent at the last step, so the figure stays an integer
 * number of cents like every other amount in the app. An unknown cadence
 * contributes nothing rather than a guess: a source that cannot say how often it
 * pays must not quietly inflate expected income.
 */
export function monthlyCents(amountCents, cadence) {
  const perYear = paymentsPerYear(cadence);
  if (!perYear || !Number.isFinite(amountCents)) return 0;
  return Math.round((amountCents * perYear) / 12);
}
