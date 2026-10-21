import { projectNetWorth } from "./netWorthProjection";
import { historicalReturnAt, HISTORICAL_RETURNS } from "./historicalReturns";
import { fromBps } from "../utils";

/**
 * The deterministic walk's answer is one line: what the plan comes to if the
 * market delivers exactly its assumed rate, every year, forever. This module
 * answers a different question — what range of outcomes a market that
 * actually varies year to year would have left the household with — by
 * running `projectNetWorth` (`netWorthProjection.js`) many times over, once
 * per draw or once per historical starting year, changing nothing about the
 * walk except which invested-pot return each year gets. **Nothing here is a
 * second derivation of the plan**: every trial and every cohort is built
 * from the exact same `walkInputs` the deterministic figure reads — see
 * `resolveWalkInputs` in `useRetirementProjection.js` — so a simulation can
 * never drift from the one the page headlines.
 *
 * **Monte Carlo** draws a lognormal return each year for an equity leg and a
 * bond leg (so a loss cannot compound below −100%, the way a real return
 * never can either), correlates the two draws, and blends them by the
 * phase's equity share. A seeded PRNG makes one run reproducible — the same
 * seed is the same ninety-six years of every trial, not just the first.
 *
 * **Historical backtesting** draws nothing: each cohort is the real sequence
 * of annual real returns starting in one calendar year of `historicalReturns.js`,
 * wrapping back to that dataset's first year if a plan's horizon runs past
 * its last. There is no distribution to be wrong about here, only the
 * ninety-eight years that happened.
 *
 * Both engines report through the same `aggregate`, so a fan chart does not
 * need to know which one produced its series.
 */

/** A small, fast, seeded PRNG — `https://github.com/bryc/code/blob/master/jshash/PRNGs.md`'s
 *  mulberry32, chosen for being short enough to read in full and good enough
 *  that nobody researching retirement withdrawal rates has ever needed more. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two independent standard normals from one PRNG, by the Box–Muller
 *  transform — the textbook way to turn a uniform draw into a normal one. */
function normalPair(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const radius = Math.sqrt(-2 * Math.log(u1));
  return [radius * Math.cos(2 * Math.PI * u2), radius * Math.sin(2 * Math.PI * u2)];
}

/**
 * Two standard normals correlated by `correlation` (−1..1), from two
 * independent draws off one PRNG — the Cholesky decomposition of a 2×2
 * correlation matrix, `z2 = ρ·z1 + √(1−ρ²)·z3`.
 */
export function correlatedPair(rng, correlation) {
  const [z1, z3] = normalPair(rng);
  const rho = Math.max(-1, Math.min(1, correlation));
  const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * z3;
  return [z1, z2];
}

/**
 * The lognormal's own `(mu, sigma)` that reproduces a given arithmetic mean
 * and standard deviation of simple annual returns — what a household types
 * ("seven percent, give or take fifteen") is an arithmetic mean and
 * volatility, the same convention every other rate in this app uses, but a
 * lognormal is parameterised by the mean and variance of its *log*. The
 * closed form that converts one to the other, so a return can never
 * compound below −100% the way a real one never does either.
 */
export function lognormalParams(meanBps, volBps) {
  const mean = fromBps(meanBps);
  const vol = fromBps(volBps);
  const sigmaSquared = Math.log(1 + (vol * vol) / ((1 + mean) * (1 + mean)));
  const mu = Math.log(1 + mean) - sigmaSquared / 2;
  return { mu, sigma: Math.sqrt(sigmaSquared) };
}

/** One year's draw from a lognormal parameterised by `lognormalParams`. */
export function drawReturn({ mu, sigma }, z) {
  return Math.exp(mu + sigma * z) - 1;
}

