import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";

export default function BudgetPlanPage() {
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Budget plan"
        description="Set what each category is allowed each period, and change those amounts as circumstances change without rewriting history."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Placeholder
          title="Categories"
          items={[
            "Create, rename, reorder, and archive spending categories",
            "Group categories into higher-level buckets (fixed, variable, savings)",
            "Archiving keeps past transactions intact instead of deleting them",
          ]}
        />
        <Placeholder
          title="Planned amounts by period"
          items={[
            "A per-period planned amount for every category, stored per month",
            "Copy last period's plan forward as the starting point for a new one",
            "Effective-dated changes so a raise or a new rent amount only affects periods after it",
          ]}
        />
        <Placeholder
          title="Expected income"
          items={[
            "Recurring income sources with their cadence and amount",
            "Planned income per period, to compare against what actually arrives",
          ]}
        />
        <Placeholder
          title="Plan health"
          items={[
            "Total planned expenses vs. total planned income for the period",
            "Warning when the plan allocates more than it takes in",
          ]}
        />
      </div>
    </>
  );
}
