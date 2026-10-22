import BalanceHistoryPanel from "../components/BalanceHistoryPanel";
import Button from "../components/Button";
import BooksEncryptionPanel from "../components/BooksEncryptionPanel";
import BooksFilePanel from "../components/BooksFilePanel";
import DonationsTaxPanel from "../components/DonationsTaxPanel";
import HouseholdPanel from "../components/HouseholdPanel";
import GivingCategoriesPanel from "../components/GivingCategoriesPanel";
import PageHeader from "../components/PageHeader";
import PayeeList from "../components/PayeeList";
import ScheduleList from "../components/ScheduleList";
import TransactionsExportPanel from "../components/TransactionsExportPanel";
import { useBudgets } from "../contexts/BudgetsContext";
import { useDonations } from "../contexts/DonationsContext";
import useGiving from "../hooks/useGiving";
import { todayISO } from "../utils";
import useTheme, { THEMES } from "../hooks/useTheme";
import { RewardsValuationsPanel } from "./RewardsPage";

export default function SettingsPage() {
  const { budgets } = useBudgets();
  const { givingSettings, setGivingCategories } = useDonations();
  const giving = useGiving(todayISO().slice(0, 4));
  const { theme, toggleTheme } = useTheme();
  const dark = theme === THEMES.DARK;
  const stated = Array.isArray(givingSettings.budgetIds);

  return (
    <>
      <PageHeader
        title="Household setup"
        description="Manage household preferences, schedules, exports, and your books file."
      />

      <div className="space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-edge bg-panel px-4 py-3">
          <div>
            <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Appearance</h2>
            <p className="mt-1 font-sans text-row text-chalk-soft">
              Current theme: {dark ? "Dark" : "Light"}
            </p>
          </div>
          <Button variant="outline" type="button" aria-pressed={dark} onClick={toggleTheme}>
            Use {dark ? "light" : "dark"} mode
          </Button>
        </section>
        <ScheduleList />
        <PayeeList />
        <TransactionsExportPanel />
        <DonationsTaxPanel />
        <BalanceHistoryPanel />
        <BooksFilePanel />
        <BooksEncryptionPanel />
        <RewardsValuationsPanel />
        <GivingCategoriesPanel
          budgets={budgets}
          selectedIds={giving.givingBudgetIds}
          stated={stated}
          onChange={setGivingCategories}
        />
        <HouseholdPanel />
      </div>
    </>
  );
}
