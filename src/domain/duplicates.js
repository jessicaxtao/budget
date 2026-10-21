import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { daysBetween, isValidISODate } from "../utils";

/**
 * How far apart two dates can be and still be the same movement of money. A
 * card purchase is often entered on the day it was made and then again off the
 * statement, which shows the day it posted — usually a day or two later.
 */
export const DUPLICATE_WINDOW_DAYS = 3;

/**
 * The entries already in the ledger that `candidate` looks like a second copy
 * of, nearest in date first.
 *
 * A match is the same direction, the same amount, through the same account (and
 * to the same account, for a transfer), within `windowDays` of each other. The
 * payee only rules a match **out**: two entries naming different payees are two
 * purchases, but one that names nobody may well be the other typed in a hurry.
 * A payee name not yet on file (`newPayee`) is a payee no logged entry can name,
 * so it rules out every entry that names one.
 * The category plays no part — filing the same receipt under a different
 * envelope the second time is exactly the mistake this is here to catch.
 *
 * An undated record is never a match. Its date is a question nobody answered,
 * and guessing one to compare against would be inventing it.
 *
 * This only ever **warns**. The same coffee bought twice in one morning is two
 * real transactions, and only the person entering them knows which this is.
 */
export function findDuplicates(candidate, transactions, { windowDays = DUPLICATE_WINDOW_DAYS } = {}) {
  const { kind, amountCents, accountId, toAccountId, date, payeeId, newPayee } = candidate;
  if (!kind || amountCents == null || amountCents <= 0 || !accountId) return [];
  if (!isValidISODate(date)) return [];

  const matches = [];
  for (const entry of transactions) {
    if (entry.kind !== kind) continue;
    if (entry.amountCents !== amountCents) continue;
    if (entry.accountId !== accountId) continue;
    if (kind === TRANSACTION_KINDS.TRANSFER && entry.toAccountId !== toAccountId) continue;
    if (entry.payeeId && (newPayee || (payeeId && entry.payeeId !== payeeId))) continue;
    const apart = isValidISODate(entry.date) ? daysBetween(entry.date, date) : null;
    if (apart == null || Math.abs(apart) > windowDays) continue;
    matches.push({ transaction: entry, days: Math.abs(apart) });
  }
  return matches.sort((a, b) => a.days - b.days).map((match) => match.transaction);
}
