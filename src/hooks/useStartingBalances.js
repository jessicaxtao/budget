import { useMemo } from "react";
import { isOffBudget, useAccounts } from "../contexts/AccountsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useEnvelopes from "./useEnvelopes";
import { addMonths, currentPeriod, toPeriod } from "../utils";

/**
 * The onboarding door into envelope funding: a lump sum of opening balances,
 * filed to a period before any real activity so it carries in as money
 * already assigned rather than reading as this month's income.
 *
 * `period` sits one month before the earliest dated transaction on the books
 * — or last month, on a ledger with none yet — so it never collides with a
 * real month's own assignments and always falls behind `currentPeriod()` in
 * every downstream sum.
 *
 * `poolCentsOverride` is the whole point: `useEnvelopes` only folds an
 * account's opening balance into a period at or after that account's own
 * `openingDate`, which `AddAccountModal` defaults to **today** — so the
 * ordinary `toBeAssignedCents` at a backdated period would read as zero for
 * every account just added, defeating the backdating before it started. This
 * money was not new today, it was there before the books opened, which is
 * what an *undated* opening balance already means to `useEnvelopes` — so the
 * override swaps the real, gated `openingCents` for the unconditional total
 * of every on-budget account's opening balance, leaving the pool's other two
 * terms (income received, and whatever this flow has already placed) exactly
 * as `useEnvelopes` computed them.
 */
export default function useStartingBalances() {
  const { accounts } = useAccounts();
  const { transactions } = useTransactions();

  const period = useMemo(() => {
    const dated = transactions.map((t) => toPeriod(t.date)).filter(Boolean);
    const earliest = dated.length ? dated.reduce((min, p) => (p < min ? p : min)) : currentPeriod();
    return addMonths(earliest, -1);
  }, [transactions]);

  const { toBeAssignedCents, openingCents } = useEnvelopes(period);

  const totalOpeningCents = useMemo(
    () =>
      accounts.reduce(
        (sum, account) => (isOffBudget(account) ? sum : sum + (account.openingBalanceCents ?? 0)),
        0
      ),
    [accounts]
  );

  return { period, poolCentsOverride: toBeAssignedCents - openingCents + totalOpeningCents };
}
