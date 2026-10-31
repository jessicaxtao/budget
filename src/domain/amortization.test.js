import {
  paymentFor,
  amortize,
  summarize,
  compareWhatIf,
  remainingAt,
  MAX_SCHEDULE_ROWS,
} from "./amortization";

/**
 * The sixth tripwire. Every claim here is checked against a loan computed by
 * hand or against a structural truth, never against the module's own output —
 * the point of a tripwire is that it cannot drift along with the code it guards.
 */

describe("paymentFor", () => {
  it("is principal ÷ term at a zero rate", () => {
    expect(paymentFor(120000, 0, 12)).toBe(10000);
    expect(paymentFor(100000, 0, 3)).toBe(33333);
  });

  it("is the annuity payment with a rate, rounded to the cent", () => {
    // $100.00 at 12% APR (1% a month) over 2 months. By hand:
    //   payment = P·r / (1 − (1+r)⁻²), r = 0.01
    //           = 1000·0.01 / (1 − 1.01⁻²) = 10 / 0.0197039... = 50751.2 cents
    expect(paymentFor(100000, 1200, 2)).toBe(50751);
  });

  it("refuses junk inputs with a zero payment", () => {
    expect(paymentFor(0, 575, 360)).toBe(0);
    expect(paymentFor(-100, 575, 360)).toBe(0);
    expect(paymentFor(100000, 575, 0)).toBe(0);
  });
});

describe("amortize — a hand-computed loan", () => {
  // $1,000.00 owed, 12% APR (1% a month), a $500.00 payment. By hand:
  //   m1: interest round(100000·0.01)=1000, principal 50000−1000=49000, bal 51000
  //   m2: interest round(51000·0.01)= 510, principal 50000− 510=49490, bal  1510
  //   m3: interest round( 1510·0.01)=  15, capacity 49985 ≥ 1510 → pay off 1510
  const { rows, neverPaysOff, startingBalanceCents } = amortize({
    balanceCents: 100000,
    rateBps: 1200,
    paymentCents: 50000,
    fromDate: "2026-01-15",
  });

  it("produces exactly the hand-computed rows", () => {
    expect(neverPaysOff).toBe(false);
    expect(startingBalanceCents).toBe(100000);
    expect(rows).toEqual([
      { n: 1, date: "2026-01-15", rateBps: 1200, interestCents: 1000, principalCents: 49000, extraCents: 0, balanceCents: 51000 },
      { n: 2, date: "2026-02-15", rateBps: 1200, interestCents: 510, principalCents: 49490, extraCents: 0, balanceCents: 1510 },
      { n: 3, date: "2026-03-15", rateBps: 1200, interestCents: 15, principalCents: 1510, extraCents: 0, balanceCents: 0 },
    ]);
  });

  it("steps the payment date a month at a time, clamping a long day", () => {
    const end = amortize({ balanceCents: 100000, rateBps: 0, paymentCents: 20000, fromDate: "2026-01-31" });
    expect(end.rows.map((row) => row.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });
});

describe("amortize — the contract schedule invariant", () => {
  // A real thirty-year loan: $325,000 at 5.75% over 360 months. The payment is
  // paymentFor's, not a magic number — feeding one function's output to another
  // and checking the balance walks to zero is a cross-check, not a tautology.
  const principal = 32_500_000;
  const termMonths = 360;
  const payment = paymentFor(principal, 575, termMonths);
  const schedule = amortize({
    balanceCents: principal,
    rateBps: 575,
    paymentCents: payment,
    fromDate: "2026-01-01",
    termEnd: termMonths,
  });
  const { rows } = schedule;

  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);

  it("has exactly termMonths rows and pays off", () => {
    expect(schedule.neverPaysOff).toBe(false);
    expect(rows).toHaveLength(termMonths);
    expect(rows[rows.length - 1].balanceCents).toBe(0);
  });

  it("repays the original principal to the cent", () => {
    expect(sum((row) => row.principalCents + row.extraCents)).toBe(principal);
  });

  it("sums every payment to its interest plus its principal — Σ holds", () => {
    const payments = sum((row) => row.interestCents + row.principalCents + row.extraCents);
    expect(payments).toBe(sum((row) => row.principalCents + row.extraCents) + sum((row) => row.interestCents));
  });

  it("never lets the balance rise", () => {
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].balanceCents).toBeLessThanOrEqual(rows[i - 1].balanceCents);
    }
  });
});

