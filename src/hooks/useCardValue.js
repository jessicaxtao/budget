import { useMemo } from "react";
import { ACCOUNT_SCOPES, useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { useRewards } from "../contexts/RewardsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useCardOffers from "./useCardOffers";
import {
  OFFER_KINDS,
  OFFER_STATUS,
  cardEarnings,
  earnBps,
  feeYearWindow,
  offerOverlaps,
  programById,
  rankCardsFor,
} from "../domain/rewards";

/**
 * **A household does not hold one card, and the cards it holds are not the same
 * kind of thing.** One pays cash back, one pays points in a program, one costs
 * $550 a year and gives $300 of it back in credits. This hook is the one place
 * those are put in the same unit, so the two questions a wallet of cards
 * actually raises can be answered:
 *
 *   1. **Which card to reach for** for a given kind of spending — `choices`,
 *      every card that claims a rate on it, ranked by what it returns.
 *   2. **Whether a card is worth keeping** — one row per card: the fee, the
 *      credits used against it, the rewards its spending earned, and the net.
 *
 * The join is unavoidably cross-store, and this is where it belongs rather than
 * in any provider: the rewards store knows what a card promises, the ledger
 * knows what was actually bought, the accounts store knows which cards exist
 * and the budgets and payees stores name what the rates are mapped to.
 * **Nothing flows back** — a rate moves no envelope, writes no row and refiles
 * nothing, the `useCardOffers` rule, and a card's earnings are not an account
 * balance.
 *
 * **Every figure is an estimate, and the honest kind.** The issuer pays by
 * merchant code, which the books do not have; what they have is the category
 * the household filed each purchase under. So this is what the rates the
 * household typed come to on the spending the household recorded, and the page
 * says exactly that.
 *
 * **Two kinds of cash back that must not be added together.** A card may carry
 * `cashbackBps` on its *account*, which is cash back paid straight onto the
 * card's balance; that money is already in the books as a refund row beside
 * each purchase (`src/cashback.js`), and counting it here as well would promise
 * it twice. It is reported as `postedBps` and nothing else, so the page can say
 * where that rate's money already is instead of this hook quietly double
 * counting it.
 *
 * The window is **the fee year** (`feeYearWindow`), because the fee is what the
 * earnings and credits are being weighed against. Credits are read off
 * `useCardOffers`' rows rather than recomputed, so the figure on the card's row
 * and the figure on the offer's bar are the same figure.
 */
export default function useCardValue(today) {
  const { cards, earnRates, valuations } = useRewards();
  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payees } = usePayees();
  const offerRows = useCardOffers(today);

  return useMemo(() => {
    const budgetName = new Map(budgets.map((budget) => [budget.id, budget.name]));
    const payeeName = new Map(payees.map((payee) => [payee.id, payee.name]));
    const byId = new Map(accounts.map((account) => [account.id, account]));

    const ratesByAccount = new Map();
    for (const rate of earnRates) {
      if (!byId.has(rate.accountId)) continue;
      const list = ratesByAccount.get(rate.accountId) ?? [];
      list.push(rate);
      ratesByAccount.set(rate.accountId, list);
    }
    const feeByAccount = new Map(cards.map((card) => [card.accountId, card]));

    // Every credit card, plus any other account the household has said
    // something about — a debit card can earn too. An account that has gone
    // leaves its rate inert, the store's rule, so it is simply not a row.
    const subjects = accounts.filter(
      (account) =>
        account.scope === ACCOUNT_SCOPES.CREDIT_CARD ||
        ratesByAccount.has(account.id) ||
        feeByAccount.has(account.id)
    );

    /** A rate with everything it names resolved live, so a rename follows. */
    const describeRate = (rate) => {
      const categories = rate.budgetIds.filter((id) => budgetName.has(id)).map((id) => budgetName.get(id));
      const named = rate.payeeIds.filter((id) => payeeName.has(id)).map((id) => payeeName.get(id));
      return {
        rate,
        bps: earnBps(rate, valuations),
        program: rate.programId ? programById(rate.programId) : null,
        categories,
        payees: named,
        missing: rate.allSpending
          ? 0
          : rate.budgetIds.filter((id) => !budgetName.has(id)).length +
            rate.payeeIds.filter((id) => !payeeName.has(id)).length,
      };
    };

    const rows = subjects.map((account) => {
      const rates = ratesByAccount.get(account.id) ?? [];
      const stored = feeByAccount.get(account.id) ?? null;
      const annualFeeCents = stored?.annualFeeCents ?? null;
      const feeYear = feeYearWindow(stored?.renewsOn ?? null, today);
      const earnings = cardEarnings({
        accountId: account.id,
        rates,
        transactions,
        from: feeYear.from,
        through: feeYear.through,
        valuations,
      });

      const creditRows = offerRows.filter(
        (row) =>
          row.offer.kind === OFFER_KINDS.CREDIT &&
          row.offer.accountId === account.id &&
          offerOverlaps(row.offer, feeYear)
      );
      const credits = {
        rows: creditRows,
        worthCents: creditRows.reduce((sum, row) => sum + row.offer.limitCents, 0),
        usedCents: creditRows.reduce((sum, row) => sum + (row.earnedCents ?? 0), 0),
        // Still there to use, against still there and now out of reach: the
        // second is money the fee already paid for and nobody got back.
        leftCents: creditRows
          .filter((row) => row.status === OFFER_STATUS.ACTIVE || row.status === OFFER_STATUS.UPCOMING)
          .reduce((sum, row) => sum + row.remainingCents, 0),
        expiredCents: creditRows
          .filter((row) => row.status === OFFER_STATUS.ENDED)
          .reduce((sum, row) => sum + row.remainingCents, 0),
      };

      return {
        account,
        accountId: account.id,
        cardName: account.name,
        annualFeeCents,
        renewsOn: stored?.renewsOn ?? null,
        feeYear,
        rates: rates.map(describeRate).sort((a, b) => b.bps - a.bps),
        earnings,
        credits,
        /** Cash back the books already carry — never added to `earnings`. */
        postedBps: account.cashbackBps ?? null,
        netCents: earnings.valueCents + credits.usedCents - (annualFeeCents ?? 0),
      };
    });

    // The card with a fee not yet earned back leads: it is the only row on the
    // page there is a decision to make about. Free cards follow, best first.
    rows.sort((a, b) => {
      const paid = (row) => (row.annualFeeCents ?? 0) > 0;
      if (paid(a) !== paid(b)) return paid(a) ? -1 : 1;
      if (paid(a)) return a.netCents - b.netCents;
      return b.earnings.valueCents - a.earnings.valueCents;
    });

    // Which card to reach for, one row per kind of spending any card claims a
    // rate on. "Everything else" is last because it is the fallback, and it is
    // the row a household with one base rate per card reads most.
    const withRates = rows.filter((row) => row.rates.length > 0);
    const targets = [];
    const seen = new Set();
    let anyAllSpending = false;
    for (const row of withRates) {
      for (const { rate } of row.rates) {
        if (rate.allSpending) anyAllSpending = true;
        for (const id of rate.budgetIds) {
          if (!budgetName.has(id) || seen.has(`b:${id}`)) continue;
          seen.add(`b:${id}`);
          targets.push({ key: `b:${id}`, label: budgetName.get(id), kind: "category", budgetId: id });
        }
        for (const id of rate.payeeIds) {
          if (!payeeName.has(id) || seen.has(`p:${id}`)) continue;
          seen.add(`p:${id}`);
          targets.push({ key: `p:${id}`, label: payeeName.get(id), kind: "payee", payeeId: id });
        }
      }
    }
    targets.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    if (anyAllSpending) {
      targets.push({ key: "all", label: "Everything else", kind: "all" });
    }

    const candidates = withRates.map((row) => ({
      accountId: row.accountId,
      rates: row.rates.map((described) => described.rate),
    }));
    const choices = targets
      .map((target) => {
        const ranked = rankCardsFor(candidates, target, valuations).map((entry) => ({
          ...entry,
          cardName: byId.get(entry.accountId)?.name ?? null,
          program: entry.rate.programId ? programById(entry.rate.programId) : null,
        }));
        return { ...target, ranked };
      })
      .filter((row) => row.ranked.length > 0);

    const totals = rows.reduce(
      (sum, row) => ({
        annualFeeCents: sum.annualFeeCents + (row.annualFeeCents ?? 0),
        creditsUsedCents: sum.creditsUsedCents + row.credits.usedCents,
        creditsLeftCents: sum.creditsLeftCents + row.credits.leftCents,
        creditsExpiredCents: sum.creditsExpiredCents + row.credits.expiredCents,
        earnedValueCents: sum.earnedValueCents + row.earnings.valueCents,
        earnedCashCents: sum.earnedCashCents + row.earnings.cashCents,
        earnedPointsValueCents: sum.earnedPointsValueCents + row.earnings.pointsValueCents,
        netCents: sum.netCents + row.netCents,
      }),
      {
        annualFeeCents: 0,
        creditsUsedCents: 0,
        creditsLeftCents: 0,
        creditsExpiredCents: 0,
        earnedValueCents: 0,
        earnedCashCents: 0,
        earnedPointsValueCents: 0,
        netCents: 0,
      }
    );

    return {
      rows,
      choices,
      totals,
      /** Whether anything has been said about any card yet, for the empty state. */
      anyRates: withRates.length > 0,
    };
  }, [cards, earnRates, valuations, transactions, accounts, budgets, payees, offerRows, today]);
}
