import { formatCents } from "../utils";
import Button from "./Button";

// Unlike UncategorizedBudgetCard, this renders even at zero: income is a
// standing part of the ledger rather than an overflow bucket, and hiding it
// would take the only "Add income" control on the card grid with it.
export default function IncomeBudgetCard({ name, amountCents, onAddIncomeClick, onViewIncomeClick }) {
  return (
    <div className="border border-verdant/50 bg-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-sans text-sm font-semibold tracking-tight text-chalk">{name}</div>
        <div className="font-mono text-figure font-medium text-verdant">{formatCents(amountCents)}</div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onAddIncomeClick}>
          Add income
        </Button>
        <Button variant="outline" size="sm" onClick={onViewIncomeClick}>
          View income
        </Button>
      </div>
    </div>
  );
}
