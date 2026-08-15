import { projectRetirement, requiredNestEgg } from "./useRetirementProjection";

/**
 * The projection maths on its own, driven as the pure function it is.
 *
 * What matters here is not that the arithmetic runs but that its two halves
 * agree: `requiredNestEgg` is a closed form and the drawdown is a year-by-year
 * simulation, and the whole page is a comparison between a figure produced by
 * one and a figure produced by the other. If they ever stop meaning the same
 * thing, every answer on the screen is off by an amount nobody can see.
 */

// A plan with no inflation, so the nominal rates *are* the real ones and the
// expected figures can be worked out by hand. The deflation itself is checked
// on its own below.
const PLAN = {
  currentAge: 40,
  retirementAge: 65,
  lifeExpectancy: 90,
  startingCents: 10_000_00,
  annualContributionCents: 12_000_00,
  annualSpendingCents: 40_000_00,
  growthRateBps: 700,
  drawdownRateBps: 300,
  inflationRateBps: 0,
};

describe("what has to be there on the first day", () => {
  test("a flat rate is just the years of spending", () => {
    expect(requiredNestEgg(40_000_00, 25, 0)).toBe(25 * 40_000_00);
  });

  test("the first year is not discounted — it is needed that morning", () => {
    expect(requiredNestEgg(40_000_00, 1, 0.03)).toBeCloseTo(40_000_00, 6);
  });

  test("nothing is needed for a retirement of no years", () => {
    expect(requiredNestEgg(40_000_00, 0, 0.03)).toBe(0);
  });
});

/**
 * The tripwire. A balance of exactly `need` on the first day of retirement has
 * to be a balance of zero on the last — that is the definition of the figure,
 * and the only thing that keeps the closed form and the simulation describing
 * the same plan. Any change to either has to keep this green.
 */
test("a plan funded to the cent runs out to the cent", () => {
  const spending = 40_000_00;
  const years = 25;
  const needCents = Math.round(requiredNestEgg(spending, years, 0.03));

  const { projectedCents, needCents: reported, surplusCents, depletionAge } = projectRetirement({
    ...PLAN,
    // Retiring today, so the starting figure *is* the balance at retirement and
    // the accumulation half of the plan is out of the way.
    currentAge: 65,
    retirementAge: 65,
    lifeExpectancy: 65 + years,
    startingCents: needCents,
    annualContributionCents: 0,
    annualSpendingCents: spending,
  });

  expect(reported).toBe(needCents);
  expect(projectedCents).toBe(needCents);
  // Within a cent or two: the starting figure is rounded to a whole cent, and
  // that half-cent grows for twenty-five years.
  expect(Math.abs(surplusCents)).toBeLessThanOrEqual(5);
  expect(depletionAge).toBeNull();
});

describe("saving up", () => {
  test("the balance at retirement is the starting sum grown plus the contributions", () => {
    const { projectedCents, yearsToRetirement } = projectRetirement(PLAN);

    const expected =
      PLAN.startingCents * 1.07 ** 25 + PLAN.annualContributionCents * ((1.07 ** 25 - 1) / 0.07);

    expect(yearsToRetirement).toBe(25);
    expect(projectedCents).toBe(Math.round(expected));
  });

  test("the series is the answer — the headline is its value at the retirement age", () => {
    const { series, projectedCents } = projectRetirement(PLAN);

    expect(series[0]).toEqual({ age: 40, balanceCents: PLAN.startingCents, phase: "saving" });
    expect(series.find((point) => point.age === 65)).toEqual({
      age: 65,
      balanceCents: projectedCents,
      phase: "retired",
    });
    // One point per birthday from today through the last year the money has to
    // last, inclusive of both ends.
    expect(series).toHaveLength(90 - 40 + 1);
    expect(series[series.length - 1].age).toBe(90);
  });

  test("no real growth is a straight line, not a division by zero", () => {
    const { projectedCents } = projectRetirement({
      ...PLAN,
      // Growing at exactly the rate money loses value: in today's dollars the
      // balance only moves by what is put into it.
      growthRateBps: 300,
      inflationRateBps: 300,
    });

    expect(projectedCents).toBe(PLAN.startingCents + 25 * PLAN.annualContributionCents);
  });

  test("the required contribution is the one that lands exactly on the target", () => {
    const { needCents, requiredContributionCents } = projectRetirement(PLAN);

    const { projectedCents } = projectRetirement({
      ...PLAN,
      annualContributionCents: requiredContributionCents,
    });

    expect(projectedCents).toBeCloseTo(needCents, -2);
  });

  test("someone retiring this year has no years left to save in", () => {
    const { requiredContributionCents } = projectRetirement({
      ...PLAN,
      currentAge: 65,
    });

    expect(requiredContributionCents).toBeNull();
  });
});

