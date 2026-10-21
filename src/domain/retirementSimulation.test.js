import { projectNetWorth, INCOME_SOURCES } from "./netWorthProjection";
import {
  aggregate,
  blendedReturn,
  correlatedPair,
  drawReturn,
  lognormalParams,
  mulberry32,
  runHistoricalBacktest,
  runMonteCarlo,
} from "./retirementSimulation";

/**
 * The simulation engine as the pure arithmetic it is — direct calls, hand-
 * computed fixtures, no React. Two tripwires carry the weight: a trial or a
 * cohort with no volatility to act on must reproduce `projectNetWorth`'s
 * plain deterministic walk exactly, the same way `netWorthProjection.test.js`
 * ties itself to `projectRetirement`. If either ever drifts, the simulation
 * is answering a different question than the headline figure.
 */

const WALK_INPUTS = {
  currentAge: 50,
  retirementAge: 65,
  lifeExpectancy: 85,
  pots: { cashCents: 0, investedCents: 0, retirementCents: 500_000_00 },
  income: { source: INCOME_SOURCES.GROWTH, takeHomeAnnualCents: 80_000_00, growthRateBps: 0 },
  spendingCents: 50_000_00,
  savingsCents: 10_000_00,
  afterTaxRetirementCents: 5_000_00,
  pretaxRetirementCents: 0,
  retirementSpendingCents: 40_000_00,
  retirementTaxRateBps: 0,
  inflationRateBps: 0,
  cashRateBps: 0,
  propertyRateBps: 0,
  events: [],
};

describe("mulberry32", () => {
  test("the same seed is the same sequence", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBeCloseTo(b(), 9);
  });

  test("stays in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 200; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("lognormalParams and drawReturn", () => {
  test("zero volatility draws exactly the mean, whatever z is", () => {
    const params = lognormalParams(1000, 0);
    expect(drawReturn(params, -2)).toBeCloseTo(0.1, 10);
    expect(drawReturn(params, 0)).toBeCloseTo(0.1, 10);
    expect(drawReturn(params, 3)).toBeCloseTo(0.1, 10);
  });

  test("a loss can never compound below -100%, however far z falls", () => {
    const params = lognormalParams(700, 1800);
    expect(drawReturn(params, -10)).toBeGreaterThan(-1);
  });
});

describe("correlatedPair", () => {
  test("correlation of 1 makes the two draws identical", () => {
    const rng = mulberry32(5);
    const [z1, z2] = correlatedPair(rng, 1);
    expect(z2).toBeCloseTo(z1, 10);
  });

  test("correlation of -1 makes the two draws exact opposites", () => {
    const rng = mulberry32(5);
    const [z1, z2] = correlatedPair(rng, -1);
    expect(z2).toBeCloseTo(-z1, 10);
  });
});

describe("blendedReturn", () => {
  test("zero volatility on both legs blends the two means by the equity share", () => {
    const rng = mulberry32(3);
    const phase = {
      equityShareBps: 8000,
      equityReturnBps: 1000,
      equityVolatilityBps: 0,
      bondReturnBps: 400,
      bondVolatilityBps: 0,
      correlationBps: 0,
    };
    // 0.8 * 10% + 0.2 * 4% = 8.8%, whatever the draw would otherwise be.
    expect(blendedReturn(phase, rng)).toBeCloseTo(0.088, 10);
  });
});

/** The reported, rounded figures a point carries — what the chart and the
 *  headline actually read. `exact` is deliberately unrounded "for the
 *  identity" bookkeeping (see `netWorthProjection.js`), so two series built
 *  by different arithmetic paths to the same answer can disagree there by a
 *  float's last bit without disagreeing about anything that matters. */
function rounded(series) {
  return series.map(({ exact, ...point }) => point);
}

describe("runMonteCarlo", () => {
  const phases = {
    saving: {
      equityShareBps: 8000,
      equityReturnBps: 1000,
      equityVolatilityBps: 0,
      bondReturnBps: 400,
      bondVolatilityBps: 0,
      correlationBps: 0,
    },
    retired: {
      equityShareBps: 5000,
      equityReturnBps: 1000,
      equityVolatilityBps: 0,
      bondReturnBps: 400,
      bondVolatilityBps: 0,
      correlationBps: 0,
    },
  };

  test("zero volatility reproduces the plain deterministic walk, trial for trial", () => {
    // 0.8*10% + 0.2*4% = 8.8% while saving; 0.5*10% + 0.5*4% = 7% once retired.
    const deterministic = projectNetWorth({ ...WALK_INPUTS, growthRateBps: 880, drawdownRateBps: 700 });
    const { trials } = runMonteCarlo({ walkInputs: WALK_INPUTS, phases, trials: 4, seed: 42 });
    expect(trials).toHaveLength(4);
    for (const trial of trials) {
      expect(rounded(trial.series)).toEqual(rounded(deterministic.series));
    }
  });

  test("the same seed reproduces the same batch, start to finish", () => {
    const volatile = {
      saving: { ...phases.saving, equityVolatilityBps: 1800, bondVolatilityBps: 700 },
      retired: { ...phases.retired, equityVolatilityBps: 1800, bondVolatilityBps: 700 },
    };
    const first = runMonteCarlo({ walkInputs: WALK_INPUTS, phases: volatile, trials: 10, seed: 2024 });
    const second = runMonteCarlo({ walkInputs: WALK_INPUTS, phases: volatile, trials: 10, seed: 2024 });
    expect(second.trials.map((t) => t.atEndCents)).toEqual(first.trials.map((t) => t.atEndCents));
    expect(second.successRate).toBe(first.successRate);
  });
});

