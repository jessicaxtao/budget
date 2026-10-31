import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { toCents, toBps, isValidISODate } from "../utils";
import { MAX_RATE_BPS } from "./RetirementContext";

/**
 * The terms of an amortizing loan — a mortgage, a car loan, a student loan.
 *
 * **A loan is terms *about* a liability account, never a second balance**
 * (`.claude/LOANS.md`). What is owed is `useNetWorth`'s figure for the account,
 * the same one the Net worth page shows; the amortization schedule is a reading
 * *beside* it, the way a statement is. So this store holds no money and moves
 * no figure anywhere — `accountBalancesAt` stays the only definition of what an
 * account holds, and the hook `useLoans` joins the terms to that figure.
 *
 * It reads no other store, so its position in the provider order is free and
 * every reference it carries is **inert but kept**: `accountId`,
 * `collateralAccountId`, and the ids inside `rateChanges` are never validated
 * against live records and nothing cascades into them. Deleting the loan's
 * account leaves the loan readable as "account removed", its schedule intact.
 *
 * The record:
 *   { id, accountId, kind,
 *     originalPrincipalCents, rateBps, termMonths, firstPaymentDate,
 *     paymentSource, paymentCents,            // "derived" | "typed"; P&I only
 *     rateChanges: [{ id, fromDate, rateBps }],
 *     balloonCents, collateralAccountId, collateralValueCents, collateralRateBps,
 *     escrowCents, pmiCents, pmiRemovalLtvBps,
 *     whatIf }
 */
const LoansContext = React.createContext();

export function useLoans() {
  return useContext(LoansContext);
}

/** mortgage | auto | student | personal | other. */
export const LOAN_KINDS = ["mortgage", "auto", "student", "personal", "other"];
const DEFAULT_KIND = "other";

const TERM_MIN = 1;
const TERM_MAX = 600; // fifty years — long enough for any amortizing loan.

/** Request-removal LTV. 80% can be *asked* for; 78% drops on its own (handled
 *  in the hook). Stored so an unusual loan can override it. */
export const DEFAULT_PMI_REMOVAL_LTV_BPS = 8000;

/** The what-if is a guess and holds no money — it only reshapes the projection.
 *  Cleared back to this, which never touches the terms beside it. */
export const EMPTY_WHAT_IF = {
  extraMonthlyCents: 0,
  extraYearlyCents: 0,
  extraYearlyMonth: null,
  lumpSums: [],
  biweekly: false,
};

const isCents = (value) => Number.isInteger(value) && value > 0;
const isNonNegCents = (value) => Number.isInteger(value) && value >= 0;

/* ------------------------------------------------------------------ parsing */

/**
 * Validate the loan's own terms. Every figure goes through `toCents` / `toBps`,
 * which return `null` for junk — the boundary where a store refuses bad input
 * rather than writing `NaN`. **Coherence between the terms is not checked**: a
 * typed payment below the first month's interest is reported on the page ("this
 * never pays off"), not refused at the field — `RetirementContext`'s stance,
 * for its reason (refusing the field the user just typed makes a plan
 * uneditable).
 *
 * Each field is checked only when the caller names it, so `updateLoan` can
 * patch one term without being asked to restate the rest.
 */
