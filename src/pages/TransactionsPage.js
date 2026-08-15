import { useMemo, useState } from "react";
import AddTransactionModal from "../components/AddTransactionModal";
import AssignIncomeModal from "../components/AssignIncomeModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import ToBeAssignedBar from "../components/ToBeAssignedBar";
import TransactionRegister from "../components/TransactionRegister";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useTransactions } from "../contexts/TransactionsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import { currentPeriod, toPeriod } from "../utils";

/**
 * The books, a month at a time, as the register they are.
 *
 * This page used to be a grid of envelope cards. What each envelope holds is a
 * question about the *plan*, and it is answered on the dashboard, where the
 * same figures sit in one table beside everything else that is true today. What
 * this page is for is the other job — going through what actually happened,
 * line by line, against a statement — and that job wants rows and columns, with
 * every field reachable where it sits.
 *
 * One figure from the envelope side stays: what is left to assign. It is the
 * reason income is worth logging promptly, it moves as the register is worked
 * through, and the flow it opens has nowhere else to be reached from.
 */
export default function TransactionsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const { transactions, updateTransaction, deleteTransaction } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();

  // Only the pool figures now — the per-category rows this page used to draw
  // are the dashboard's job. Read at the period on screen, so stepping back
  // reports what was unassigned then rather than what is unassigned now.
  const { toBeAssignedCents, periodIncomeCents, periodAssignedCents } = useEnvelopes(period);

  // The month's rows, newest first, plus every undated one — those belong to no
  // month, and a register that dropped them would leave money on the books with
  // nowhere to correct it. The register bands them separately.
  const rows = useMemo(() => {
    const inPeriod = transactions.filter((transaction) => {
      const at = toPeriod(transaction.date);
      return at == null || at === period;
    });
    // Stable, so entries sharing a date stay in the order they were logged.
    return [...inPeriod].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [transactions, period]);

  return (
    <>
      <PageHeader
        eyebrow="Day to day"
        title="Transactions"
        description="Every movement of money, a month at a time. Each row names the account it moved through and the category it came out of, and every cell is editable where it sits."
        actions={
          <>
            <PeriodStepper period={period} onChange={setPeriod} />
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              Add transaction
            </Button>
          </>
        }
      />

      <ToBeAssignedBar
        toBeAssignedCents={toBeAssignedCents}
        periodIncomeCents={periodIncomeCents}
        periodAssignedCents={periodAssignedCents}
        onAssignClick={() => setShowAssignModal(true)}
      />

      <TransactionRegister
        period={period}
        transactions={rows}
        budgets={budgets}
        accounts={accounts}
        onChange={updateTransaction}
        onDelete={deleteTransaction}
        onAdd={() => setShowAddModal(true)}
      />

      <AssignIncomeModal
        show={showAssignModal}
        period={period}
        handleClose={() => setShowAssignModal(false)}
      />
      <AddTransactionModal show={showAddModal} handleClose={() => setShowAddModal(false)} />
    </>
  );
}
