import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";

export default function RetirementPage() {
  return (
    <>
      <PageHeader
        eyebrow="Long range"
        title="Retirement planning"
        description="A projection that starts from today's real numbers but stays fully editable, so scenarios can be explored without touching the day-to-day books."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Placeholder
          title="Starting point"
          items={[
            "Seed starting balances from the net worth page and annual spending from the budget plan",
            "Every seeded value can be overridden by hand; overrides never write back to the books",
            "Reset control to pull the current real numbers back in",
          ]}
        />
        <Placeholder
          title="Assumptions"
          items={[
            "Current age, target retirement age, and life expectancy",
            "Annual contributions, expected return, inflation, and withdrawal rate",
            "Expected retirement spending, which can differ from spending today",
          ]}
        />
        <Placeholder
          title="Projection"
          items={[
            "Portfolio balance year by year through retirement",
            "The year the money runs out, or the surplus left at the end",
            "Required savings rate to hit the target retirement age",
          ]}
        />
        <Placeholder
          title="Scenarios"
          items={[
            "Save a set of assumptions as a named scenario",
            "Compare scenarios side by side on one chart",
            "Sensitivity view: what a one-point change in return or inflation does to the outcome",
          ]}
        />
      </div>
    </>
  );
}
