/**
 * The loan maths, pure and integer-cents throughout — like `netWorthProjection`,
 * React never sees a loop in here.
 *
 * A loan is terms *about* a liability account, never a second balance (see
 * `.claude/LOANS.md`). These functions turn those terms into a schedule of
 * payments, read *beside* what the account actually owes rather than defining
 * it: `accountBalancesAt` stays the only answer to what an account holds.
 *
 * **Interest never touches the loan account.** Every function here splits a
 * payment into interest and principal, but only principal pays the balance
 * down; interest is money that left the household, which the books record as an
 * ordinary outflow from whatever account paid it. So a row's `balanceCents`
 * falls by `principalCents + extraCents` and never by the interest.
 */

const pad = (n) => String(n).padStart(2, "0");

/**
 * Step an ISO date by whole months, keeping the day of the month and clamping
 * to the length of a shorter one — a payment due on the 31st falls on the 30th
 * in a 30-day month and the 28th in February, which is what a servicer does.
 *
 * Built field by field on the local calendar, never from `Date.parse` of the
 * string (UTC), the rule `src/utils.js` keeps for every date it touches.
 */
function addMonthsToISO(iso, n) {
  const [year, month, day] = iso.split("-").map(Number);
  const base = new Date(year, month - 1 + n, 1);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** The month (1–12) an ISO date falls in, for the once-a-year extra payment. */
function monthOfISO(iso) {
  return Number(iso.slice(5, 7));
}

/**
 * The rate in force on a date: the latest rate change dated at or before it,
 * else the loan's base rate. ISO dates compare lexicographically the same way
 * they compare chronologically, so a string `<=` is safe here where a period
 * one would not be.
 */
function rateInForce(baseRateBps, rateChanges, date) {
  let rate = baseRateBps;
  let best = "";
  for (const change of rateChanges ?? []) {
    if (!change || typeof change.fromDate !== "string") continue;
    if (change.fromDate <= date && change.fromDate >= best) {
      rate = change.rateBps;
      best = change.fromDate;
    }
  }
  return rate;
}

const round = (value) => Math.round(value);

/**
 * The standard annuity payment — principal, rate and term — rounded to the
 * cent. `principal / months` at a zero rate, since there is no interest to
 * amortise. The figure a statement rounds its own way by a cent or two, which
 * is exactly why `paymentSource` keeps the typed answer beside this derived one.
 */
export function paymentFor(principalCents, rateBps, months) {
  if (!Number.isFinite(principalCents) || principalCents <= 0) return 0;
  if (!Number.isInteger(months) || months <= 0) return 0;
  if (!rateBps) return round(principalCents / months);

  const monthlyRate = rateBps / 10000 / 12;
  const factor = (1 + monthlyRate) ** -months;
  return round((principalCents * monthlyRate) / (1 - factor));
}

/** The hard cap: a schedule that cannot pay off stops here rather than spinning. */
export const MAX_SCHEDULE_ROWS = 1200;

/**
 * Walk a balance down to zero, one payment a month.
 *
 * Returns `{ rows, neverPaysOff, startingBalanceCents }`, where each row is
 * `{ n, date, rateBps, interestCents, principalCents, extraCents, balanceCents }`.
 * Interest each month is `round(balance × rate / 12)` and the payment covers it
 * first; whatever the payment has left, plus any extra, pays the principal down.
 *
 * **The last row pays whatever is left**, so the rounded payment never leaves a
 * 361st payment of a few dollars — the trap an unguarded loop falls into on a
 * standard thirty-year loan. `termEnd` (the contract's own term in months)
 * forces that final payoff on its row, which is also where a balloon lands: a
 * payment set to leave `balloonCents` owing arrives at the last row and the
 * remainder — the balloon — is paid in one lump.
 *
 * **Capped at `MAX_SCHEDULE_ROWS` with `neverPaysOff: true`** when the payment
 * does not cover the interest, rather than growing a balance forever.
 *
 * `extras` is the what-if, and holds no money of its own — it only changes the
 * shape of this walk:
 *   { extraMonthlyCents, extraYearlyCents, extraYearlyMonth (1–12),
 *     lumpSums: [{ date, amountCents }], biweekly }
 */
export function amortize({
  balanceCents,
  rateBps,
  paymentCents,
  fromDate,
  rateChanges = [],
  balloonCents = null,
  termEnd = null,
  extras = {},
}) {
  const rows = [];
  const startingBalanceCents = Math.max(0, round(balanceCents ?? 0));
  let balance = startingBalanceCents;

  if (balance === 0) return { rows, neverPaysOff: false, startingBalanceCents };

  const extraMonthly = Math.max(0, extras.extraMonthlyCents ?? 0);
  const extraYearly = Math.max(0, extras.extraYearlyCents ?? 0);
  const extraYearlyMonth = extras.extraYearlyMonth ?? null;
  const lumpByDate = new Map();
  for (const lump of extras.lumpSums ?? []) {
    if (!lump || typeof lump.date !== "string") continue;
    lumpByDate.set(lump.date, (lumpByDate.get(lump.date) ?? 0) + Math.max(0, lump.amountCents ?? 0));
  }
  const biweekly = extras.biweekly === true;

  let neverPaysOff = false;
  let n = 0;

  while (balance > 0) {
    n += 1;
    if (n > MAX_SCHEDULE_ROWS) {
      neverPaysOff = true;
      n -= 1;
      break;
    }

    const date = addMonthsToISO(fromDate, n - 1);
    const rate = rateInForce(rateBps, rateChanges, date);
    const interestCents = round((balance * rate) / 10000 / 12);

    // What the scheduled payment leaves for principal after interest. Negative
    // means the payment does not even cover the interest — negative
    // amortisation, which only ends in the cap below.
    const scheduledPrincipal = paymentCents - interestCents;

    // Biweekly is 26 half-payments a year, i.e. one extra monthly payment a
    // year — modelled as exactly that, a whole extra payment every twelfth
    // month (`.claude/LOANS.md`).
    let extraThisMonth = extraMonthly;
    if (extraYearlyMonth && monthOfISO(date) === extraYearlyMonth) extraThisMonth += extraYearly;
    if (lumpByDate.has(date)) extraThisMonth += lumpByDate.get(date);
    if (biweekly && n % 12 === 0) extraThisMonth += paymentCents;

    const isTermEnd = termEnd != null && n >= termEnd;
    const principalCapacity = scheduledPrincipal + extraThisMonth;

    if (isTermEnd || principalCapacity >= balance) {
      // Final payoff: everything still owed is paid now, split into the
      // scheduled part and the extra so the two columns still add up.
      const principalCents = Math.max(0, Math.min(scheduledPrincipal, balance));
      const extraCents = balance - principalCents;
      balance = 0;
      rows.push({ n, date, rateBps: rate, interestCents, principalCents, extraCents, balanceCents: 0 });
      break;
    }

    if (principalCapacity <= 0) {
      // The payment does not cover the interest: record the row so the page can
      // show the balance climbing, and let the cap end it.
      balance -= principalCapacity; // adds, since the capacity is negative
      rows.push({
        n,
        date,
        rateBps: rate,
        interestCents,
        principalCents: Math.max(0, scheduledPrincipal),
        extraCents: extraThisMonth,
        balanceCents: balance,
      });
      continue;
    }

    balance -= principalCapacity;
    rows.push({
      n,
      date,
      rateBps: rate,
      interestCents,
      principalCents: scheduledPrincipal,
      extraCents: extraThisMonth,
      balanceCents: balance,
    });
  }

  // Ignore the unused balloon argument for now beyond its effect through the
  // caller's chosen payment and `termEnd`; a balloon-aware `paymentFor` is a
  // later phase (`.claude/LOANS.md`).
  void balloonCents;

  return { rows, neverPaysOff, startingBalanceCents };
}

/** Σ over the rows of a figure. */
function sumRows(rows, pick) {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * The headline reading of a schedule: how many payments are left, when it is
 * paid off, the interest still to come, and the crossover — the first payment
 * where more goes to principal than to interest, the moment a loan tips from
 * mostly-rent to mostly-yours.
 */
export function summarize(rows) {
  if (!rows || rows.length === 0) {
    return { paymentsLeft: 0, payoffDate: null, totalInterestCents: 0, crossover: null };
  }
  const crossoverRow = rows.find((row) => row.principalCents + row.extraCents > row.interestCents);
  return {
    paymentsLeft: rows.length,
    payoffDate: rows[rows.length - 1].date,
    totalInterestCents: sumRows(rows, (row) => row.interestCents),
    crossover: crossoverRow ? { n: crossoverRow.n, date: crossoverRow.date } : null,
  };
}

/**
 * A what-if against the baseline: how many months sooner it ends, how much
 * interest it saves, and the new payoff date. Both arguments are `amortize`
 * results walked from the same starting balance — one with extras, one without.
 */
export function compareWhatIf(base, plan) {
  const baseInterest = sumRows(base.rows, (row) => row.interestCents);
  const planInterest = sumRows(plan.rows, (row) => row.interestCents);
  const payoffDate = plan.rows.length ? plan.rows[plan.rows.length - 1].date : null;
  return {
    monthsSooner: base.rows.length - plan.rows.length,
    interestSavedCents: baseInterest - planInterest,
    payoffDate,
  };
}

/**
 * What the contract schedule says is owed on a date — the balance after the
 * most recent payment at or before it, the starting balance before the first.
 * Read for the "ahead / behind the contract" comparison and for the figure the
 * Net worth page offers in its monthly pass.
 */
export function remainingAt(schedule, date) {
  const rows = schedule?.rows ?? [];
  let balance = schedule?.startingBalanceCents ?? 0;
  for (const row of rows) {
    if (row.date <= date) balance = row.balanceCents;
    else break;
  }
  return balance;
}