describe("inflation", () => {
  test("both rates are deflated, and the projection reports what it used", () => {
    const { realGrowthBps, realDrawdownBps } = projectRetirement({
      ...PLAN,
      inflationRateBps: 250,
    });

    // (1.07 / 1.025) − 1 = 4.39%, and (1.03 / 1.025) − 1 = 0.49%.
    expect(realGrowthBps).toBe(439);
    expect(realDrawdownBps).toBe(49);
  });

  test("a nominal projection would be the flattering one", () => {
    const real = projectRetirement({ ...PLAN, inflationRateBps: 250 });
    const nominal = projectRetirement(PLAN);

    expect(real.projectedCents).toBeLessThan(nominal.projectedCents);
  });
});

describe("running out", () => {
  test("the age the money runs out is the year it cannot pay for in full", () => {
    const { depletionAge, fundedThroughAge, surplusCents, gapCents } = projectRetirement({
      ...PLAN,
      startingCents: 0,
      annualContributionCents: 0,
      // Ten years of spending, at a rate that barely grows, against nothing
      // saved at all.
      lifeExpectancy: 75,
      annualSpendingCents: 40_000_00,
    });

    expect(depletionAge).toBe(65);
    expect(fundedThroughAge).toBe(65);
    expect(surplusCents).toBe(0);
    expect(gapCents).toBeLessThan(0);
  });

  test("a plan that lasts reports no depletion and the surplus left over", () => {
    const { depletionAge, fundedThroughAge, surplusCents, gapCents, fundedRatio } =
      projectRetirement({
        ...PLAN,
        startingCents: 2_000_000_00,
        annualSpendingCents: 40_000_00,
      });

    expect(depletionAge).toBeNull();
    expect(fundedThroughAge).toBe(90);
    expect(surplusCents).toBeGreaterThan(0);
    expect(gapCents).toBeGreaterThan(0);
    expect(fundedRatio).toBeGreaterThan(1);
  });

  test("the balance is floored at zero rather than drawn as a debt", () => {
    const { series } = projectRetirement({
      ...PLAN,
      startingCents: 0,
      annualContributionCents: 0,
      annualSpendingCents: 40_000_00,
    });

    expect(series.every((point) => point.balanceCents >= 0)).toBe(true);
  });
});

describe("a plan that cannot be answered yet", () => {
  test("says what is missing rather than drawing a chart of nothing", () => {
    const { ready, issues, series } = projectRetirement({
      ...PLAN,
      currentAge: null,
      retirementAge: null,
    });

    expect(ready).toBe(false);
    expect(series).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining(["Enter your age today.", "Enter the age you want to retire."])
    );
  });

  test("catches a retirement age already behind you", () => {
    const { ready, issues } = projectRetirement({ ...PLAN, currentAge: 70 });

    expect(ready).toBe(false);
    expect(issues).toEqual(
      expect.arrayContaining([
        "Your retirement age is in the past — set it to today's age or later.",
      ])
    );
  });

  test("catches money that has to last no time at all", () => {
    const { ready, issues } = projectRetirement({ ...PLAN, lifeExpectancy: 65 });

    expect(ready).toBe(false);
    expect(issues).toEqual(
      expect.arrayContaining(["Set how long the money has to last to a year after you retire."])
    );
  });

  test("retiring this year is a real plan, not an error", () => {
    const { ready } = projectRetirement({ ...PLAN, currentAge: 65 });

    expect(ready).toBe(true);
  });

  test("no spending figure is a question, not a zero target", () => {
    const { ready, issues } = projectRetirement({ ...PLAN, annualSpendingCents: 0 });

    expect(ready).toBe(false);
    expect(issues).toEqual(
      expect.arrayContaining(["Say what you expect retirement to cost each year."])
    );
  });
});
