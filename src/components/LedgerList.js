import Button from "./Button";
import { formatCents } from "../utils";

/**
 * The ledger rows behind a category, drawn the way the spreadsheet draws data:
 * a dark header band, then the body inverted to a light sheet so the figures
 * sit on paper rather than on the chrome. Expenses and income are the same
 * shape — description, date, amount, remove — so they share one table rather
 * than two that drift apart.
 */
export default function LedgerList({ entries, onDelete, emptyMessage, removeLabel }) {
  if (entries.length === 0) {
    return <p className="font-sans text-row text-chalk-soft">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className="px-3 py-2 font-mono text-label uppercase text-chalk">
              Description
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-label uppercase text-chalk">
              Date
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
              Amount
            </th>
            <th scope="col" className="w-10 px-1 py-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.id} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
              <td className="px-3 py-2 font-sans text-row text-ink">{entry.description}</td>
              {/* Entries logged before the ledger tracked dates genuinely have
                  none; say so rather than inventing one. */}
              <td className="whitespace-nowrap px-3 py-2 font-mono text-row text-ink-soft">
                {entry.date ?? "Undated"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium text-ink">
                {formatCents(entry.amountCents)}
              </td>
              <td className="px-1 py-1 text-right">
                <Button
                  variant="row"
                  size="sm"
                  onClick={() => onDelete(entry)}
                  aria-label={`${removeLabel}: ${entry.description}`}
                >
                  &times;
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
