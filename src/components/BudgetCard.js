import { formatCents } from "../utils";
import Button from "./Button";
import TallyGauge from "./TallyGauge";

export default function BudgetCard({
  name,
  amountCents,
  maxCents,
  // Derived cards — the running total and the uncategorised catch-all — recede
  // behind the categories the user actually configured.
  gray,
  onAddExpenseClick,
  hideButtons,
  onViewExpensesClick,
}) {
  const overBudget = Boolean(maxCents) && amountCents > maxCents;

  return (
    <div
      className={`border p-4 ${
        gray
          ? "border-dashed border-edge bg-panel/60"
          : overBudget
          ? "border-vermilion/60 bg-panel"
          : "border-edge bg-panel"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-sans text-sm font-semibold tracking-tight text-chalk">{name}</div>
        <div className="flex items-baseline gap-1.5 font-mono">
          <span className={`text-figure font-medium ${overBudget ? "text-vermilion" : "text-azure"}`}>
            {formatCents(amountCents)}
          </span>
          {maxCents ? <span className="text-row text-chalk-soft">/ {formatCents(maxCents)}</span> : null}
        </div>
      </div>
      {maxCents ? (
        <div className="mt-3">
          <TallyGauge amount={amountCents} max={maxCents} />
        </div>
      ) : null}
      {!hideButtons && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onAddExpenseClick}>
            Add expense
          </Button>
          <Button variant="outline" size="sm" onClick={onViewExpensesClick}>
            View expenses
          </Button>
        </div>
      )}
    </div>
  );
}
