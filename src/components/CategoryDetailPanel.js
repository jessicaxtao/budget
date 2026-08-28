import Button from "./Button";
import CategoryHistoryChart from "./CategoryHistoryChart";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { formatCents, formatDateMedium } from "../utils";

/**
 * One category, pulled out of the ranking and read on its own — the window's
 * month by month for it alone, and the exact transactions behind the figure.
 *
 * This is the drill-in `SpendingByCategoryTable` names a row for: clicking a
 * category there does not navigate away, it opens this panel beneath the
 * table, because the ranking is still the context the reader picked the
 * category out of. Closing it is the same click as opening it — the row stays
 * the one control.
 *
 * **Both halves read the row `useSpendingReport` already built** — `monthly`
 * and `transactions` — rather than re-filtering the ledger here. The hook
 * visits every transaction once to build the ranking; a second, independent
 * filter in this panel could disagree with it about which window a record
 * falls in, or about the refund rule, and the two would drift apart silently.
 *
 * The transaction list is read-only, the same seam `DonationList` cuts along:
 * the amount, the date, the description and the account are the ledger's, so
 * they are shown as the ledger has them and corrected on the register, not
 * here.
 */

const figureCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";

function TransactionRow({ transaction, accounts, striped }) {
  const inflow = transaction.kind === TRANSACTION_KINDS.INFLOW;
  const account = accounts.find((candidate) => candidate.id === transaction.accountId);

  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th
        scope="row"
        className="whitespace-nowrap px-4 py-2 text-left font-sans text-row font-normal text-ink"
      >
        {transaction.date ? formatDateMedium(transaction.date) : "Undated"}
      </th>
      <td className="px-3 py-2 font-sans text-row text-ink">{transaction.description || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 font-sans text-row text-ink-soft">
        {account?.name ?? "—"}
      </td>
      <td className={`${figureCell} text-ink`}>
        {inflow ? "—" : formatCents(transaction.amountCents)}
      </td>
      {/* A refund reads in the income colour, the same as it does on the
          register — this is the one figure on the row that is money coming
          back rather than money going out. */}
      <td className={`${figureCell} text-verdant`}>
        {inflow ? formatCents(transaction.amountCents) : "—"}
      </td>
    </tr>
  );
}

export default function CategoryDetailPanel({ row, months, accounts, onClose }) {
  return (
    <section className="border border-azure/60 bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div>
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
            {row.name}
          </h2>
          <p className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
            {row.groupName ?? "No group"} · {formatCents(row.netSpentCents)} over {months.length}{" "}
            {months.length === 1 ? "month" : "months"}
            {row.refundCents > 0 && ` · ${formatCents(row.refundCents)} refunded`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to the ranking
        </Button>
      </div>

      <CategoryHistoryChart monthly={row.monthly} />

      {row.transactions.length === 0 ? (
        <p className="border-t border-edge px-4 py-5 font-sans text-row text-chalk-soft">
          Nothing dated in this window moved through {row.name}.
        </p>
      ) : (
        <div className="max-h-[24rem] overflow-auto border-t border-edge">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Date", "Description", "Account", "Out", "In"].map((label, index) => (
                  <th
                    key={label}
                    scope="col"
                    className={`sticky top-0 z-10 whitespace-nowrap bg-panel-raised px-3 py-2 font-mono text-label uppercase text-chalk ${
                      index === 0 ? "px-4 text-left" : index >= 3 ? "text-right" : "text-left"
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row.transactions.map((transaction, index) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  accounts={accounts}
                  striped={index % 2 === 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
