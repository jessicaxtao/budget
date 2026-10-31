import { renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import useLoans from "./useLoans";
import { currentPeriod } from "../utils";

/**
 * Driven through the real providers with JSON in storage, like every cross-store
 * hook here — the migration and the provider order are part of what is tested.
 *
 * The three readings of what is owed are the point: owed is `useNetWorth`'s
 * figure, never the contract schedule's; a statement ahead of the schedule
 * reads as ahead; and a loan whose account was deleted stays readable.
 */
const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;
const PERIOD = currentPeriod();

const MORTGAGE_ACCOUNT = {
  id: "acc-mortgage",
  name: "Mortgage",
  type: "liability",
  scope: "off-budget",
  assetClass: "Other",
  openingBalanceCents: -30_000_000, // $300,000 owed
  openingDate: null,
  reconciledOn: null,
};

const HOUSE_ACCOUNT = {
  id: "acc-house",
  name: "Home",
  type: "asset",
  scope: "off-budget",
  assetClass: "Real estate",
  openingBalanceCents: 48_000_000,
  openingDate: null,
  reconciledOn: null,
};

const LOAN = {
  id: "loan-1",
  accountId: "acc-mortgage",
  kind: "mortgage",
  originalPrincipalCents: 32_500_000,
  rateBps: 575,
  termMonths: 360,
  firstPaymentDate: "2020-01-01",
  paymentSource: "derived",
  paymentCents: null,
  rateChanges: [],
  balloonCents: null,
  collateralAccountId: "acc-house",
  collateralValueCents: 40_000_000,
  collateralRateBps: null,
  escrowCents: 45000,
  pmiCents: null,
  pmiRemovalLtvBps: 8000,
  whatIf: { extraMonthlyCents: 0, extraYearlyCents: 0, extraYearlyMonth: null, lumpSums: [], biweekly: false },
};

function seed(data) {
  localStorage.clear();
  const file = { accounts: [MORTGAGE_ACCOUNT, HOUSE_ACCOUNT], transactions: [], loans: [LOAN], ...data };
  for (const [key, value] of Object.entries(file)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

const read = () => renderHook(() => useLoans(), { wrapper }).result.current;

describe("what is owed", () => {
  test("is the books' figure, not the contract schedule's", () => {
    seed();
    const { rows } = read();
    const row = rows[0];

    // The books owe exactly the opening balance; the contract schedule, walked
    // from $325,000 since 2020, owes something else entirely.
    expect(row.owedCents).toBe(30_000_000);
    expect(row.contractRemainingCents).not.toBe(30_000_000);
    expect(row.owedSource.kind).toBe("derived");
  });

  test("reads a statement as ahead of the contract when it is", () => {
    seed({
      accountBalances: [
        { id: "bal-1", accountId: "acc-mortgage", period: PERIOD, amountCents: -29_000_000 },
      ],
    });
    const { rows } = read();
    const row = rows[0];

    expect(row.owedCents).toBe(29_000_000);
    expect(row.owedSource).toEqual({ kind: "statement", period: PERIOD });
    // Owing less than the contract says is being ahead of schedule.
    expect(row.aheadCents).toBeGreaterThan(0);
    expect(row.contractRemainingCents).toBeGreaterThan(row.owedCents);
  });
});

describe("the schedule and the summary", () => {
  test("the contract schedule runs the full term and the projection pays off", () => {
    seed();
    const { rows, debtFreeDate } = read();
    const row = rows[0];

    expect(row.contract.rows).toHaveLength(360);
    expect(row.neverPaysOff).toBe(false);
    expect(row.summary.payoffDate).toBe(debtFreeDate);
    // A payment number out of the term, from the calendar.
    expect(row.paymentsElapsed).toBeGreaterThan(0);
    expect(row.paymentsElapsed).toBeLessThan(360);
  });

  test("a what-if ends the loan sooner and saves interest", () => {
    seed({ loans: [{ ...LOAN, whatIf: { ...LOAN.whatIf, extraMonthlyCents: 50000 } }] });
    const { rows } = read();
    const row = rows[0];

    expect(row.whatIfActive).toBe(true);
    expect(row.whatIfSummary.monthsSooner).toBeGreaterThan(0);
    expect(row.whatIfSummary.interestSavedCents).toBeGreaterThan(0);
  });
});

describe("equity and recorded payments", () => {
  test("equity is the collateral's value less what is owed", () => {
    seed();
    const row = read().rows[0];
    expect(row.collateralCurrentCents).toBe(48_000_000);
    expect(row.equityCents).toBe(48_000_000 - 30_000_000);
    expect(row.ltvBps).toBe(Math.round((30_000_000 / 48_000_000) * 10000));
  });

  test("counts transfers into the loan account, never matching them to the schedule", () => {
    seed({
      transactions: [
        { id: "t1", kind: "transfer", accountId: "acc-cash", toAccountId: "acc-mortgage", amountCents: 100000, date: "2026-01-15", budgetId: null, splits: null },
        { id: "t2", kind: "transfer", accountId: "acc-cash", toAccountId: "acc-mortgage", amountCents: 100000, date: "2026-02-15", budgetId: null, splits: null },
      ],
    });
    const row = read().rows[0];
    expect(row.recorded).toEqual({ count: 2, totalCents: 200000 });
  });
});

describe("a deleted account", () => {
  test("leaves the loan readable, its schedule intact, owed from the contract", () => {
    seed({ accounts: [HOUSE_ACCOUNT], loans: [{ ...LOAN, accountId: "gone" }] });
    const row = read().rows[0];

    expect(row.accountRemoved).toBe(true);
    expect(row.contract.rows).toHaveLength(360);
    // With no account to read, owed falls back to the contract schedule.
    expect(row.owedCents).toBe(row.contractRemainingCents);
  });
});