/**
 * One year's blended invested-pot return for a phase: an equity draw and a
 * bond draw, correlated, weighted by the phase's equity share. `phase` is
 * `{ equityShareBps, equityReturnBps, equityVolatilityBps, bondReturnBps,
 * bondVolatilityBps, correlationBps }`, every rate already real — deflated
 * once, in `useRetirementProjection.js`'s `effectiveReturnRates`, the way
 * every other rate in this app is. This module never reads an inflation
 * assumption at all.
 */
export function blendedReturn(phase, rng) {
  const [zEquity, zBond] = correlatedPair(rng, fromBps(phase.correlationBps ?? 0));
  const equity = drawReturn(lognormalParams(phase.equityReturnBps, phase.equityVolatilityBps), zEquity);
  const bond = drawReturn(lognormalParams(phase.bondReturnBps, phase.bondVolatilityBps), zBond);
  const equityShare = fromBps(phase.equityShareBps);
  return equityShare * equity + (1 - equityShare) * bond;
}

/** The blended real return the market actually delivered to a phase in
 *  `calendarYear`, from a historical dataset rather than a draw. */
function historicalBlend(phase, calendarYear, dataset) {
  const row = historicalReturnAt(calendarYear, dataset);
  const equityShare = fromBps(phase.equityShareBps);
  return (
    equityShare * fromBps(row.equityRealReturnBps) + (1 - equityShare) * fromBps(row.bondRealReturnBps)
  );
}

/**
 * Success and the spread of outcomes, read off a batch of trials or
 * cohorts — whichever engine produced them. "Succeeded" is exactly what the
 * deterministic walk already means by it: no year came up short before the
 * end of the plan (`projectNetWorth`'s `shortfallAge`). The percentile bands
 * are per age, across every trial alive at that age, which is every trial —
 * nothing here lets a trial stop early.
 */
export function aggregate(results) {
  const total = results.length;
  const successes = results.filter((result) => result.shortfallAge == null).length;
  const successRate = total > 0 ? successes / total : 0;

  const byAge = new Map();
  for (const result of results) {
    for (const point of result.series) {
      if (!byAge.has(point.age)) byAge.set(point.age, []);
      byAge.get(point.age).push(point.liquidCents);
    }
  }
  const percentile = (sorted, p) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[index];
  };
  const percentilesByAge = [...byAge.entries()]
    .map(([age, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        age,
        p10: percentile(sorted, 0.1),
        p25: percentile(sorted, 0.25),
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.9),
      };
    })
    .sort((a, b) => a.age - b.age);

  return { successRate, percentilesByAge };
}

/**
 * `trials` independent runs of the exact same plan, each year's invested-pot
 * return drawn fresh from `phases.saving`/`phases.retired`. One PRNG, seeded
 * once and advanced across every trial and every year of every trial, so a
 * `seed` reproduces the whole batch — not just its first trial.
 */
export function runMonteCarlo({ walkInputs, phases, trials = 500, seed = 1 }) {
  const rng = mulberry32(seed);
  const results = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const investedRateAt = (age, working) => blendedReturn(working ? phases.saving : phases.retired, rng);
    results.push(projectNetWorth({ ...walkInputs, investedRateAt }));
  }
  return { trials: results, seed, ...aggregate(results) };
}

/**
 * One cohort per calendar year `dataset` covers — what this exact plan would
 * have come to, had the market behaved as it actually did starting that
 * year. No PRNG, no distribution: `historicalBlend` reads the dataset
 * directly, wrapping to its first year if the plan outlives it.
 */
export function runHistoricalBacktest({ walkInputs, phases, dataset = HISTORICAL_RETURNS }) {
  const cohorts = dataset.map(({ year: startYear }) => {
    const investedRateAt = (age, working) => {
      const calendarYear = startYear + (age - walkInputs.currentAge);
      return historicalBlend(working ? phases.saving : phases.retired, calendarYear, dataset);
    };
    return { startYear, ...projectNetWorth({ ...walkInputs, investedRateAt }) };
  });
  return { cohorts, ...aggregate(cohorts) };
}