function parseLoanTerms(fields, { requireCore }) {
  const patch = {};

  const needPrincipal = requireCore || "originalPrincipal" in fields || "originalPrincipalCents" in fields;
  if (needPrincipal) {
    const cents =
      fields.originalPrincipalCents !== undefined ? fields.originalPrincipalCents : toCents(fields.originalPrincipal);
    if (!isCents(cents)) return { ok: false, error: "Enter the original loan amount, greater than zero." };
    patch.originalPrincipalCents = cents;
  }

  const needRate = requireCore || "rate" in fields || "rateBps" in fields;
  if (needRate) {
    const bps = fields.rateBps !== undefined ? fields.rateBps : toBps(fields.rate);
    if (bps == null || !Number.isInteger(bps) || bps < 0 || bps > MAX_RATE_BPS) {
      return { ok: false, error: `Enter the interest rate as a percentage between 0 and ${MAX_RATE_BPS / 100}.` };
    }
    patch.rateBps = bps;
  }

  const needTerm = requireCore || "termMonths" in fields;
  if (needTerm) {
    const months = Number(fields.termMonths);
    if (!Number.isInteger(months) || months < TERM_MIN || months > TERM_MAX) {
      return { ok: false, error: `Enter the term as a whole number of months between ${TERM_MIN} and ${TERM_MAX}.` };
    }
    patch.termMonths = months;
  }

  const needFirst = requireCore || "firstPaymentDate" in fields;
  if (needFirst) {
    if (!isValidISODate(fields.firstPaymentDate)) {
      return { ok: false, error: "Enter the date of the first payment." };
    }
    patch.firstPaymentDate = fields.firstPaymentDate;
  }

  if (requireCore || "kind" in fields) {
    patch.kind = LOAN_KINDS.includes(fields.kind) ? fields.kind : DEFAULT_KIND;
  }

  // Payment: both answers kept. A typed figure is stored whichever source is in
  // force; `paymentSource` says which one the page reads. Switching clears
  // neither — the derived one is computed, never stored, so there is nothing to
  // clear there.
  if ("paymentSource" in fields) {
    patch.paymentSource = fields.paymentSource === "typed" ? "typed" : "derived";
  }
  if ("paymentCents" in fields || "payment" in fields) {
    const raw = fields.paymentCents !== undefined ? fields.paymentCents : fields.payment;
    if (raw === "" || raw == null) patch.paymentCents = null;
    else {
      const cents = fields.paymentCents !== undefined ? fields.paymentCents : toCents(fields.payment);
      if (!isCents(cents)) return { ok: false, error: "Enter the monthly payment, or leave it to be calculated." };
      patch.paymentCents = cents;
    }
  }

  // Balloon: a lump owed on the last payment, or none. Blank removes it.
  if ("balloonCents" in fields || "balloon" in fields) {
    const raw = fields.balloonCents !== undefined ? fields.balloonCents : fields.balloon;
    if (raw === "" || raw == null) patch.balloonCents = null;
    else {
      const cents = fields.balloonCents !== undefined ? fields.balloonCents : toCents(fields.balloon);
      if (!isCents(cents)) return { ok: false, error: "Enter the balloon payment, or leave it blank." };
      patch.balloonCents = cents;
    }
  }

  // Collateral — the house, the car. All inert but kept.
  if ("collateralAccountId" in fields) {
    patch.collateralAccountId =
      typeof fields.collateralAccountId === "string" && fields.collateralAccountId ? fields.collateralAccountId : null;
  }
  if ("collateralValueCents" in fields || "collateralValue" in fields) {
    const raw = fields.collateralValueCents !== undefined ? fields.collateralValueCents : fields.collateralValue;
    if (raw === "" || raw == null) patch.collateralValueCents = null;
    else {
      const cents = fields.collateralValueCents !== undefined ? fields.collateralValueCents : toCents(fields.collateralValue);
      if (!isCents(cents)) return { ok: false, error: "Enter what the collateral is worth, or leave it blank." };
      patch.collateralValueCents = cents;
    }
  }
  // A signed yearly change: +3.5% a house, −15% a car. Null takes a default by
  // kind, resolved in the hook.
  if ("collateralRateBps" in fields || "collateralRate" in fields) {
    const raw = fields.collateralRateBps !== undefined ? fields.collateralRateBps : fields.collateralRate;
    if (raw === "" || raw == null) patch.collateralRateBps = null;
    else {
      const bps = fields.collateralRateBps !== undefined ? fields.collateralRateBps : toBps(fields.collateralRate);
      if (bps == null || !Number.isInteger(bps) || bps < -MAX_RATE_BPS || bps > MAX_RATE_BPS) {
        return { ok: false, error: "Enter how fast the collateral gains or loses value, as a percentage a year." };
      }
      patch.collateralRateBps = bps;
    }
  }

  // Mortgage escrow and PMI — not principal or interest, and never in the
  // amortization. Blank removes the field; 0 is a real answer ("no PMI").
  for (const [key, dollarKey, field] of [
    ["escrowCents", "escrow", "escrow"],
    ["pmiCents", "pmi", "PMI"],
  ]) {
    if (key in fields || dollarKey in fields) {
      const raw = fields[key] !== undefined ? fields[key] : fields[dollarKey];
      if (raw === "" || raw == null) patch[key] = null;
      else {
        const cents = fields[key] !== undefined ? fields[key] : toCents(fields[dollarKey]);
        if (!isNonNegCents(cents)) return { ok: false, error: `Enter the monthly ${field}, or leave it blank.` };
        patch[key] = cents;
      }
    }
  }

  if ("pmiRemovalLtvBps" in fields || "pmiRemovalLtv" in fields) {
    const raw = fields.pmiRemovalLtvBps !== undefined ? fields.pmiRemovalLtvBps : fields.pmiRemovalLtv;
    if (raw === "" || raw == null) patch.pmiRemovalLtvBps = DEFAULT_PMI_REMOVAL_LTV_BPS;
    else {
      const bps = fields.pmiRemovalLtvBps !== undefined ? fields.pmiRemovalLtvBps : toBps(fields.pmiRemovalLtv);
      if (bps == null || !Number.isInteger(bps) || bps <= 0 || bps > 10000) {
        return { ok: false, error: "Enter the PMI-removal loan-to-value as a percentage." };
      }
      patch.pmiRemovalLtvBps = bps;
    }
  }

  if ("rateChanges" in fields) {
    const changes = parseRateChanges(fields.rateChanges, patch.firstPaymentDate ?? fields.firstPaymentDate);
    if (!changes.ok) return changes;
    patch.rateChanges = changes.rateChanges;
  }

  return { ok: true, patch };
}

