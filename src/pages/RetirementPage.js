import { useMemo, useState } from "react";
import AddLifeEventModal from "../components/AddLifeEventModal";
import Button from "../components/Button";
import LifeEventsPanel from "../components/LifeEventsPanel";
import PageHeader from "../components/PageHeader";
import NetWorthProjection from "../components/NetWorthProjection";
import ProjectionAssumptionsPanel from "../components/ProjectionAssumptionsPanel";
import ScenariosPanel from "../components/ScenariosPanel";
import RetirementAssumptionsPanel from "../components/RetirementAssumptionsPanel";
import RetirementChart from "../components/RetirementChart";
import RetirementFanChart from "../components/RetirementFanChart";
import RetirementOutlook from "../components/RetirementOutlook";
import RetirementPlanInputs from "../components/RetirementPlanInputs";
import SegmentedControl from "../components/SegmentedControl";
import SocialSecurityModal from "../components/SocialSecurityModal";
import { LIFE_EVENT_KINDS, useLifeEvents } from "../contexts/LifeEventsContext";
import { RETURN_SOURCES, migratePlan, useRetirement } from "../contexts/RetirementContext";
import { useScenarios } from "../contexts/ScenariosContext";
import { useSavingsGoals } from "../contexts/SavingsGoalsContext";
import useRetirementProjection, { effectiveReturnRates } from "../hooks/useRetirementProjection";
import { formatBps, formatCents } from "../utils";

/** The three lenses `RetirementPage` can show the same plan through — a
 *  choice about what is on screen, never a value the plan stores, per
 *  `SegmentedControl`'s own doc comment. */
const VIEW_MODES = [
  { value: "deterministic", label: "Projection" },
  { value: "monte-carlo", label: "Monte Carlo" },
  { value: "historical", label: "Historical" },
];

/**
 * The long-range view: whether what is being put away now adds up to the
 * retirement being planned for.
 *
 * **This page has no month on it and no period stepper, and that is deliberate
 * in a different way from the dashboard's.** The dashboard is undated because
 * everything on it is as of today; this is undated because nothing on it is
 * about a month at all. It reads today's account values once, and everything
 * else is a decade-scale assumption. A stepper here would suggest the projection
 * could be walked back through, which it cannot — a plan has no history, only a
 * current shape.
 *
 * Nothing on this page writes to the books. The starting point *reads* the
 * accounts and the contribution *reads* the retirement categories (plus
 * whatever pretax figure is typed in, which the books have no way to know),
 * but the plan is its own store, and a scenario explored here moves no money
 * — see `RetirementContext`.
 *
 * Scenarios are saved copies of the plan with the events that were on, each
 * projected over the same books through `resolveWith` and compared beside the
 * current plan, with a sensitivity table under them — see `ScenariosContext`
 * and `ScenariosPanel`. Using one writes the plan and the events' switches,
 * never the books.
 */
/** Two records equal field by field, whatever order their keys were written
 *  in — a stored plan and a migrated copy of it list theirs differently. */
