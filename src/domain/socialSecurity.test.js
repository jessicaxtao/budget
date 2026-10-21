import { LIFE_EVENT_KINDS } from "./netWorthProjection";
import {
  CLAIM_AGES,
  EARLIEST_CLAIM_AGE,
  FULL_RETIREMENT_AGE,
  LATEST_CLAIM_AGE,
  annualBenefitCents,
  claimShareBps,
  socialSecurityEvent,
} from "./socialSecurity";

/**
 * The claiming adjustment, driven directly: arithmetic with a rule of its own,
 * and the rule is a statute rather than a choice this app made. The whole table
 * is written out rather than derived, for `paySchedule.test.js`'s reason — a
 * fixture computed from the same three rates the module uses would assert that
 * the code agrees with itself. These nine figures are SSA's.
 */

test("the statutory share at every claiming age", () => {
  expect(claimShareBps(62)).toBe(7000);
  expect(claimShareBps(63)).toBe(7500);
  expect(claimShareBps(64)).toBe(8000);
  expect(claimShareBps(65)).toBe(8667);
  expect(claimShareBps(66)).toBe(9333);
  expect(claimShareBps(67)).toBe(10000);
  expect(claimShareBps(68)).toBe(10800);
  expect(claimShareBps(69)).toBe(11600);
  expect(claimShareBps(70)).toBe(12400);
});

test("full retirement age is the hinge, and nothing else is", () => {
  expect(claimShareBps(FULL_RETIREMENT_AGE)).toBe(10000);
  for (const age of CLAIM_AGES) {
    if (age < FULL_RETIREMENT_AGE) expect(claimShareBps(age)).toBeLessThan(10000);
    if (age > FULL_RETIREMENT_AGE) expect(claimShareBps(age)).toBeGreaterThan(10000);
  }
});

test("the early reduction bends at three years out, where the law bends it", () => {
  // The first thirty-six months cost 5/9 of a point each and the months beyond
  // them 5/12 — so the three years from 64 to 67 cost twice what the two from
  // 62 to 64 do. A single straight rate would be the easy mistake here, and it
  // would put 62 at about 73% instead of 70%.
  const steep = claimShareBps(67) - claimShareBps(64);
  const shallow = claimShareBps(64) - claimShareBps(62);
  expect(steep).toBe(2000);
  expect(shallow).toBe(1000);
  expect(steep / 3).toBeGreaterThan(shallow / 2);
});

test("delaying earns eight points a year, evenly", () => {
  expect(claimShareBps(68) - claimShareBps(67)).toBe(800);
  expect(claimShareBps(69) - claimShareBps(68)).toBe(800);
  expect(claimShareBps(70) - claimShareBps(69)).toBe(800);
});

test("an age outside the window is clamped, not refused", () => {
  expect(claimShareBps(55)).toBe(claimShareBps(EARLIEST_CLAIM_AGE));
  expect(claimShareBps(80)).toBe(claimShareBps(LATEST_CLAIM_AGE));
  expect(socialSecurityEvent({ monthlyBenefitCents: 240000, claimAge: 55 }).startAge).toBe(62);
});

test("the yearly figure is twelve adjusted months", () => {
  // $2,400 a month at full retirement age.
  expect(annualBenefitCents(240000, 67)).toBe(2_880_00 * 10);
  expect(annualBenefitCents(240000, 62)).toBe(20_160_00);
  expect(annualBenefitCents(240000, 70)).toBe(35_712_00);
});

test("a benefit nobody has stated is no money, not a guess", () => {
  expect(annualBenefitCents(0, 67)).toBe(0);
  expect(annualBenefitCents(null, 67)).toBe(0);
});

test("what it writes is an ordinary income event for the rest of the plan", () => {
  expect(socialSecurityEvent({ monthlyBenefitCents: 240000, claimAge: 62 })).toEqual({
    name: "Social Security",
    kind: LIFE_EVENT_KINDS.INCOME,
    startAge: 62,
    // Null rather than a count: it is paid until death, and the plan already
    // ends at the life expectancy.
    years: null,
    annualCents: 20_160_00,
  });
});
