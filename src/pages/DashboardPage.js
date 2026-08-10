import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="One page that answers: what came in, what went out, and what is left over."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Placeholder
          title="This period at a glance"
          items={[
            "Income received, expenses spent, and the resulting surplus or shortfall",
            "Progress against the planned budget for the current period",
            "Period selector so any past month can be reviewed",
          ]}
        />
        <Placeholder
          title="Where the money went"
          items={[
            "Top spending categories, ranked, with plan vs. actual",
            "Categories that are over or close to their limit",
            "Recent transactions, with a link through to the full ledger",
          ]}
        />
        <Placeholder
          title="Trend"
          items={[
            "Income and expense totals over the last several periods",
            "Savings rate over time",
          ]}
        />
        <Placeholder
          title="Long-term markers"
          items={[
            "Current net worth with change since last period",
            "Headline number from the retirement projection",
          ]}
        />
      </div>
    </>
  );
}
