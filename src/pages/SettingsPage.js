import { useState } from "react";
import AssignIncomeModal from "../components/AssignIncomeModal";
import BalanceHistoryPanel from "../components/BalanceHistoryPanel";
import Button from "../components/Button";
import BooksEncryptionPanel from "../components/BooksEncryptionPanel";
import BooksFilePanel from "../components/BooksFilePanel";
import GivingCategoriesPanel from "../components/GivingCategoriesPanel";
import PageHeader from "../components/PageHeader";
import PayeeList from "../components/PayeeList";
import ScheduleList from "../components/ScheduleList";
import TransactionsExportPanel from "../components/TransactionsExportPanel";
import { useBudgets } from "../contexts/BudgetsContext";
import { useDonations } from "../contexts/DonationsContext";
import useGiving from "../hooks/useGiving";
import useStartingBalances from "../hooks/useStartingBalances";
import { todayISO } from "../utils";
import useTheme, { THEMES } from "../hooks/useTheme";
import { RewardsValuationsPanel } from "./RewardsPage";

export default function SettingsPage() {
  const [showAssignStartingModal, setShowAssignStartingModal] = useState(false);
  const { budgets } = useBudgets();
  const { givingSettings, setGivingCategories } = useDonations();
  const giving = useGiving(todayISO().slice(0, 4));
  const { period: startingPeriod, poolCentsOverride: startingPoolCents } = useStartingBalances();
  const { theme, toggleTheme } = useTheme();
  const dark = theme === THEMES.DARK;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Household setup"
        description="Set reward point values and giving categories, manage recurring schedules and payees, export transactions, review account history, and manage your books file."
        actions={
          <Button variant="outline" onClick={() => setShowAssignStartingModal(true)}>
            Assign starting balances
          </Button>
        }
      />

      <div className="space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-4 border border-edge bg-panel px-4 py-3">
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
        <RewardsValuationsPanel />
        <GivingCategoriesPanel
          budgets={budgets}
          selectedIds={giving.givingBudgetIds}
          stated={Array.isArray(givingSettings.budgetIds)}
          onChange={setGivingCategories}
        />
        <ScheduleList />
        <PayeeList />
        <TransactionsExportPanel />
        <BalanceHistoryPanel />
        <BooksFilePanel />
        <BooksEncryptionPanel />
      </div>
      <AssignIncomeModal
        show={showAssignStartingModal}
        period={startingPeriod}
        poolCentsOverride={startingPoolCents}
        title="Assign starting balances"
        handleClose={() => setShowAssignStartingModal(false)}
      />
    </>
  );
}
