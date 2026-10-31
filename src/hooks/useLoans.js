import { useMemo } from "react";
import { useLoans as useLoansStore } from "../contexts/LoansContext";
import { isTransfer, useTransactions } from "../contexts/TransactionsContext";
import { useRetirement } from "../contexts/RetirementContext";
import useNetWorth from "./useNetWorth";
import { amortize, paymentFor, summarize, compareWhatIf, remainingAt } from "../domain/amortization";
import { currentPeriod, todayISO } from "../utils";

/**
 * The reading of every loan, beside what the books say each one owes.
 *
 * **The eleventh cross-store hook** — it joins Loans (the terms), `useNetWorth`
 * (what the account owes, and what the collateral is worth), Transactions (the
 * payments the books recorded) and Retirement (`propertyRateBps`, the mortgage's
 * collateral-rate default). No single store could own any of this, which is why
 * it is a hook and not a provider (`.claude/LOANS.md`, `DERIVATIONS.md`).
 *
 * **Three readings of what is owed, kept apart because they disagree in normal
 * use** (`.claude/LOANS.md`):
 *   - the **books' figure** — `useNetWorth`'s value for the account — the headline;
 *   - the **contract schedule** — what the loan *should* owe if every payment was
 *     the contractual one, walked from the original principal, fixed for life;
 *   - the **projection** — the schedule walked forward from the books' figure
 *     *today*, at the current payment plus any what-if — which everything about
 *     the future reads, so paying ahead or falling behind shows up at once.
 *
 * **Recorded payments are counted, never matched to scheduled ones** — the
 * `useUpcoming` rule: guessing which transfer was "payment 37" is guessing at
 * intent, and wrong the first time someone pays twice in a month on purpose.
 */

/** A car loses about 15% of its value a year — the default collateral rate for
 *  an auto loan where none is typed. */
export const AUTO_COLLATERAL_RATE_BPS = -1500;

/** PMI drops on its own at 78% LTV; it can be *requested* at 80% (the stored
 *  `pmiRemovalLtvBps`, 80% by default). */
export const PMI_AUTO_LTV_BPS = 7800;

/** The collateral rate a loan takes when none is typed, by kind. A mortgage
 *  follows the retirement plan's house-appreciation rate so the two pages agree
 *  about the house; a car depreciates; anything else has no collateral line. */
function defaultCollateralRateBps(kind, propertyRateBps) {
  if (kind === "mortgage") return propertyRateBps ?? 350;
  if (kind === "auto") return AUTO_COLLATERAL_RATE_BPS;
  return null;
}

/** The payment in force: the typed figure if the household chose it, else the
 *  standard annuity payment derived from principal, rate and term. */
function effectivePayment(loan) {
  if (loan.paymentSource === "typed" && Number.isInteger(loan.paymentCents) && loan.paymentCents > 0) {
    return loan.paymentCents;
  }
  return paymentFor(loan.originalPrincipalCents, loan.rateBps, loan.termMonths);
}

/** Σ principal and Σ interest over rows dated at or before `date`. */
function paidThrough(rows, date) {
  let principalCents = 0;
  let interestCents = 0;
  for (const row of rows) {
    if (row.date > date) break;
    principalCents += row.principalCents + row.extraCents;
    interestCents += row.interestCents;
  }
  return { principalCents, interestCents };
}

/** The first row whose balance has fallen to `target` or below. */
function dateReaching(rows, target) {
  const row = rows.find((r) => r.balanceCents <= target);
  return row ? row.date : null;
}

