import CategoryLedgerTable from "../components/CategoryLedgerTable";
import DashboardSummary from "../components/DashboardSummary";
import PageHeader from "../components/PageHeader";
import ReconciliationList from "../components/ReconciliationList";
import { useAccounts } from "../contexts/AccountsContext";
import useAccountBalances from "../hooks/useAccountBalances";
import useDashboard from "../hooks/useDashboard";
import useNextPaycheck from "../hooks/useNextPaycheck";
import { currentPeriod, daysBetween, formatDateLong, todayISO } from "../utils";

/**
 * Where the household stands today.
 *
 * The one page with no month selector on it, deliberately. Every other screen
 * either describes a typical month (Configuration) or lets the user walk back
 * through the books (Transactions); this one answers "where am I right now",
 * and a period stepper would turn it into a second, worse copy of the
 * Transactions page. Today's date is stated at the top for the same reason —
 * every figure below is as of that day, including the countdown and the
 * reconciliation ages.
 *
 * Nothing here is entered except one thing: marking an account reconciled. That
 * is the one fact on the page no ledger can derive — it says the books and the
 * bank agreed on a given day — and the place it is worth recording is the place
 * the balance is being looked at.
 */
export default function DashboardPage() {
  // Read once, so the date in the header, the countdown, and every "days ago" on
  // the page are all measured from the same day. Two calls either side of
  // midnight would disagree.
  const today = todayISO();
  const period = currentPeriod();

  const { accounts, reconcileAccount } = useAccounts();
  const { rows: balanceRows } = useAccountBalances(period);
  const paycheck = useNextPaycheck(today);
  const dashboard = useDashboard(period);

  // What there was to spend: money assigned in an earlier month and carried in
  // is just as spendable as money assigned this month, and so is money refunded
  // back into a category. Which is exactly what is left over plus what went out.
  const fundedCents = dashboard.totals.availableCents + dashboard.periodSpentCents;
  const categoryCount = dashboard.sections.reduce(
    (count, section) => count + section.rows.length,
    0
  );

  const accountRows = balanceRows.map((row) => ({
    ...row,
    daysSince:
      row.account.reconciledOn == null ? null : daysBetween(row.account.reconciledOn, today),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="What is left to budget, what this month has done, and when the next paycheck lands."
        actions={
          <div className="text-right">
            <div className="font-mono text-label uppercase text-chalk-soft">Today</div>
            <div className="mt-0.5 font-sans text-sm font-medium text-chalk">
              {formatDateLong(today)}
            </div>
          </div>
        }
      />

      <DashboardSummary
        period={period}
        availableToBudgetCents={dashboard.availableToBudgetCents}
        periodIncomeCents={dashboard.periodIncomeCents}
        budgetedCents={dashboard.periodBudgetedCents}
        spentCents={dashboard.periodSpentCents}
        refundCents={dashboard.periodRefundCents}
        fundedCents={fundedCents}
        categoryCount={categoryCount}
        paycheck={paycheck}
      />

      {/* The same split as the Configuration page — the wide table of categories
          beside the short list of accounts — so the two screens read as one
          layout rather than two. `items-start` so the accounts panel ends where
          its rows do instead of being stretched to the table's height. */}
      <div className="mt-4 grid items-start gap-x-5 gap-y-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CategoryLedgerTable
            sections={dashboard.sections}
            otherRows={dashboard.otherRows}
            otherTotals={dashboard.otherTotals}
            totals={dashboard.totals}
          />
        </div>
        <ReconciliationList
          rows={accountRows}
          onReconcile={(account) => reconcileAccount({ id: account.id })}
        />
      </div>

      {accounts.length > 0 && (
        <p className="mt-3 font-sans text-row text-chalk-soft">
          Balances are the opening figure plus every transaction through the account, so they
          follow the ledger — reconciling records that they agreed with the bank today.
        </p>
      )}
    </>
  );
}
