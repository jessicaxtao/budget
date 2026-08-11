import { useState } from "react";
import AddBudgetModal from "../components/AddBudgetModal";
import AddIncomeSourceModal from "../components/AddIncomeSourceModal";
import Button from "../components/Button";
import ExpectedIncomeTable from "../components/ExpectedIncomeTable";
import PageHeader from "../components/PageHeader";
import PeriodStepper from "../components/PeriodStepper";
import PlanHealthSummary from "../components/PlanHealthSummary";
import { useBudgetPlan } from "../contexts/BudgetPlanContext";
import { useBudgets } from "../contexts/BudgetsContext";
import { useIncomePlan } from "../contexts/IncomePlanContext";
import usePlanHealth from "../hooks/usePlanHealth";
import { currentPeriod, formatCents, formatPeriod, fromCents, toCents } from "../utils";

export default function BudgetPlanPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [showAddIncomeSourceModal, setShowAddIncomeSourceModal] = useState(false);
  const [error, setError] = useState(null);

  const { deleteBudget } = useBudgets();
  const { getPlan, getPlannedCents, setPlannedAmount } = useBudgetPlan();
  const { deleteIncomeSource } = useIncomePlan();

  // Every figure on the page comes from one derivation at one period, the same
  // rule the Transactions page follows: the all-time totals the contexts also
  // expose are on a different clock, and mixing them would put two figures on
  // screen that disagree with nothing to explain why.
  const health = usePlanHealth(period);

  // Committed on blur rather than per keystroke: a half-typed "12" on the way
  // to "1200" is a real figure, and writing it would leave the plan wrong for
  // as long as it took to finish typing.
  function handleEstimateBlur(e, budget) {
    const raw = e.target.value;
    const cents = raw.trim() === "" ? 0 : toCents(raw);
    if (cents == null || cents < 0) {
      setError(`Enter a monthly estimate of zero or more for ${budget.name}.`);
      e.target.value = fromCents(getPlannedCents(budget.id, period));
      return;
    }
    setError(null);
    setPlannedAmount({ budgetId: budget.id, period, plannedCents: cents });
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Budget plan"
        description="Set what each category is expected to need each month and what you expect to earn, and the plan will tell you whether the two fit. Amounts carry forward until you change them, so editing next month leaves this month's history intact."
        actions={
          <>
            <PeriodStepper period={period} onChange={setPeriod} />
            <Button variant="primary" onClick={() => setShowAddBudgetModal(true)}>
              Add category
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
        period={period}
        expectedIncomeCents={health.expectedIncomeCents}
        plannedCents={health.plannedCents}
        unplannedCents={health.unplannedCents}
        paymentCount={health.paymentCount}
        sourceCount={health.sourceCount}
        categoryCount={health.categoryCount}
        estimatedCount={health.estimatedCount}
      />

      <section className="mb-4 border border-edge bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
            Categories and monthly estimates
          </h2>
          <span className="font-mono text-label uppercase text-chalk-soft">
            {formatPeriod(period)}
          </span>
        </div>

        {error && (
          <p role="alert" className="border-b border-edge px-4 py-3 font-sans text-row text-vermilion">
            {error}
          </p>
        )}

        {health.categoryRows.length === 0 ? (
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            No categories yet. Add one to start planning, then fund it from the Transactions page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-raised">
                  <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-mono text-label uppercase text-chalk">
                    Estimate per month
                  </th>
                  <th className="w-16 px-4 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.categoryRows.map((budget, i) => {
                  // No plan of its own for this period means the figure shown is
                  // an earlier one still in force. Worth saying, so editing it
                  // does not look like it came from nowhere.
                  const carriedForward = !getPlan(budget.id, period) && budget.plannedCents > 0;

                  return (
                    <tr key={budget.id} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                      <td className="px-4 py-2 font-sans text-row text-ink">{budget.name}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          // Remounted when the period changes so the uncontrolled
                          // input picks up that period's stored figure.
                          key={`${budget.id}-${period}`}
                          type="number"
                          step={0.01}
                          min={0}
                          defaultValue={budget.plannedCents ? fromCents(budget.plannedCents) : ""}
                          placeholder="0"
                          aria-label={`Monthly estimate for ${budget.name}`}
                          onBlur={(e) => handleEstimateBlur(e, budget)}
                          className="w-28 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                        />
                        {carriedForward && (
                          <div className="font-mono text-label uppercase text-ink-soft">
                            Carried forward
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="row"
                          size="sm"
                          aria-label={`Remove category: ${budget.name}`}
                          onClick={() => deleteBudget(budget)}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-band">
                  <td className="px-4 py-2 font-mono text-label uppercase text-ink">
                    Total planned
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-row font-medium tabular-nums text-ink">
                    {formatCents(health.plannedCents)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <ExpectedIncomeTable
        period={period}
        rows={health.incomeRows}
        expectedIncomeCents={health.expectedIncomeCents}
        recordedIncomeCents={health.recordedIncomeCents}
        outstandingIncomeCents={health.outstandingIncomeCents}
        onDelete={deleteIncomeSource}
      />

      <AddBudgetModal
        show={showAddBudgetModal}
        period={period}
        handleClose={() => setShowAddBudgetModal(false)}
      />
      <AddIncomeSourceModal
        show={showAddIncomeSourceModal}
        handleClose={() => setShowAddIncomeSourceModal(false)}
      />
    </>
  );
}
