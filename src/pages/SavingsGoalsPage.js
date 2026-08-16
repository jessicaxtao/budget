import { useState } from "react";
import AddSavingsGoalModal from "../components/AddSavingsGoalModal";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import Placeholder from "../components/Placeholder";
import SavingsGoalList from "../components/SavingsGoalList";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import useEnvelopes from "../hooks/useEnvelopes";
import useSavingsGoalEnvelopes from "../hooks/useSavingsGoalEnvelopes";
import { currentPeriod, formatCents } from "../utils";

/**
 * Medium-term savings: a camera, a wedding, a special event — anything
 * expected to exceed the normal monthly budget, which is what makes it a
 * goal to plan around rather than a category to estimate.
 *
 * In the envelope shape, same as a category: a goal accumulates what has
 * been assigned to it, period by period, and that assignment draws from the
 * very same "to be assigned" pool a category does — see useEnvelopes. No
 * stepper, on the same reasoning the dashboard has none: this answers where
 * each goal stands right now, not a month to walk back through.
 *
 * Linking a goal to the category or account it draws from, and editing or
 * removing a goal, are still to come.
 */
export default function SavingsGoalsPage() {
  const [showModal, setShowModal] = useState(false);
  const period = currentPeriod();

  const { toBeAssignedCents } = useEnvelopes(period);
  const { setAssignedAmount } = useSavingsGoalAssignments();
  const rows = useSavingsGoalEnvelopes(period);

  function handleAssign(row, cents) {
    return setAssignedAmount({ goalId: row.goalId, period, amountCents: cents });
  }

  return (
    <>
      <PageHeader
        eyebrow="Planning ahead"
        title="Savings goals"
        description="Medium-term goals expected to exceed the normal budget — a new camera, a wedding, a special event — planned for on purpose instead of blowing through an envelope's estimate."
        actions={
          <Button variant="primary" onClick={() => setShowModal(true)}>
            Add goal
          </Button>
        }
      />

      <div className="space-y-4">
        {/* A goal competes with every category for the same unassigned
            dollar, so that figure belongs on this page too — read-only here,
            since assigning it to a category is Transactions' "Assign
            income" flow, not this one. */}
        <p className="font-sans text-row text-chalk-soft">
          <span className="font-mono text-label uppercase text-chalk-soft">To be assigned</span>{" "}
          <span className="font-mono text-row font-medium text-chalk">
            {formatCents(toBeAssignedCents)}
          </span>{" "}
          — money not yet assigned to a category or a goal.
        </p>

        <SavingsGoalList rows={rows} period={period} onAssign={handleAssign} />

        <Placeholder
          title="Still to come"
          items={[
            "Linking a goal to the category or account it draws from",
            "Editing and removing a goal",
          ]}
        />
      </div>

      <AddSavingsGoalModal show={showModal} handleClose={() => setShowModal(false)} />
    </>
  );
}
