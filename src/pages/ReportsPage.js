import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Spending reports"
        description="Charts that show where the money goes across categories and how that shifts over time."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Placeholder
          title="Spending by category"
          items={[
            "Breakdown of spending across categories for a chosen date range",
            "Plan vs. actual per category, so overruns are obvious",
            "Drill into a category to see the transactions behind the number",
          ]}
        />
        <Placeholder
          title="Spending over time"
          items={[
            "Total spend per period, with a trend line",
            "Stacked view showing how the category mix changes period to period",
            "Compare a category against its own history",
          ]}
        />
        <Placeholder
          title="Income vs. expenses"
          items={[
            "Income, expenses, and net saved plotted on one timeline",
            "Savings rate per period",
          ]}
        />
        <Placeholder
          title="Report controls"
          items={[
            "Date range picker with presets (this year, last 12 months, all time)",
            "Filters by category and by whether a transaction is recurring",
            "Export the underlying rows as CSV",
          ]}
        />
      </div>
    </>
  );
}
