import Button from "./Button";
import { useAccounts } from "../contexts/AccountsContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import { formatCents, todayISO } from "../utils";

const COLUMNS = [
  "Transaction ID",
  "Date",
  "Type",
  "Amount (USD)",
  "Payee",
  "Description",
  "Account",
  "To account",
  "Category",
  "Split details",
  "Recorded from schedule",
];

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet programs from treating user-entered text as a formula.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function amountDollars(cents) {
  return (cents / 100).toFixed(2);
}

export default function TransactionsExportPanel() {
  const { transactions } = useTransactions();
  const { accounts } = useAccounts();
  const { budgets } = useBudgets();
  const { payeeById } = usePayees();
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));

  function exportTransactions() {
    const rows = [...transactions]
      .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
      .map((transaction) => {
        const transfer = transaction.kind === TRANSACTION_KINDS.TRANSFER;
        const splits = (transaction.splits ?? []).map((part) => {
          const category = budgetById.get(part.budgetId)?.name ?? "Unknown category";
          return `${category}: ${formatCents(part.amountCents)}`;
        });
        const category = transaction.budgetId == null
          ? ""
          : budgetById.get(transaction.budgetId)?.name ?? "Unknown category";
        return [
          transaction.id,
          transaction.date,
          transaction.kind === TRANSACTION_KINDS.INFLOW
            ? "Inflow"
            : transfer ? "Transfer" : "Outflow",
          amountDollars(transaction.amountCents),
          payeeById.get(transaction.payeeId)?.name ?? "",
          transaction.description,
          accountById.get(transaction.accountId)?.name ?? "",
          transfer ? accountById.get(transaction.toAccountId)?.name ?? "Unknown account" : "",
          category,
          splits.join(" | "),
          transaction.scheduled ? "Yes" : "No",
        ];
      });

    const csv = `\uFEFF${[COLUMNS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `budget-transactions-${todayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 border border-edge bg-panel px-4 py-3">
      <div>
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Export transactions</h2>
        <p className="mt-1 font-sans text-row text-chalk-soft">
          Download all {transactions.length} ledger {transactions.length === 1 ? "transaction" : "transactions"} as a CSV file, including categories, accounts, and split details.
        </p>
      </div>
      <Button variant="outline" type="button" onClick={exportTransactions}>
        Export transactions CSV
      </Button>
    </section>
  );
}
