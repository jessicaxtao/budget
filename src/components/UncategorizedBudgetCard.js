import BudgetCard from "./BudgetCard";

/**
 * Spend with no category of its own, either filed that way or left behind when
 * a category was deleted. Prop-driven for the same reason as TotalBudgetCard:
 * the row comes from the page's useEnvelopes call rather than a second one.
 *
 * Returns null when the bucket is completely untouched — but not merely when it
 * is empty of *this month's* activity, since a balance carried in from an
 * earlier month is exactly what the user needs to see in order to cover it.
 */
export default function UncategorizedBudgetCard({ row, ...props }) {
  if (!row || (!row.availableCents && !row.assignedCents && !row.spentCents)) return null;

  return (
    <BudgetCard
      name={row.name}
      carriedInCents={row.carriedInCents}
      assignedCents={row.assignedCents}
      spentCents={row.spentCents}
      gray
      {...props}
    />
  );
}