function readLoan(loan, { netWorth, transactions, propertyRateBps, today }) {
  const paymentCents = effectivePayment(loan);
  const hasDay = typeof loan.firstPaymentDate === "string";

  // The contract schedule — fixed for the loan's life, walked from origination.
  const contract = hasDay
    ? amortize({
        balanceCents: loan.originalPrincipalCents,
        rateBps: loan.rateBps,
        paymentCents,
        fromDate: loan.firstPaymentDate,
        rateChanges: loan.rateChanges,
        balloonCents: loan.balloonCents,
        termEnd: loan.termMonths,
      })
    : { rows: [], neverPaysOff: false, startingBalanceCents: loan.originalPrincipalCents };

  const paymentsElapsed = contract.rows.filter((row) => row.date <= today).length;
  const nextPaymentDate = contract.rows.find((row) => row.date > today)?.date ?? null;
  const contractRemainingCents = remainingAt(contract, today);

  // The books' figure — what useNetWorth says the account owes. A liability's
  // value is signed negative, so owed is its magnitude. A deleted account leaves
  // the loan readable, owed falling back to the contract schedule.
  const nwRow = netWorth.rows.find((row) => row.account.id === loan.accountId);
  const accountRemoved = !nwRow;
  const owedCents = nwRow ? -nwRow.valueCents : contractRemainingCents;
  const owedSource = nwRow && nwRow.hand ? { kind: "statement", period: nwRow.asOf } : { kind: "derived" };

  // Signed: positive means the books owe less than the contract — paid ahead.
  const aheadCents = contractRemainingCents - owedCents;

  // The projection — walked forward from what is owed today, at the current
  // payment, and again with the what-if on top.
  const projFrom = nextPaymentDate ?? today;
  const remainingTerm = Math.max(1, loan.termMonths - paymentsElapsed);
  const walk = (extras) =>
    amortize({
      balanceCents: owedCents,
      rateBps: loan.rateBps,
      paymentCents,
      fromDate: projFrom,
      rateChanges: loan.rateChanges,
      balloonCents: loan.balloonCents,
      // A balloon has to land on the contract's last payment; an ordinary loan
      // runs until it pays off on its own.
      termEnd: loan.balloonCents ? remainingTerm : null,
      extras,
    });

  const projection = walk();
  const summary = summarize(projection.rows);

  const whatIf = loan.whatIf ?? {};
  const whatIfActive =
    (whatIf.extraMonthlyCents ?? 0) > 0 ||
    (whatIf.extraYearlyCents ?? 0) > 0 ||
    (whatIf.lumpSums?.length ?? 0) > 0 ||
    whatIf.biweekly === true;
  const whatIfProjection = whatIfActive ? walk(whatIf) : null;
  const whatIfSummary = whatIfProjection ? compareWhatIf(projection, whatIfProjection) : null;

  // Collateral — the house or the car. Current value is useNetWorth's figure for
  // the collateral account (appreciated or depreciated); the price paid
  // (`collateralValueCents`) is what PMI's LTV is measured against.
  const collateralRow = loan.collateralAccountId
    ? netWorth.rows.find((row) => row.account.id === loan.collateralAccountId)
    : null;
  const collateralCurrentCents = collateralRow
    ? collateralRow.valueCents
    : loan.collateralValueCents ?? null;
  const equityCents = collateralCurrentCents != null ? collateralCurrentCents - owedCents : null;
  const ltvBps =
    collateralCurrentCents && collateralCurrentCents > 0
      ? Math.round((owedCents / collateralCurrentCents) * 10000)
      : null;
  const collateralRateBps = loan.collateralRateBps ?? defaultCollateralRateBps(loan.kind, propertyRateBps);

  // Recorded payments: transfers into the loan account. Counted, never matched
  // to a scheduled payment.
  let recordedCount = 0;
  let recordedCents = 0;
  for (const tx of transactions) {
    if (isTransfer(tx) && tx.toAccountId === loan.accountId) {
      recordedCount += 1;
      recordedCents += tx.amountCents;
    }
  }

  // PMI — a mortgage only, and only where the house's price and a PMI figure are
  // both known. The contract schedule reaches 80% of the original value (when
  // removal can be requested) and 78% (when it drops on its own); the what-if
  // reaches each earlier.
  let pmi = null;
  if (loan.kind === "mortgage" && loan.pmiCents != null && loan.collateralValueCents) {
    const base = loan.collateralValueCents;
    const requestTarget = (loan.pmiRemovalLtvBps / 10000) * base;
    const autoTarget = (PMI_AUTO_LTV_BPS / 10000) * base;
    pmi = {
      requestDate: dateReaching(contract.rows, requestTarget),
      autoDate: dateReaching(contract.rows, autoTarget),
      whatIfRequestDate: whatIfProjection ? dateReaching(whatIfProjection.rows, requestTarget) : null,
    };
  }

  const paidSoFar = paidThrough(contract.rows, today);

  return {
    loan,
    accountRemoved,
    kind: loan.kind,
    owedCents,
    owedSource,
    paymentCents,
    paymentSource: loan.paymentSource,
    contract,
    contractRemainingCents,
    projection,
    summary,
    neverPaysOff: projection.neverPaysOff,
    whatIfActive,
    whatIfProjection,
    whatIfSummary,
    aheadCents,
    paymentsElapsed,
    nextPaymentDate,
    paidSoFar,
    interestRemainingCents: summary.totalInterestCents,
    collateralCurrentCents,
    collateralRateBps,
    equityCents,
    ltvBps,
    recorded: { count: recordedCount, totalCents: recordedCents },
    pmi,
  };
}

export default function useLoans() {
  const { loans } = useLoansStore();
  const { transactions } = useTransactions();
  const { retirementPlan } = useRetirement();
  const netWorth = useNetWorth(currentPeriod());

  return useMemo(() => {
    const today = todayISO();
    const propertyRateBps = retirementPlan?.propertyRateBps ?? null;

    const rows = loans.map((loan) =>
      readLoan(loan, { netWorth, transactions, propertyRateBps, today })
    );

    const totalOwedCents = rows.reduce((sum, row) => sum + row.owedCents, 0);
    const totalMonthlyPaymentCents = rows.reduce((sum, row) => sum + row.paymentCents, 0);

    // The debt-free date is the latest payoff across every loan — null if any
    // loan never pays off at its current payment.
    let debtFreeDate = null;
    let anyNeverPaysOff = false;
    for (const row of rows) {
      if (row.neverPaysOff) anyNeverPaysOff = true;
      const payoff = row.summary.payoffDate;
      if (payoff && (debtFreeDate == null || payoff > debtFreeDate)) debtFreeDate = payoff;
    }
    if (anyNeverPaysOff) debtFreeDate = null;

    return { rows, totalOwedCents, totalMonthlyPaymentCents, debtFreeDate, anyNeverPaysOff };
  }, [loans, netWorth, transactions, retirementPlan]);
}