function sameRecord(a, b) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])])
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export default function RetirementPage() {
  const {
    setRetirementPlan,
    toggleRetirementAccount,
    addSalary,
    updateSalary,
    removeSalary,
    setDebtAssumption,
    resetRetirementPlan,
    replaceRetirementPlan,
  } = useRetirement();
  const {
    plan,
    accountRows,
    inputs,
    debtRows,
    netWorth,
    projection,
    propertyOptions,
    debtOptions,
    resolveWith,
    runSimulation,
  } = useRetirementProjection();

  // One message per panel rather than one for the page: the field to go back to
  // is in the panel that rejected it, and a rejection at the top of the screen
  // about an input at the bottom is a message the user has to hunt for.
  const [startingError, setStartingError] = useState(null);
  const [assumptionsError, setAssumptionsError] = useState(null);
  const [investmentError, setInvestmentError] = useState(null);
  const [projectionError, setProjectionError] = useState(null);

  // Which lens the "Year by year" section reads through — a view, not a
  // value, so it lives here rather than on the plan (see `SegmentedControl`).
  // The simulation itself runs only on demand: see the note beside the
  // button below on why this does not recompute the way every other figure
  // on this page does.
  const [viewMode, setViewMode] = useState("deterministic");
  const [simulation, setSimulation] = useState({ result: null, loading: false, error: null });
  const byMix = plan.returnSource === RETURN_SOURCES.MIX;
  const returnRates = effectiveReturnRates(plan);

  const changeViewMode = (mode) => {
    setViewMode(mode);
    setSimulation({ result: null, loading: false, error: null });
  };

  const runCurrentSimulation = () => {
    setSimulation({ result: null, loading: true, error: null });
    try {
      const result = runSimulation({
        mode: viewMode,
        trials: plan.simulationTrials,
        seed: Math.floor(Math.random() * 2 ** 31),
      });
      setSimulation({ result, loading: false, error: null });
    } catch (caught) {
      setSimulation({ result: null, loading: false, error: caught.message });
    }
  };

  const { events, setLifeEventEnabled, setEnabledEvents, deleteLifeEvent } = useLifeEvents();
  const { scenarios, saveScenario, updateScenario, deleteScenario } = useScenarios();
  const [scenarioError, setScenarioError] = useState(null);

  // The current plan and every saved scenario, each projected over the same
  // books by the same derivation — a scenario differs only by what it saved.
  const enabledEventIds = events.filter((event) => event.enabled).map((event) => event.id);
  const scenarioRows = useMemo(() => {
    const live = new Set(events.filter((event) => event.enabled).map((event) => event.id));
    const saved = scenarios.map((scenario) => {
      const savedPlan = migratePlan(scenario.plan);
      const on = new Set(scenario.enabledEventIds);
      const resolved = resolveWith(
        savedPlan,
        events.map((event) => ({ ...event, enabled: on.has(event.id) }))
      );
      // "In use" when the live plan is this one: the same assumptions, and the
      // same events on among those that still exist.
      const sameEvents = events.every((event) => on.has(event.id) === live.has(event.id));
      return {
        key: scenario.id,
        label: scenario.name,
        retirementAge: savedPlan.retirementAge,
        projection: resolved.projection,
        netWorth: resolved.netWorth,
        scenario,
        inUse: sameEvents && sameRecord(savedPlan, plan),
      };
    });
    return [
      {
        key: "current",
        label: "Current plan",
        retirementAge: plan.retirementAge,
        projection,
        netWorth,
        scenario: null,
        inUse: false,
      },
      ...saved,
    ];
  }, [scenarios, events, plan, projection, netWorth, resolveWith]);

  // The current plan with one rate a point either way. Under a stock/bond
  // mix, `growthRateBps`/`drawdownRateBps` are derived and no longer read —
  // nudging `equityReturnBps`/`bondReturnBps` instead is the same table
  // asking the same question of the figures the plan actually uses.
  const sensitivity = useMemo(() => {
    if (!projection.ready) return [];
    const moves = byMix
      ? [
          { field: "equityReturnBps", label: "Expected equity return" },
          { field: "bondReturnBps", label: "Expected bond return" },
          { field: "inflationRateBps", label: "Inflation" },
        ]
      : [
          { field: "growthRateBps", label: "Returns while saving" },
          { field: "drawdownRateBps", label: "Returns once retired" },
          { field: "inflationRateBps", label: "Inflation" },
        ];
    const rows = [{ key: "base", label: "As planned", projection, netWorth }];
    for (const move of moves) {
      for (const delta of [100, -100]) {
        const value = plan[move.field] + delta;
        if (value < 0) continue;
        const resolved = resolveWith({ ...plan, [move.field]: value });
        rows.push({
          key: `${move.field}${delta}`,
          label: `${move.label} ${formatBps(value)} (${delta > 0 ? "+" : "−"}1 point)`,
          projection: resolved.projection,
          netWorth: resolved.netWorth,
        });
      }
    }
    return rows;
  }, [plan, projection, netWorth, resolveWith, byMix]);

  const { goals } = useSavingsGoals();
  // One modal for adding and editing, the savings-goals page's arrangement:
  // `editing` is the record, `seed` what a new one starts from.
  const [eventModal, setEventModal] = useState({ show: false, editing: null, seed: null });
  // Its own, because it writes its event rather than seeding the form above:
  // the claiming arithmetic is the form. See `SocialSecurityModal`.
  const [socialSecurity, setSocialSecurity] = useState(false);
  // What a sale can name: the property accounts, and every home an event buys.
  const saleOptions = [
    ...propertyOptions,
    ...events
      .filter((event) => event.kind === LIFE_EVENT_KINDS.BUY_PROPERTY)
      .map((event) => ({ id: event.id, name: event.name })),
  ];
  const propertyNames = Object.fromEntries(saleOptions.map((option) => [option.id, option.name]));

  // Every mutator reports `{ ok, error }`; this puts the error in the panel
  // that sent it and hands the result back, so a form can keep what was typed.
  const report = (setError, mutate) => (changes) => {
    const result = mutate(changes);
    setError(result.ok ? null : result.error);
    return result;
  };
  const commit = (setError) => report(setError, setRetirementPlan);

  // The money a year of retirement can be paid from — everything but the
  // house — which is what the outlook measures against what is needed.
  const savingsSeries = netWorth.series.map((point) => ({
    age: point.age,
    phase: point.phase,
    balanceCents: point.liquidCents,
  }));

  return (
    <>
      <PageHeader
        title="Retirement planning"
        description="Start with your timeline, savings, and spending. See how they shape your retirement."
        actions={
          <Button variant="danger" onClick={resetRetirementPlan}>
            Reset plan
          </Button>
        }
      />

      <div className="space-y-4">
        <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
          <RetirementPlanInputs
            plan={plan}
            inputs={inputs}
            projection={projection}
            accountRows={accountRows}
            startingError={startingError}
            assumptionsError={assumptionsError}
            onStartingChange={commit(setStartingError)}
            onChange={commit(setAssumptionsError)}
            onToggleAccount={({ accountId, included }) =>
              toggleRetirementAccount({
                accountId,
                included,
                shown: accountRows.filter((row) => row.included).map((row) => row.account.id),
              })
            }
          />
          <div id="retirement-projection" tabIndex={-1} className="min-w-0 scroll-mt-5 space-y-3 lg:sticky lg:top-5">
            <RetirementOutlook
              projection={projection}
              inputs={inputs}
              compact
              retirementAge={plan.retirementAge}
            />

            {projection.ready && (
              <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
                  <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
                    Your savings over time
                  </h2>
                  <SegmentedControl
                    label="How to project the plan"
                    options={VIEW_MODES}
                    value={viewMode}
                    onChange={changeViewMode}
                  />
                </div>

                {viewMode === "deterministic" && (
                  <>
                    <div className="border-b border-edge px-4 py-2">
                      <span className="font-mono text-label uppercase text-chalk-soft">
                        Age {plan.currentAge} to {plan.lifeExpectancy} ·{" "}
                        {formatBps(projection.realGrowthBps)} then{" "}
                        {formatBps(projection.realDrawdownBps)} real
                      </span>
                    </div>

                    <RetirementChart
                      series={savingsSeries}
                      targetCents={projection.needCents}
                      retirementAge={plan.retirementAge}
                      depletionAge={projection.depletionAge}
                    />

                    {/* The chart's table twin, as on the net-worth page. Every figure it
                        draws is readable here, which is what stops the hover being the
                        only route to a value on a fifty-year series. */}
                    <details className="border-t border-edge">
                      <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                        Show these figures as a table
                      </summary>
                      <div className="max-h-96 overflow-auto border-t border-edge">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0">
                            <tr className="bg-panel-raised">
                              <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                                Age
                              </th>
                              <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                                Stage
                              </th>
                              <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                                Savings
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {savingsSeries.map((point, index) => (
                              <tr key={point.age} className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                                <th
                                  scope="row"
                                  className="px-4 py-2 text-left font-sans text-row font-normal text-ink"
                                >
                                  {point.age}
                                </th>
                                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-ink-soft">
                                  {point.phase === "saving" ? "Saving" : "Retired"}
                                </td>
                                <td
                                  className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
                                    point.balanceCents === 0 ? "text-vermilion-ink" : "text-ink"
                                  }`}
                                >
                                  {formatCents(point.balanceCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}

                {viewMode !== "deterministic" && !byMix && (
                  <p className="px-4 py-5 font-sans text-row text-chalk-soft">
                    A Monte Carlo trial or a historical year needs something to vary — switch
                    "Where the money is invested" below to a stock/bond mix to turn this on.
                  </p>
                )}

                {viewMode !== "deterministic" && byMix && (
                  <div className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <button
                        type="button"
                        onClick={runCurrentSimulation}
                        disabled={simulation.loading}
                        className="rounded-lg border border-edge bg-panel-raised px-3 py-1.5 font-mono text-label uppercase text-chalk transition-colors hover:bg-edge disabled:opacity-50"
                      >
                        {simulation.loading ? "Running…" : "Run simulation"}
                      </button>
                      {viewMode === "monte-carlo" && (
                        <span className="font-mono text-label uppercase text-chalk-soft">
                          {plan.simulationTrials} trials
                        </span>
                      )}
                      {/* Unlike every other figure on this page, a batch does not
                          recompute as the plan is edited — see the note on
                          `runSimulation` in `useRetirementProjection.js`. */}
                      <span className="font-sans text-row text-chalk-soft">
                        Does not update as you change the plan — run it again after editing.
                      </span>
                    </div>

                    {simulation.error && (
                      <p role="alert" className="mt-3 font-sans text-row text-vermilion">
                        {simulation.error}
                      </p>
                    )}

                    {simulation.result && (
                      <div className="mt-4">
                        <RetirementFanChart
                          percentilesByAge={simulation.result.percentilesByAge}
                          deterministicSeries={savingsSeries}
                          targetCents={projection.needCents}
                          retirementAge={plan.retirementAge}
                          successRate={simulation.result.successRate}
                        />

                        {viewMode === "historical" && (
                          <details className="border-t border-edge">
                            <summary className="cursor-pointer px-4 py-2.5 font-mono text-label uppercase text-chalk-soft transition-colors hover:text-chalk">
                              Show every historical starting year
                            </summary>
                            <div className="max-h-96 overflow-auto border-t border-edge">
                              <table className="w-full border-collapse">
                                <thead className="sticky top-0">
                                  <tr className="bg-panel-raised">
                                    <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                                      Retired in
                                    </th>
                                    <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                                      Outcome
                                    </th>
                                    <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                                      Ending balance
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {simulation.result.cohorts.map((cohort, index) => (
                                    <tr
                                      key={cohort.startYear}
                                      className={index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}
                                    >
                                      <th
                                        scope="row"
                                        className="px-4 py-2 text-left font-sans text-row font-normal text-ink"
                                      >
                                        {cohort.startYear}
                                      </th>
                                      <td
                                        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase ${
                                          cohort.shortfallAge == null ? "text-ink-soft" : "text-vermilion-ink"
                                        }`}
                                      >
                                        {cohort.shortfallAge == null
                                          ? "Lasted"
                                          : `Ran out at ${cohort.shortfallAge}`}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums text-ink">
                                        {formatCents(cohort.atEndCents)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            <p className="px-1 font-sans text-row text-chalk-soft">
              Assumed returns: {formatBps(returnRates.growthRateBps)} while saving and {formatBps(returnRates.drawdownRateBps)} once retired.
              Inflation: {formatBps(plan.inflationRateBps)}. All results are in today's dollars.
              {" "}<a href="#retirement-details" className="text-azure underline underline-offset-2">Review assumptions below</a>.
            </p>
          </div>
        </div>

        <div id="retirement-details" className="scroll-mt-6">
          <h2 className="font-sans text-lg font-semibold text-chalk">Make it your own</h2>
          <p className="mt-1 font-sans text-row text-chalk-soft">Once the basics look right, add detail and explore what could change.</p>
        </div>

        <details className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-4 font-sans text-base font-semibold text-chalk hover:bg-panel-raised">
            Investment returns & inflation
            <span className="mt-1 block text-row font-normal text-chalk-soft">Review the rates behind your projection or model a stock and bond mix.</span>
          </summary>
          <RetirementAssumptionsPanel
            plan={plan}
            projection={projection}
            error={investmentError}
            onChange={commit(setInvestmentError)}
          />
        </details>

        <details className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-4 font-sans text-base font-semibold text-chalk hover:bg-panel-raised">
            Net worth by age
            <span className="mt-1 block text-row font-normal text-chalk-soft">See cash, investments, property, and debt across your lifetime.</span>
          </summary>
          <div className="border-t border-edge p-3 sm:p-4">
            {netWorth.ready && (
              <NetWorthProjection
                projection={netWorth}
                retirementAge={plan.retirementAge}
                lifeExpectancy={plan.lifeExpectancy}
              />
            )}
            {!netWorth.ready && <p className="font-sans text-row text-chalk-soft">Complete your timeline and retirement spending to see your net worth by age.</p>}

          </div>
        </details>

        <details className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-4 font-sans text-base font-semibold text-chalk hover:bg-panel-raised">
            Life events & retirement income
            <span className="mt-1 block text-row font-normal text-chalk-soft">Add Social Security, a pension, a move, or other changes to the plan.</span>
          </summary>
          <div className="border-t border-edge p-3 sm:p-4">
            <LifeEventsPanel
              plan={plan}
              events={events}
              goals={goals}
              propertyNames={propertyNames}
              onAdd={(seed) => setEventModal({ show: true, editing: null, seed })}
              onAddSocialSecurity={() => setSocialSecurity(true)}
              onEdit={(event) => setEventModal({ show: true, editing: event, seed: null })}
              onToggle={setLifeEventEnabled}
              onRemove={deleteLifeEvent}
            />

          </div>
        </details>

        <details className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-4 font-sans text-base font-semibold text-chalk hover:bg-panel-raised">
            Income, taxes & other assets
            <span className="mt-1 block text-row font-normal text-chalk-soft">Review salary growth, taxes, property, cash returns, and debt payments.</span>
          </summary>
          <div className="border-t border-edge p-3 sm:p-4">
            <ProjectionAssumptionsPanel
              plan={plan}
              inputs={inputs}
              debtRows={debtRows}
              projection={netWorth}
              error={projectionError}
              onChange={commit(setProjectionError)}
              onAddSalary={report(setProjectionError, addSalary)}
              onUpdateSalary={report(setProjectionError, updateSalary)}
              onRemoveSalary={report(setProjectionError, removeSalary)}
              onDebtChange={report(setProjectionError, setDebtAssumption)}
            />

          </div>
        </details>

        <AddLifeEventModal
          show={eventModal.show}
          event={eventModal.editing}
          seed={eventModal.seed}
          propertyOptions={saleOptions.filter((option) => option.id !== eventModal.editing?.id)}
          debtOptions={debtOptions}
          handleClose={() => setEventModal((current) => ({ ...current, show: false }))}
        />

        <SocialSecurityModal show={socialSecurity} handleClose={() => setSocialSecurity(false)} />

        <details className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <summary className="cursor-pointer px-5 py-4 font-sans text-base font-semibold text-chalk hover:bg-panel-raised">
            Compare scenarios
            <span className="mt-1 block text-row font-normal text-chalk-soft">Save alternatives and see how changes in returns or inflation affect the result.</span>
          </summary>
          <div className="border-t border-edge p-3 sm:p-4">
            <ScenariosPanel
              rows={scenarioRows}
              sensitivity={sensitivity}
              error={scenarioError}
              onSave={report(setScenarioError, (name) =>
                saveScenario({ name, plan, enabledEventIds })
              )}
              onUse={report(setScenarioError, (scenario) => {
                replaceRetirementPlan(scenario.plan);
                return setEnabledEvents(scenario.enabledEventIds);
              })}
              onUpdate={report(setScenarioError, (scenario) =>
                updateScenario({ id: scenario.id, plan, enabledEventIds })
              )}
              onRemove={report(setScenarioError, deleteScenario)}
            />
          </div>
        </details>

      </div>
    </>
  );
}