describe("runHistoricalBacktest", () => {
  test("a dataset with no year-to-year variance reproduces the deterministic walk", () => {
    const flatDataset = [{ year: 2000, equityRealReturnBps: 500, bondRealReturnBps: 200 }];
    const phases = {
      saving: { equityShareBps: 8000 },
      retired: { equityShareBps: 5000 },
    };
    // 0.8*5% + 0.2*2% = 4.4% while saving; 0.5*5% + 0.5*2% = 3.5% once retired.
    const deterministic = projectNetWorth({ ...WALK_INPUTS, growthRateBps: 440, drawdownRateBps: 350 });
    const { cohorts } = runHistoricalBacktest({ walkInputs: WALK_INPUTS, phases, dataset: flatDataset });
    expect(cohorts).toHaveLength(1);
    expect(rounded(cohorts[0].series)).toEqual(rounded(deterministic.series));
  });

  test("a plan that outlives the dataset wraps back to its first year", () => {
    // Three very different years. A plan spanning more than three years from
    // its start must cycle 2000, 2001, 2002, 2000, 2001, 2002, ... rather
    // than running out of data or holding the last year flat.
    const dataset = [
      { year: 2000, equityRealReturnBps: 2000, bondRealReturnBps: 0 },
      { year: 2001, equityRealReturnBps: -2000, bondRealReturnBps: 0 },
      { year: 2002, equityRealReturnBps: 0, bondRealReturnBps: 0 },
    ];
    const phases = { saving: { equityShareBps: 10000 }, retired: { equityShareBps: 10000 } };
    // Take-home exactly covers spending and nothing else moves cash or the
    // invested pot, so the retirement pot is the only figure growth touches —
    // isolating the one series this test is about.
    const walkInputs = {
      ...WALK_INPUTS,
      currentAge: 50,
      retirementAge: 56,
      lifeExpectancy: 58,
      spendingCents: WALK_INPUTS.income.takeHomeAnnualCents,
      savingsCents: 0,
      afterTaxRetirementCents: 0,
      pretaxRetirementCents: 0,
      retirementSpendingCents: 0,
      retirementTaxRateBps: 0,
    };
    const { cohorts } = runHistoricalBacktest({ walkInputs, phases, dataset });
    const startingAt2000 = cohorts.find((cohort) => cohort.startYear === 2000);
    const retirementSeries = startingAt2000.series.map((point) => point.retirementCents);

    // Ages 50..57 (eight years of growth): calendar years 2000..2007, which
    // wraps every three years as 20% / −20% / 0% / 20% / −20% / 0% / 20% / −20%.
    // `balance` is carried unrounded between years, as the walk itself does —
    // only each reported point is rounded — so this can't drift from the
    // implementation by an accumulated rounding cent.
    const cycle = [0.2, -0.2, 0, 0.2, -0.2, 0, 0.2, -0.2];
    let balance = WALK_INPUTS.pots.retirementCents;
    const expected = [Math.round(balance)];
    for (const rate of cycle) {
      balance *= 1 + rate;
      expected.push(Math.round(balance));
    }
    expect(retirementSeries).toEqual(expected);
  });
});

describe("aggregate", () => {
  test("percentiles and a success rate, read off a hand-built batch", () => {
    const results = [100, 200, 300, 400, 500].map((liquidCents, index) => ({
      // Two of the five fell short before the end of the plan.
      shortfallAge: index < 2 ? 80 : null,
      series: [{ age: 70, liquidCents }],
    }));
    const { successRate, percentilesByAge } = aggregate(results);
    expect(successRate).toBeCloseTo(0.6, 10);
    expect(percentilesByAge).toEqual([
      { age: 70, p10: 100, p25: 200, p50: 300, p75: 400, p90: 500 },
    ]);
  });

  test("an empty batch has no success rate to report and no bands to draw", () => {
    expect(aggregate([])).toEqual({ successRate: 0, percentilesByAge: [] });
  });
});