/** Rate changes must be dated after the first payment; order and ids are the
 *  store's to keep. */
function parseRateChanges(value, firstPaymentDate) {
  if (!Array.isArray(value)) return { ok: true, rateChanges: [] };
  const rateChanges = [];
  for (const change of value) {
    if (!change) continue;
    if (!isValidISODate(change.fromDate)) {
      return { ok: false, error: "Enter a valid date for each rate change." };
    }
    if (isValidISODate(firstPaymentDate) && change.fromDate <= firstPaymentDate) {
      return { ok: false, error: "A rate change must be dated after the first payment." };
    }
    const bps = change.rateBps !== undefined ? change.rateBps : toBps(change.rate);
    if (bps == null || !Number.isInteger(bps) || bps < 0 || bps > MAX_RATE_BPS) {
      return { ok: false, error: "Enter each rate change as a percentage." };
    }
    rateChanges.push({ id: change.id ?? uuidV4(), fromDate: change.fromDate, rateBps: bps });
  }
  return { ok: true, rateChanges };
}

/** The what-if, each field only when named. Holds no money — figures that fail
 *  to parse are refused so a junk value never silently reshapes the chart. */
function parseWhatIf(patch) {
  const out = {};
  if ("extraMonthlyCents" in patch || "extraMonthly" in patch) {
    const raw = patch.extraMonthlyCents !== undefined ? patch.extraMonthlyCents : patch.extraMonthly;
    if (raw === "" || raw == null) out.extraMonthlyCents = 0;
    else {
      const cents = patch.extraMonthlyCents !== undefined ? patch.extraMonthlyCents : toCents(patch.extraMonthly);
      if (!isNonNegCents(cents)) return { ok: false, error: "Enter the extra monthly payment, or leave it blank." };
      out.extraMonthlyCents = cents;
    }
  }
  if ("extraYearlyCents" in patch || "extraYearly" in patch) {
    const raw = patch.extraYearlyCents !== undefined ? patch.extraYearlyCents : patch.extraYearly;
    if (raw === "" || raw == null) out.extraYearlyCents = 0;
    else {
      const cents = patch.extraYearlyCents !== undefined ? patch.extraYearlyCents : toCents(patch.extraYearly);
      if (!isNonNegCents(cents)) return { ok: false, error: "Enter the extra yearly payment, or leave it blank." };
      out.extraYearlyCents = cents;
    }
  }
  if ("extraYearlyMonth" in patch) {
    const month = patch.extraYearlyMonth;
    if (month === "" || month == null) out.extraYearlyMonth = null;
    else {
      const m = Number(month);
      if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, error: "Pick the month the extra payment lands." };
      out.extraYearlyMonth = m;
    }
  }
  if ("biweekly" in patch) out.biweekly = patch.biweekly === true;
  if ("lumpSums" in patch) {
    const lumpSums = [];
    for (const lump of patch.lumpSums ?? []) {
      if (!lump) continue;
      if (!isValidISODate(lump.date)) return { ok: false, error: "Enter a valid date for each lump sum." };
      const cents = lump.amountCents !== undefined ? lump.amountCents : toCents(lump.amount);
      if (!isCents(cents)) return { ok: false, error: "Enter each lump sum as an amount greater than zero." };
      lumpSums.push({ id: lump.id ?? uuidV4(), date: lump.date, amountCents: cents });
    }
    out.lumpSums = lumpSums;
  }
  return { ok: true, patch: out };
}

