import { useRef } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";
import RetirementStartingPoint from "./RetirementStartingPoint";
import {
  RetirementTimelineInputs,
  RetirementContributionInputs,
  RetirementSpendingInputs,
} from "./RetirementAssumptionsPanel";
import { formatCents } from "../utils";

/** Disclosure state is local to this view; reviewing a step never writes a plan. */
export default function RetirementPlanInputs({
  plan,
  inputs,
  projection,
  accountRows,
  startingError,
  assumptionsError,
  onStartingChange,
  onChange,
  onToggleAccount,
}) {
  const savings = useRef(null);
  const spending = useRef(null);
  const continueTo = (event, ref) => {
    event.currentTarget.closest("details").open = false;
    ref.current.open = true;
    ref.current.querySelector("summary").focus();
  };
  const summaryClass = "cursor-pointer px-4 py-4 font-sans text-sm font-semibold text-chalk transition-colors hover:bg-panel-raised";
  const subtitleClass = "mt-1 block pl-5 text-row font-normal text-chalk-soft";

  return (
    <section id="retirement-inputs" aria-label="Build your retirement plan" className="min-w-0 overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-4">
        <h2 className="font-sans text-lg font-semibold text-chalk">Build your plan</h2>
        <p className="mt-1 font-sans text-row text-chalk-soft">
          Start with these three steps. Your projection updates when you leave a field.
        </p>
      </div>
      <details open className="border-b border-edge">
        <summary className={summaryClass}>
          1. Your timeline
          <span className={subtitleClass}>
            {plan.currentAge == null ? "Start here: enter your age" : `Age ${plan.currentAge} today · retire at ${plan.retirementAge}`}
          </span>
        </summary>
        <RetirementTimelineInputs plan={plan} projection={projection} onChange={onChange} />
        <div className="px-4 pb-4">
          <Button onClick={(event) => continueTo(event, savings)}>Next: your savings <span aria-hidden="true">→</span></Button>
        </div>
      </details>
      <details ref={savings} className="border-b border-edge">
        <summary className={summaryClass}>
          2. Your savings
          <span className={subtitleClass}>
            {formatCents(inputs.startingCents)} set aside · {formatCents(inputs.annualContributionCents)}/year
          </span>
        </summary>
        <p className="px-4 pb-3 font-sans text-row text-chalk-soft">
          Review the retirement savings already in your accounts, then what you plan to add each year. Enter zero if you are starting from scratch.
        </p>
        <RetirementStartingPoint
          embedded
          plan={plan}
          accountRows={accountRows}
          selectedCents={inputs.selectedCents}
          error={startingError}
          onChange={onStartingChange}
          onToggleAccount={onToggleAccount}
        />
        <RetirementContributionInputs plan={plan} inputs={inputs} onChange={onChange} />
        <div className="mx-4 mb-4 rounded-lg bg-panel-raised p-3 font-sans text-row text-chalk-soft">
          <p className="font-semibold text-chalk">Check your budget, too</p>
          <p className="mt-1">Your budget has {formatCents(inputs.incomeAnnualCents)}/year in take-home income and {formatCents(inputs.spendingCents)}/year in spending. The projection also saves unspent income as cash, so a complete budget matters.</p>
          <Link to="/plan" className="mt-2 inline-block text-azure underline underline-offset-2">Review your budget</Link>
        </div>
        <div className="px-4 pb-4">
          <Button onClick={(event) => continueTo(event, spending)}>Next: retirement spending <span aria-hidden="true">→</span></Button>
        </div>
      </details>
      <details ref={spending}>
        <summary className={summaryClass}>
          3. Retirement spending
          <span className={subtitleClass}>
            {inputs.annualSpendingCents > 0 ? `${formatCents(inputs.annualSpendingCents)}/year in today's dollars` : "Enter a yearly amount or link your income"}
          </span>
        </summary>
        <RetirementSpendingInputs plan={plan} inputs={inputs} onChange={onChange} />
        <p className="px-4 pb-4 font-sans text-row text-chalk-soft">
          Your first projection uses the investment assumptions shown beside it. Refine those below, then add income such as Social Security or a pension.
        </p>
        <a href="#retirement-projection" className="mx-4 mb-4 inline-block font-sans text-sm font-semibold text-azure underline underline-offset-2">
          View your projection <span aria-hidden="true">→</span>
        </a>
      </details>
      {assumptionsError && <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">{assumptionsError}</p>}
    </section>
  );
}
