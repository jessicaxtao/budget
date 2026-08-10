import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";

export default function NetWorthPage() {
  return (
    <>
      <PageHeader
        eyebrow="Position"
        title="Net worth"
        description="The balance-sheet view: what is owned, what is owed, and how the gap between them moves over time."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Placeholder
          title="Accounts"
          items={[
            "Add asset accounts (cash, brokerage, retirement, property) and liabilities (loans, cards)",
            "Tag each account with an asset class for allocation reporting",
            "Archive closed accounts without losing their history",
          ]}
        />
        <Placeholder
          title="Balance history"
          items={[
            "Record a balance per account per period, entered by hand",
            "Quick monthly update flow that walks through every active account",
            "Backfill past periods so the chart has a real starting point",
          ]}
        />
        <Placeholder
          title="Net worth over time"
          items={[
            "Assets, liabilities, and net worth plotted across periods",
            "Change vs. last period and vs. last year",
            "How much of the change came from contributions vs. market movement",
          ]}
        />
        <Placeholder
          title="Asset allocation"
          items={[
            "Current allocation across asset classes",
            "Target allocation with drift from target",
            "Allocation mix over time",
          ]}
        />
      </div>
    </>
  );
}