/* ---------------------------------------------------------------- migration */

function migrateLoans(stored) {
  const loans = Array.isArray(stored) ? stored : [];
  return loans
    .filter((loan) => loan && isCents(loan.originalPrincipalCents) && Number.isInteger(loan.termMonths))
    .map((loan) => ({
      id: loan.id ?? uuidV4(),
      accountId: typeof loan.accountId === "string" ? loan.accountId : null,
      kind: LOAN_KINDS.includes(loan.kind) ? loan.kind : DEFAULT_KIND,
      originalPrincipalCents: loan.originalPrincipalCents,
      rateBps: Number.isInteger(loan.rateBps) ? loan.rateBps : 0,
      termMonths: loan.termMonths,
      firstPaymentDate: isValidISODate(loan.firstPaymentDate) ? loan.firstPaymentDate : null,
      paymentSource: loan.paymentSource === "typed" ? "typed" : "derived",
      paymentCents: isCents(loan.paymentCents) ? loan.paymentCents : null,
      rateChanges: Array.isArray(loan.rateChanges)
        ? loan.rateChanges
            .filter((c) => c && isValidISODate(c.fromDate) && Number.isInteger(c.rateBps))
            .map((c) => ({ id: c.id ?? uuidV4(), fromDate: c.fromDate, rateBps: c.rateBps }))
        : [],
      balloonCents: isCents(loan.balloonCents) ? loan.balloonCents : null,
      collateralAccountId: typeof loan.collateralAccountId === "string" ? loan.collateralAccountId : null,
      collateralValueCents: isCents(loan.collateralValueCents) ? loan.collateralValueCents : null,
      collateralRateBps: Number.isInteger(loan.collateralRateBps) ? loan.collateralRateBps : null,
      escrowCents: isNonNegCents(loan.escrowCents) ? loan.escrowCents : null,
      pmiCents: isNonNegCents(loan.pmiCents) ? loan.pmiCents : null,
      pmiRemovalLtvBps: Number.isInteger(loan.pmiRemovalLtvBps) ? loan.pmiRemovalLtvBps : DEFAULT_PMI_REMOVAL_LTV_BPS,
      whatIf: migrateWhatIf(loan.whatIf),
    }));
}

function migrateWhatIf(stored) {
  if (!stored || typeof stored !== "object") return { ...EMPTY_WHAT_IF };
  return {
    extraMonthlyCents: isNonNegCents(stored.extraMonthlyCents) ? stored.extraMonthlyCents : 0,
    extraYearlyCents: isNonNegCents(stored.extraYearlyCents) ? stored.extraYearlyCents : 0,
    extraYearlyMonth:
      Number.isInteger(stored.extraYearlyMonth) && stored.extraYearlyMonth >= 1 && stored.extraYearlyMonth <= 12
        ? stored.extraYearlyMonth
        : null,
    biweekly: stored.biweekly === true,
    lumpSums: Array.isArray(stored.lumpSums)
      ? stored.lumpSums
          .filter((l) => l && isValidISODate(l.date) && isCents(l.amountCents))
          .map((l) => ({ id: l.id ?? uuidV4(), date: l.date, amountCents: l.amountCents }))
      : [],
  };
}

