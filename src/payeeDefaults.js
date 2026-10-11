import { apportion } from "./utils";

/**
 * A payee's remembered division of a receipt — "Costco is 70% groceries, 30%
 * household" — and the arithmetic that turns it into parts of a real total. Pure,
 * like `cashback.js`, because the rule it has to keep is the ledger's sum rule
 * and React would only be in the way of asserting it.
 *
 * **Stored as shares, never as amounts.** `defaultSplit` is null or a list of two
 * or more `{ budgetId, shareBps }`, the shares positive whole basis points adding
 * up to exactly `SHARES_WHOLE`. A remembered *amount* would be the one receipt it
 * was learned from, and next week's Costco run is a different total; a share is
 * what carries over. Turning the shares back into cents goes through `apportion`,
 * so the parts add up to whatever total is typed **exactly** — the rule a split
 * rests on (see `TransactionsContext`), kept by construction rather than checked
 * after the fact.
 */

/** 100%, in basis points. */
export const SHARES_WHOLE = 10000;

/**
 * What is wrong with a stored division, in a sentence, or null. The store's
 * check — a form never builds one by hand, it learns one off a receipt that
 * already checked out.
 */
export function describeDefaultSplitProblem(split) {
  if (split == null) return null;
  if (!Array.isArray(split) || split.length < 2) {
    return "A remembered split needs two parts or more.";
  }
  for (const part of split) {
    if (!part || typeof part.budgetId !== "string" || !part.budgetId) {
      return "Every part of a remembered split names a category.";
    }
    if (!Number.isInteger(part.shareBps) || part.shareBps <= 0) {
      return "Every part of a remembered split is a share of more than nothing.";
    }
  }
  const total = split.reduce((sum, part) => sum + part.shareBps, 0);
  if (total !== SHARES_WHOLE) return "The parts of a remembered split add up to the whole.";
  return null;
}

/**
 * A receipt's division as shares, to be remembered — or null where it cannot be
 * one: fewer than two parts, or a part so small next to the rest that it rounds
 * to no share at all (a cent of a thousand dollars). Dropping that part and
 * remembering the others would be remembering a division nobody made.
 */
export function sharesFromSplits(splits) {
  const parts = (splits ?? []).filter((part) => part.amountCents > 0);
  if (parts.length < 2) return null;
  const shares = apportion(
    parts.map((part) => part.amountCents),
    SHARES_WHOLE
  );
  if (shares.some((share) => share <= 0)) return null;
  return parts.map((part, index) => ({ budgetId: part.budgetId, shareBps: shares[index] }));
}

/**
 * The parts of a remembered division whose category still exists. A category
 * deleted since is inert rather than cascaded into (see `PayeesContext`), so it
 * is dropped here, where the live list is in hand — and the remaining shares
 * still divide the whole receipt between them, since `partsForTotal` apportions
 * by proportion rather than by the stored figure.
 */
export function liveShares(split, budgetIds) {
  const live = new Set(budgetIds);
  return (split ?? []).filter((part) => live.has(part.budgetId));
}

/**
 * The shares as cents of `totalCents`, one per share, adding up to it exactly;
 * nulls where there is no total yet, since the payee is usually named before
 * the amount is typed.
 */
export function partsForTotal(shares, totalCents) {
  if (totalCents == null || totalCents < 0) return shares.map(() => null);
  return apportion(
    shares.map((share) => share.shareBps),
    totalCents
  );
}

/** Whether two divisions are the same one, part for part and in order. */
export function sameShares(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return (
    a.length === b.length &&
    a.every((part, index) => part.budgetId === b[index].budgetId && part.shareBps === b[index].shareBps)
  );
}

/** "Groceries 70% · Household 30%", for a payee's option line and its row. */
export function describeShares(shares, nameOf) {
  return shares
    .map((part) => `${nameOf(part.budgetId) ?? "Unknown category"} ${formatShare(part.shareBps)}`)
    .join(" · ");
}

/** A share as a percentage, with a decimal only where the share has one. */
function formatShare(bps) {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}