describe("amortize — a zero-rate contract schedule", () => {
  it("is principal ÷ term, every row the same principal, no interest", () => {
    const schedule = amortize({
      balanceCents: 120000,
      rateBps: 0,
      paymentCents: paymentFor(120000, 0, 12),
      fromDate: "2026-01-01",
      termEnd: 12,
    });
    expect(schedule.rows).toHaveLength(12);
    expect(schedule.rows.every((row) => row.interestCents === 0)).toBe(true);
    expect(schedule.rows.every((row) => row.principalCents === 10000)).toBe(true);
    expect(schedule.rows[11].balanceCents).toBe(0);
  });
});

describe("amortize — with extras", () => {
  const principal = 32_500_000;
  const payment = paymentFor(principal, 575, 360);
  const base = amortize({ balanceCents: principal, rateBps: 575, paymentCents: payment, fromDate: "2026-01-01", termEnd: 360 });
  const faster = amortize({
    balanceCents: principal,
    rateBps: 575,
    paymentCents: payment,
    fromDate: "2026-01-01",
    termEnd: 360,
    extras: { extraMonthlyCents: 10000 },
  });

  it("still repays exactly the starting balance", () => {
    const repaid = faster.rows.reduce((total, row) => total + row.principalCents + row.extraCents, 0);
    expect(repaid).toBe(principal);
  });

  it("is never longer than the baseline", () => {
    expect(faster.rows.length).toBeLessThanOrEqual(base.rows.length);
    expect(faster.rows.length).toBeLessThan(base.rows.length);
  });
});

describe("amortize — a payment that cannot cover the interest", () => {
  it("stops at the cap and says it never pays off", () => {
    const schedule = amortize({
      balanceCents: 32_500_000,
      rateBps: 575,
      paymentCents: 100000, // below the first month's interest
      fromDate: "2026-01-01",
    });
    expect(schedule.neverPaysOff).toBe(true);
    expect(schedule.rows).toHaveLength(MAX_SCHEDULE_ROWS);
  });
});

describe("summarize", () => {
  const principal = 32_500_000;
  const payment = paymentFor(principal, 575, 360);
  const schedule = amortize({ balanceCents: principal, rateBps: 575, paymentCents: payment, fromDate: "2026-01-01", termEnd: 360 });
  const summary = summarize(schedule.rows);

  it("counts the payments left and the payoff date", () => {
    expect(summary.paymentsLeft).toBe(360);
    expect(summary.payoffDate).toBe(schedule.rows[359].date);
  });

  it("finds the crossover — the first payment that is more principal than interest", () => {
    const { crossover } = summary;
    expect(crossover).not.toBeNull();
    const row = schedule.rows[crossover.n - 1];
    const before = schedule.rows[crossover.n - 2];
    expect(row.principalCents + row.extraCents).toBeGreaterThan(row.interestCents);
    expect(before.principalCents + before.extraCents).toBeLessThanOrEqual(before.interestCents);
  });

  it("totals the interest to come", () => {
    const total = schedule.rows.reduce((sum, row) => sum + row.interestCents, 0);
    expect(summary.totalInterestCents).toBe(total);
  });
});

describe("compareWhatIf", () => {
  const principal = 32_500_000;
  const payment = paymentFor(principal, 575, 360);
  const base = amortize({ balanceCents: principal, rateBps: 575, paymentCents: payment, fromDate: "2026-01-01", termEnd: 360 });
  const plan = amortize({
    balanceCents: principal,
    rateBps: 575,
    paymentCents: payment,
    fromDate: "2026-01-01",
    termEnd: 360,
    extras: { extraMonthlyCents: 10000 },
  });

  it("reports months sooner, interest saved and the new payoff date", () => {
    const result = compareWhatIf(base, plan);
    expect(result.monthsSooner).toBeGreaterThan(0);
    expect(result.interestSavedCents).toBeGreaterThan(0);
    expect(result.payoffDate).toBe(plan.rows[plan.rows.length - 1].date);
  });
});

describe("remainingAt", () => {
  const schedule = amortize({ balanceCents: 100000, rateBps: 1200, paymentCents: 50000, fromDate: "2026-01-15" });

  it("is the starting balance before the first payment", () => {
    expect(remainingAt(schedule, "2025-12-31")).toBe(100000);
  });

  it("is the balance after the most recent payment on a date", () => {
    expect(remainingAt(schedule, "2026-01-15")).toBe(51000);
    expect(remainingAt(schedule, "2026-02-20")).toBe(1510);
  });

  it("is zero once the loan is paid off", () => {
    expect(remainingAt(schedule, "2027-01-01")).toBe(0);
  });
});
