import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import Field, { SelectField } from "./Field";
import Button from "./Button";
import { useLifeEvents } from "../contexts/LifeEventsContext";
import {
  CLAIM_AGES,
  EARLIEST_CLAIM_AGE,
  FULL_RETIREMENT_AGE,
  LATEST_CLAIM_AGE,
  annualBenefitCents,
  claimShareBps,
  socialSecurityEvent,
} from "../domain/socialSecurity";
import { amountEditing, formatBps, formatCents, toCents } from "../utils";

/**
 * Social Security, stated once and written out as an ordinary income event.
 *
 * **A bespoke entry path for a record that is not bespoke at all.** The general
 * event form could hold this — it is income, from an age, for the rest of the
 * plan — and before this modal that is exactly how it was entered, from a
 * template seeded with a round $24,000. What the general form cannot do is the
 * claiming arithmetic: the household knows the figure on its statement and the
 * age it is thinking of, and the benefit those two come to is a statutory
 * adjustment nobody should be asked to apply by hand. So this asks the two
 * questions and `src/socialSecurity.js` answers the third.
 *
 * **It seeds and does not keep.** The monthly benefit and the claiming age are
 * inputs to a figure, not fields on the record, so they are not stored and this
 * modal does not reopen on an event that exists — the row's own Edit button
 * opens the general form, where the event is an income event like any other.
 * That is `seedFromGoal`'s contract, for `seedFromGoal`'s reason: a copy made
 * once cannot drift from a source it no longer has, and a second store of the
 * same money is the thing the dependency graph here is shaped to avoid.
 *
 * **Controlled, where every other form in this app is uncontrolled.** The
 * readout below the select is the whole point of the form — the figures have to
 * move as the age does, or the trade-off the modal exists to show is invisible.
 * The re-seed on open is the same discipline as everywhere else, just through
 * state rather than a ref.
 */

const noteClass = "-mt-3 mb-5 font-sans text-row text-chalk-soft";

/** The three ages that say what the choice is worth, for the figures beside the
 *  one chosen. The full nine would be a lookup table; these are the argument. */
const ANCHORS = [EARLIEST_CLAIM_AGE, FULL_RETIREMENT_AGE, LATEST_CLAIM_AGE];

export default function SocialSecurityModal({ show, handleClose }) {
  const [benefit, setBenefit] = useState("");
  const [claimAge, setClaimAge] = useState(FULL_RETIREMENT_AGE);
  const [error, setError] = useState(null);

  const { addLifeEvent } = useLifeEvents();

  useEffect(() => {
    if (!show) return;
    setBenefit("");
    setClaimAge(FULL_RETIREMENT_AGE);
    setError(null);
  }, [show]);

  // Blank while nothing is typed, rather than zero: the readout has nothing to
  // say yet, and $0.00 a month would read as an answer.
  const monthlyCents = toCents(benefit);
  const stated = monthlyCents != null && monthlyCents > 0;
  const shareBps = claimShareBps(claimAge);
  const annualCents = stated ? annualBenefitCents(monthlyCents, claimAge) : null;

  function handleSubmit(submitted) {
    submitted.preventDefault();
    if (!stated) {
      setError("Enter the monthly benefit from your statement as an amount more than zero.");
      return;
    }
    const event = socialSecurityEvent({ monthlyBenefitCents: monthlyCents, claimAge });
    const result = addLifeEvent({
      name: event.name,
      kind: event.kind,
      startAge: String(event.startAge),
      years: "",
      annual: amountEditing(event.annualCents),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title="Social Security">
      <form onSubmit={handleSubmit}>
        <Field
          label={`Benefit at full retirement age (${FULL_RETIREMENT_AGE})`}
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          value={benefit}
          onChange={(change) => setBenefit(change.target.value)}
        />
        <p className={noteClass}>
          A month, before the adjustment for claiming early or late. Your statement at{" "}
          <span className="text-chalk">ssa.gov/myaccount</span> has this figure — it depends on
          your earnings record, so it is the one number here that cannot be worked out from the
          rest of your plan.
        </p>

        <SelectField
          label="Claim at age"
          value={claimAge}
          onChange={(change) => setClaimAge(Number(change.target.value))}
        >
          {CLAIM_AGES.map((age) => (
            <option key={age} value={age}>
              {age}
            </option>
          ))}
        </SelectField>

        {/* A table and not a list of pairs: three money figures the reader is
            meant to compare down the column is what a table is for, and it is
            the one markup that gives the block a name every reader gets rather
            than only the ones using a screen reader. The chosen age leads it;
            the two anchors below are the argument for choosing differently. */}
        <table className="mb-5 w-full rounded-lg border border-edge bg-panel-raised">
          <caption className="mb-2 text-left text-label uppercase text-chalk-soft">
            What claiming at that age pays
          </caption>
          <tbody>
            <tr className="border-b border-edge">
              <th
                scope="row"
                className="px-3 py-2 text-left font-sans text-row font-normal text-chalk"
              >
                At {claimAge} — {formatBps(shareBps)} of the full benefit
              </th>
              <td className="px-3 py-2 text-right font-mono text-row tabular-nums text-chalk">
                {annualCents == null ? (
                  "—"
                ) : (
                  <>
                    {formatCents(annualCents)} a year
                    <span className="block text-label text-chalk-soft">
                      {formatCents(Math.round(annualCents / 12))} a month
                    </span>
                  </>
                )}
              </td>
            </tr>
            {ANCHORS.filter((age) => age !== claimAge).map((age) => (
              <tr key={age} className="text-chalk-soft">
                <th scope="row" className="px-3 py-1.5 text-left font-sans text-row font-normal">
                  At {age} — {formatBps(claimShareBps(age))}
                </th>
                <td className="px-3 py-1.5 text-right font-mono text-row tabular-nums">
                  {stated ? `${formatCents(annualBenefitCents(monthlyCents, age))} a year` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={noteClass}>
          Paid from {claimAge} for the rest of the plan, in today's dollars — the benefit carries
          a cost-of-living adjustment, so holding its value is what it promises. Once you retire
          it is spent before your savings are.
        </p>

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        {/* No Cancel beside it: every dialog here is left through the close
            button in its own title row, and a second way out that only this
            form offers makes a reader stop and work out whether they differ. */}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            Add to plan
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