/* ---------------------------------------------------------------- provider */

export const LoansProvider = ({ children }) => {
  const [loans, setLoans] = useSyncedState("loans", [], migrateLoans);

  /**
   * Add a loan against a liability account.
   *
   * **Whether the account is a liability is the modal's check, not this
   * store's** — this store reads no other, so it cannot see an account's scope,
   * the same seam `DonationsContext` and the transfer matrix live with. What it
   * *can* enforce is one loan per account, which is its own list.
   */
  const addLoan = useCallback(
    ({ accountId, whatIf, ...fields }) => {
      if (typeof accountId !== "string" || !accountId) {
        return { ok: false, error: "A loan needs an account." };
      }
      const parsed = parseLoanTerms(fields, { requireCore: true });
      if (!parsed.ok) return parsed;
      const wi = parseWhatIf(whatIf ?? {});
      if (!wi.ok) return wi;

      const id = uuidV4();
      setLoans((previous) => [
        ...previous,
        {
          id,
          accountId,
          kind: DEFAULT_KIND,
          paymentSource: "derived",
          paymentCents: null,
          rateChanges: [],
          balloonCents: null,
          collateralAccountId: null,
          collateralValueCents: null,
          collateralRateBps: null,
          escrowCents: null,
          pmiCents: null,
          pmiRemovalLtvBps: DEFAULT_PMI_REMOVAL_LTV_BPS,
          whatIf: { ...EMPTY_WHAT_IF, ...wi.patch },
          ...parsed.patch,
        },
      ]);
      return { ok: true, id };
    },
    [setLoans]
  );

  /** Patch a loan's terms. Only the named fields are checked and written. */
  const updateLoan = useCallback(
    ({ id, whatIf, ...fields }) => {
      const existing = loans.find((loan) => loan.id === id);
      if (!existing) return { ok: false, error: "That loan no longer exists." };

      const parsed = parseLoanTerms(fields, { requireCore: false });
      if (!parsed.ok) return parsed;

      let whatIfPatch = null;
      if (whatIf !== undefined) {
        const wi = parseWhatIf(whatIf);
        if (!wi.ok) return wi;
        whatIfPatch = wi.patch;
      }

      setLoans((previous) =>
        previous.map((loan) =>
          loan.id === id
            ? {
                ...loan,
                ...parsed.patch,
                ...(whatIfPatch ? { whatIf: { ...loan.whatIf, ...whatIfPatch } } : {}),
              }
            : loan
        )
      );
      return { ok: true };
    },
    [loans, setLoans]
  );

  /**
   * Set (or merge) the what-if. A guess that holds no money — clearing it never
   * touches the terms beside it. Pass `EMPTY_WHAT_IF` to clear.
   */
  const setLoanWhatIf = useCallback(
    ({ id, ...patch }) => {
      const existing = loans.find((loan) => loan.id === id);
      if (!existing) return { ok: false, error: "That loan no longer exists." };
      const wi = parseWhatIf(patch);
      if (!wi.ok) return wi;
      setLoans((previous) =>
        previous.map((loan) => (loan.id === id ? { ...loan, whatIf: { ...loan.whatIf, ...wi.patch } } : loan))
      );
      return { ok: true };
    },
    [loans, setLoans]
  );

  /** A loan holds no money and nothing references its id, so a delete is never
   *  refused. */
  const deleteLoan = useCallback(
    ({ id }) => {
      setLoans((previous) => previous.filter((loan) => loan.id !== id));
      return { ok: true };
    },
    [setLoans]
  );

  const value = useMemo(
    () => ({ loans, addLoan, updateLoan, setLoanWhatIf, deleteLoan }),
    [loans, addLoan, updateLoan, setLoanWhatIf, deleteLoan]
  );

  return <LoansContext.Provider value={value}>{children}</LoansContext.Provider>;
};
