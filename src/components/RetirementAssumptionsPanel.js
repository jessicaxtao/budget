import { MAX_AGE, RETURN_SOURCES, SPENDING_SOURCES } from "../contexts/RetirementContext";
import { effectiveReturnRates } from "../hooks/useRetirementProjection";
import SourceChoice from "./SourceChoice";
import { formatBps, formatCents } from "../utils";

/** Shared blur-committed fields for the guided setup and investment details.
 * Rates entered here are nominal; the projection displays today's dollars.
 * Each field keeps its stored seed so opening a section never writes a value.
 */

export const labelClass = "mb-1.5 block text-label uppercase text-chalk-soft";

export const inputClass =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

export const noteClass = "mt-1.5 font-sans text-row text-chalk-soft";

// Distinct from the starting point's two options — see the note there.
const SPENDING_OPTIONS = [
  { value: SPENDING_SOURCES.INCOME_SHARE, label: "A share of what I earn now" },
  { value: SPENDING_SOURCES.MANUAL, label: "A yearly figure I enter" },
];

const RETURN_OPTIONS = [
  { value: RETURN_SOURCES.MANUAL, label: "A flat rate I enter" },
  { value: RETURN_SOURCES.MIX, label: "A stock/bond mix" },
];

export function Block({ title, hint, children }) {
  return (
    <section className="border-t border-edge px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-label uppercase text-chalk">{title}</h3>
        {hint && <span className="text-label uppercase text-chalk-soft">{hint}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A figure field that commits on blur and re-seeds from the store. `seed` is
 * what is stored, and doubles as the key — see the note above.
 *
 * The ages are `type="number"` — a whole year, with nothing to punctuate. Money
 * and rates are not: a number input refuses "$120,000" and "7%" outright, where
 * `toCents` and `toBps` read both. The store checks the figure either way, which
 * is where it has to be checked.
 *
 * The note sits *outside* the label and is tied to the input by
 * `aria-describedby`. Nesting it would fold a sentence of help into the field's
 * accessible name, so a screen reader would announce "Share of income, the usual
 * rule of thumb: the mortgage is paid off and you stop saving for this" every
 * time focus landed on the box — and nothing could find the field by its name.
 */
export function Field({ label, seed, onCommit, note, ...props }) {
  const noteId = `retirement-${label.toLowerCase().replace(/[^a-z]+/g, "-")}-note`;

  return (
    <div>
      <label className="block">
        <span className={labelClass}>{label}</span>
        <input
          key={`${label}-${seed ?? ""}`}
          defaultValue={seed ?? ""}
          className={inputClass}
          aria-describedby={note ? noteId : undefined}
          onBlur={(event) => onCommit(event.target.value)}
          {...props}
        />
      </label>
      {note && (
        <p id={noteId} className={noteClass}>
          {note}
        </p>
      )}
    </div>
  );
}

/** Cents as the dollars the field asks for, and blank for a figure nobody has
 *  stated — which is not the same as zero, and must not seed the box as one. */
export const asDollars = (cents) => (cents == null ? "" : cents / 100);

export default function RetirementAssumptionsPanel({
  plan,
  projection,
  error,
  onChange,
}) {
  const byMix = plan.returnSource === RETURN_SOURCES.MIX;

  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Investment assumptions
        </h2>
        <span className="text-label uppercase text-chalk-soft">
          Rates before inflation
        </span>
      </div>

      <Block title="What the money does" hint="Nominal rates, before inflation">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field
            label="Inflation"
            type="text"
            inputMode="decimal"
            placeholder="2.5"
            seed={plan.inflationRateBps / 100}
            onCommit={(inflationRateBps) => onChange({ inflationRateBps })}
            note="Every figure on this page is in today's dollars, which is what this buys."
          />
          {!byMix && (
            <>
              <Field
                label="Return while saving"
                type="text"
                inputMode="decimal"
                placeholder="10"
                seed={plan.growthRateBps / 100}
                onCommit={(growthRateBps) => onChange({ growthRateBps })}
                note={`${formatBps(projection.realGrowthBps)} a year after inflation. Ten before it, not the seven usually quoted — that figure is already net of inflation, and this one is not.`}
              />
              <Field
                label="Return once retired"
                type="text"
                inputMode="decimal"
                placeholder="5.5"
                seed={plan.drawdownRateBps / 100}
                onCommit={(drawdownRateBps) => onChange({ drawdownRateBps })}
                note={`${formatBps(projection.realDrawdownBps)} a year after inflation.`}
              />
            </>
          )}
        </div>
      </Block>

      <Block
        title="Where the money is invested"
        hint={byMix ? "Nominal rates, before inflation" : undefined}
      >
        <SourceChoice
          name="retirement-return-source"
          legend="How the invested-pot return is worked out"
          value={plan.returnSource}
          options={RETURN_OPTIONS}
          onChange={(returnSource) => onChange({ returnSource })}
        />

        {byMix && (
          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field
              label="Equity share while saving"
              type="text"
              inputMode="decimal"
              placeholder="80"
              seed={plan.equityShareBps / 100}
              onCommit={(equityShareBps) => onChange({ equityShareBps })}
            />
            <Field
              label="Equity share once retired"
              type="text"
              inputMode="decimal"
              placeholder="50"
              seed={plan.equityShareRetiredBps / 100}
              onCommit={(equityShareRetiredBps) => onChange({ equityShareRetiredBps })}
            />
            <Field
              label="Expected equity return"
              type="text"
              inputMode="decimal"
              placeholder="10.5"
              seed={plan.equityReturnBps / 100}
              onCommit={(equityReturnBps) => onChange({ equityReturnBps })}
            />
            <Field
              label="Equity volatility"
              type="text"
              inputMode="decimal"
              placeholder="18"
              seed={plan.equityVolatilityBps / 100}
              onCommit={(equityVolatilityBps) => onChange({ equityVolatilityBps })}
              note="How much a single year's return typically swings from the expected figure — what a Monte Carlo trial draws around."
            />
            <Field
              label="Expected bond return"
              type="text"
              inputMode="decimal"
              placeholder="4.5"
              seed={plan.bondReturnBps / 100}
              onCommit={(bondReturnBps) => onChange({ bondReturnBps })}
            />
            <Field
              label="Bond volatility"
              type="text"
              inputMode="decimal"
              placeholder="7"
              seed={plan.bondVolatilityBps / 100}
              onCommit={(bondVolatilityBps) => onChange({ bondVolatilityBps })}
            />
            <Field
              label="Stock/bond correlation"
              type="text"
              inputMode="decimal"
              placeholder="0"
              seed={plan.returnCorrelationBps / 100}
              onCommit={(returnCorrelationBps) => onChange({ returnCorrelationBps })}
              note="How the two move together in a bad year. Zero unless you have a specific figure in mind."
            />
            <div>
              <span className={labelClass}>Comes to</span>
              <div className="border-b-2 border-transparent py-1.5 font-mono text-lg text-chalk">
                {formatBps(effectiveReturnRates(plan).growthRateBps)} while saving,{" "}
                {formatBps(effectiveReturnRates(plan).drawdownRateBps)} once retired
              </div>
              <p className={noteClass}>
                {formatBps(projection.realGrowthBps)} and {formatBps(projection.realDrawdownBps)} a
                year after inflation — what the deterministic figures above use, and what a
                simulation draws around instead of holding flat.
              </p>
            </div>
          </div>
        )}
      </Block>

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}

export function RetirementTimelineInputs({ plan, projection, onChange }) {
  return (
    <Block title="When would you like to retire?">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Field
          label="Age today"
          type="number"
          min={0}
          max={MAX_AGE}
          step={1}
          seed={plan.currentAge}
          onCommit={(currentAge) => onChange({ currentAge })}
        />
        <Field
          label="Retire at"
          type="number"
          min={0}
          max={MAX_AGE}
          step={1}
          placeholder="65"
          seed={plan.retirementAge}
          onCommit={(retirementAge) => onChange({ retirementAge })}
        />
        <Field
          label="Money lasts to"
          type="number"
          min={0}
          max={MAX_AGE}
          step={1}
          placeholder="90"
          seed={plan.lifeExpectancy}
          onCommit={(lifeExpectancy) => onChange({ lifeExpectancy })}
          note={
            projection.yearsInRetirement == null
              ? null
              : `${projection.yearsInRetirement} years of retirement to pay for`
          }
        />
      </div>
    </Block>
  );
}

export function RetirementSpendingInputs({ plan, inputs, onChange }) {
  const byShare = plan.spendingSource === SPENDING_SOURCES.INCOME_SHARE;
  return (
    <Block title="What retirement costs" hint="A year, today's dollars">
      <SourceChoice
        name="retirement-spending-source"
        legend="How retirement spending is worked out"
        value={plan.spendingSource}
        options={SPENDING_OPTIONS}
        onChange={(spendingSource) => onChange({ spendingSource })}
      />

      <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4">
        {byShare ? (
          <>
            <Field
              label="Share of income"
              type="text"
              inputMode="decimal"
              placeholder="70"
              seed={plan.incomeShareBps / 100}
              onCommit={(incomeShareBps) => onChange({ incomeShareBps })}
              note="Adjust this estimate for housing, healthcare, travel, and other retirement costs."
            />
            <div>
              <span className={labelClass}>Comes to</span>
              <div className="border-b-2 border-transparent py-1.5 font-mono text-lg text-chalk">
                {formatCents(inputs.shareSpendingCents)}
              </div>
              <p className={noteClass}>
                {inputs.incomeAnnualCents > 0 ? (
                  <>
                    {formatBps(plan.incomeShareBps)} of the{" "}
                    {formatCents(inputs.incomeAnnualCents)} a year your plan expects.
                  </>
                ) : (
                  <>Add your income sources on the budget plan, or enter a figure instead.</>
                )}
              </p>
            </div>
          </>
        ) : (
          <Field
            label="Yearly spending"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            seed={asDollars(plan.annualSpendingCents)}
            onCommit={(annualSpendingCents) => onChange({ annualSpendingCents })}
            note={
              inputs.incomeAnnualCents > 0
                ? `Your income today is ${formatCents(inputs.incomeAnnualCents)} a year.`
                : null
            }
          />
        )}
      </div>
    </Block>
  );
}

export function RetirementContributionInputs({ plan, inputs, onChange }) {
  return (
    <Block title="How much will you add?" hint="Each year">
      <div className="space-y-4">
        <Field
          label="Pretax contributions"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          seed={asDollars(plan.pretaxContributionCents)}
          onCommit={(pretaxContributionCents) => onChange({ pretaxContributionCents })}
          note="Yearly payroll retirement deductions, such as a 401(k). Added to your budget contributions unless you override the total below."
        />
        <Field
          label="Saving each year"
          type="text"
          inputMode="decimal"
          // The plan's own savings figure, shown as the placeholder rather
          // than seeded into the field: a seeded value would become a typed
          // one the moment anything else was edited, and the link back to the
          // budget would be silently cut.
          placeholder={inputs.plannedContributionCents / 100}
          seed={asDollars(plan.annualContributionCents)}
          onCommit={(annualContributionCents) => onChange({ annualContributionCents })}
          note={
            inputs.contributionSeeded
              ? inputs.pretaxContributionCents > 0
                ? `Using ${formatCents(inputs.plannedContributionCents)} — ${formatCents(
                    inputs.budgetContributionCents
                  )} from your retirement categories plus ${formatCents(
                    inputs.pretaxContributionCents
                  )} pretax. Enter a figure to override it.`
                : `Using ${formatCents(inputs.plannedContributionCents)} — what your retirement categories add up to. Enter a figure to override it.`
              : "Clear this to go back to what your retirement categories and pretax contributions add up to."
          }
        />
      </div>
    </Block>
  );
}
