import { LIFE_EVENT_KINDS } from "./netWorthProjection";

/**
 * What claiming Social Security early or late does to the benefit.
 *
 * A pure module beside `netWorthProjection.js`, and a deliberately small one:
 * it exists because this is the one piece of retirement arithmetic a household
 * cannot do in its head, and because the answer is **statutory** rather than an
 * assumption. Every other figure on the Retirement page is a guess the plan
 * stores and the household can argue with; the reduction for claiming at 62 is
 * a number in the regulations, so it is a constant here and not a field there.
 *
 * **What this module does not do is estimate the benefit itself.** That depends
 * on thirty-five years of indexed earnings this app has never seen, and the
 * household's real figure is on their statement at ssa.gov. Guessing it from
 * one year of the income plan would be inventing a decision nobody made — the
 * "nothing is invented" rule — and would be wrong by a wide margin for anyone
 * whose pay today is not typical of their career. So the benefit at full
 * retirement age is typed, and only the adjustment is derived.
 *
 * **The result is an ordinary income life event and nothing else.** There is no
 * Social Security field on the retirement plan, no second term in the need, and
 * no new store: `retirementOutlook` already builds the need from the modelled
 * retired-year draws net of event income, so a household that states its
 * benefit here is answered by the maths that was already there. This module and
 * `SocialSecurityModal` are an *entry* path, and the record they write is one
 * the general event form can edit afterwards like any other.
 */

/**
 * The age at which the full benefit is payable — 67 for everyone born in 1960
 * or later, which is everyone who is not already at it.
 *
 * A single constant rather than a table keyed on birth year, because the
 * cohorts with a lower one (66 and some months, born 1955–1959) are all past
 * 66 today: for them the claiming decision is either made or a year away, and
 * the figure on their statement is the one to type. If this app is still
 * running when that stops being true, this is the line that moves.
 */
export const FULL_RETIREMENT_AGE = 67;

/** The window the law allows a retirement benefit to be claimed in. */
export const EARLIEST_CLAIM_AGE = 62;
export const LATEST_CLAIM_AGE = 70;

/** Every age the form offers, whole years because the projection walks years. */
export const CLAIM_AGES = Array.from(
  { length: LATEST_CLAIM_AGE - EARLIEST_CLAIM_AGE + 1 },
  (unused, index) => EARLIEST_CLAIM_AGE + index
);

// The three statutory rates, as basis points a month. Early claiming is
// reduced by 5/9 of one percent for each of the first thirty-six months and
// 5/12 of one percent for every month beyond them — which is why the curve
// bends at 64 rather than running straight from 62 to 67. Delaying earns 2/3
// of one percent a month, the eight percent a year usually quoted.
const EARLY_FIRST_36_BPS = 500 / 9;
const EARLY_BEYOND_36_BPS = 500 / 12;
const DELAYED_BPS = 200 / 3;

/** Months of the first, steeper early reduction. */
const EARLY_BEND_MONTHS = 36;

/**
 * The share of the full benefit payable to someone claiming at `claimAge`,
 * in basis points: 7000 at 62, 10000 at 67, 12400 at 70.
 *
 * Rounded to the basis point, which is finer than SSA publishes the same table
 * (it gives 86.7% at 65, this gives 86.67%), and **the rounded figure is what
 * the annual amount below is derived from** — the page shows the share and the
 * amount side by side, and two figures a reader can check against each other
 * must not be computed from different precisions. The cost of that is under a
 * dollar a year at the two ages where the exact share recurs.
 *
 * An age outside the statutory window is clamped into it rather than refused:
 * the only caller offers nine options, so this is a guard, and a guard that
 * returned null would make every figure downstream of it blank.
 */
export function claimShareBps(claimAge) {
  const age = Math.min(LATEST_CLAIM_AGE, Math.max(EARLIEST_CLAIM_AGE, claimAge));
  const months = (age - FULL_RETIREMENT_AGE) * 12;
  if (months === 0) return 10000;
  if (months > 0) return Math.round(10000 + months * DELAYED_BPS);
  const early = -months;
  const steep = Math.min(EARLY_BEND_MONTHS, early);
  const shallow = Math.max(0, early - EARLY_BEND_MONTHS);
  return Math.round(10000 - steep * EARLY_FIRST_36_BPS - shallow * EARLY_BEYOND_36_BPS);
}

/**
 * What a household claiming at `claimAge` is paid a year, from a benefit stated
 * as a monthly figure at full retirement age.
 *
 * Twelve months of the adjusted benefit, rounded once at the end.
 */
export function annualBenefitCents(monthlyBenefitCents, claimAge) {
  if (!(monthlyBenefitCents > 0)) return 0;
  return Math.round((monthlyBenefitCents * 12 * claimShareBps(claimAge)) / 10000);
}

/**
 * The life event that states it: income, from the claiming age, for the rest of
 * the plan.
 *
 * `years: null` is deliberate and is the one thing about Social Security that
 * needs no assumption — it is paid until death, and the plan already ends at
 * the life expectancy. In today's dollars like every figure the projection
 * takes, which is also what makes this honest: the benefit carries a statutory
 * cost-of-living adjustment, so a figure that holds its value in real terms is
 * what the law actually promises rather than a convenient simplification.
 */
export function socialSecurityEvent({ monthlyBenefitCents, claimAge, name = "Social Security" }) {
  return {
    name,
    kind: LIFE_EVENT_KINDS.INCOME,
    startAge: Math.min(LATEST_CLAIM_AGE, Math.max(EARLIEST_CLAIM_AGE, claimAge)),
    years: null,
    annualCents: annualBenefitCents(monthlyBenefitCents, claimAge),
  };
}
