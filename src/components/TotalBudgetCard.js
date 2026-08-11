import BudgetCard from "./BudgetCard";

/**
 * Every envelope added together — how much of the ledger's money is currently
 * sitting inside a category. Prop-driven rather than self-connected: the page
 * already holds these figures from useEnvelopes, and reading them a second time
 * would mean two copies of the same derivation drifting apart.
 *
 * Returns null when there is nothing to total, so an untouched ledger is not
 * padded out with a card reading zero.
 */
export default function TotalBudgetCard({ carriedInCents, assignedCents, spentCents }) {
  if (!carriedInCents && !assignedCents && !spentCents) return null;

  return (
    <BudgetCard
      name="All categories"
      carriedInCents={carriedInCents}
      assignedCents={assignedCents}
      spentCents={spentCents}
      gray
      hideButtons
    />
  );
}
