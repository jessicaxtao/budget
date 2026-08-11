import { useState } from "react";
import AddBudgetModal from "../components/AddBudgetModal";
import AddGroupModal from "../components/AddGroupModal";
import AddIncomeSourceModal from "../components/AddIncomeSourceModal";
import Button from "../components/Button";
import CategoryPlanner from "../components/CategoryPlanner";
import ExpectedIncomeTable from "../components/ExpectedIncomeTable";
import PageHeader from "../components/PageHeader";
import PlanHealthSummary from "../components/PlanHealthSummary";
import { useBudgets } from "../contexts/BudgetsContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import usePlanHealth from "../hooks/usePlanHealth";

/**
 * The standing configuration: what the user expects to earn, what each category
 * is expected to need, and how the categories are arranged.
 *
 * There is no month on this page, deliberately. Every figure here is a monthly
 * average that holds until the user changes it — an estimate describes a
 * category in general, not January in particular — and the moment a month
 * appeared in the corner, the user would reasonably expect editing it to leave
 * the other months alone. Which month a given dollar landed in is the
 * Transactions page's question, and it answers it from the books rather than
 * from anything set here.
 */
export default function ConfigurationPage() {
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showAddIncomeSourceModal, setShowAddIncomeSourceModal] = useState(false);
  // The group a category is being added to, and the group being renamed. Held
  // separately: adding files the new category under a heading, renaming edits
  // the heading itself.
  const [addToGroupId, setAddToGroupId] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [error, setError] = useState(null);

  const { updateBudget, deleteBudget, deleteGroup, setCategoryLayout } = useBudgets();
  const { deleteIncomeSource } = useIncomePlan();

  const health = usePlanHealth();

  // The store validates; the page has to say so. Silently swallowing a rejected
  // figure would leave the row showing an amount the plan is not using.
  function handleEstimateChange(budget, cents) {
    if (cents == null || cents < 0) {
      setError(`Enter a monthly estimate of zero or more for ${budget.name}.`);
      return { ok: false };
    }
    const result = updateBudget({ id: budget.id, plannedCents: cents });
    setError(result.ok ? null : result.error);
    return result;
  }

  function handleAddCategory(groupId) {
    setAddToGroupId(groupId);
    setShowAddBudgetModal(true);
  }

  function handleRenameGroup(section) {
    setEditingGroup({ id: section.groupId, name: section.name });
    setShowAddGroupModal(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Budget plan"
        description="Set what you expect to earn and what each category is expected to need in a typical month, and the plan will tell you whether the two fit. Drag categories to file them under a group or change their order — the Transactions page follows the arrangement you set here."
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setAddToGroupId(null);
                setShowAddBudgetModal(true);
              }}
            >
              Add category
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingGroup(null);
                setShowAddGroupModal(true);
              }}
            >
              Add group
            </Button>
            <Button variant="outline" onClick={() => setShowAddIncomeSourceModal(true)}>
              Add income source
            </Button>
          </>
        }
      />

      {/* The verdict leads. It is the answer the rest of the page is working
          towards, and a plan that does not balance has to be visible before the
          user scrolls, not after. */}
      <PlanHealthSummary
        expectedIncomeCents={health.expectedIncomeCents}
        plannedCents={health.plannedCents}
        unplannedCents={health.unplannedCents}
        sourceCount={health.sourceCount}
        categoryCount={health.categoryCount}
        estimatedCount={health.estimatedCount}
      />

      {error && (
        <p
          role="alert"
          className="mb-4 border border-vermilion/60 bg-panel px-4 py-3 font-sans text-row text-vermilion"
        >
          {error}
        </p>
      )}

      {/* Groups on their own are worth showing — a user can lay out their
          headings before filling them — so the page only takes over with an
          empty state when there is nothing at all to arrange. */}
      {health.categoryCount === 0 && health.groupCount === 0 ? (
        <section className="mb-4 border border-edge bg-panel">
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            No categories yet. Add one to start planning, then fund it from the Transactions page.
          </p>
        </section>
      ) : (
        <CategoryPlanner
          sections={health.sections}
          onLayoutChange={setCategoryLayout}
          onEstimateChange={handleEstimateChange}
          onAddCategory={handleAddCategory}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={(section) => deleteGroup({ id: section.groupId })}
          onDeleteCategory={deleteBudget}
        />
      )}

      <ExpectedIncomeTable
        rows={health.incomeRows}
        expectedIncomeCents={health.expectedIncomeCents}
        onDelete={deleteIncomeSource}
      />

      <AddBudgetModal
        show={showAddBudgetModal}
        defaultGroupId={addToGroupId}
        handleClose={() => setShowAddBudgetModal(false)}
      />
      <AddGroupModal
        show={showAddGroupModal}
        group={editingGroup}
        handleClose={() => setShowAddGroupModal(false)}
      />
      <AddIncomeSourceModal
        show={showAddIncomeSourceModal}
        handleClose={() => setShowAddIncomeSourceModal(false)}
      />
    </>
  );
}
