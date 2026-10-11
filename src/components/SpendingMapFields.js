import { useMemo, useState } from "react";
import Chip from "./Chip";
import { useBudgets } from "../contexts/BudgetsContext";
import { usePayees } from "../contexts/PayeesContext";
import { toSections } from "../planLayout";

const legend = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

/**
 * What spending a promise applies to: all of it, or these categories, or these
 * payees.
 *
 * **One component because it is one question.** A card offer and a card's earn
 * rate both answer it, in the same three fields (`allSpending`, `budgetIds`,
 * `payeeIds`) read by the same `legMatches`, and a second copy of the form
 * would be a second place for the answer's shape to drift.
 *
 * **Controlled, and the one picker in the app that is** — the exception every
 * other form's `useRef` rule allows for interlocking answers, here for two
 * reasons that the earn-rate form forced. A chip is a `<button>` and carries no
 * form value at all, so there is nothing for `FormData` to read; and
 * `AddEarnRateModal` repeats this picker once per rate, where one `name` shared
 * across four rows would hand every row's answer to the first. The caller holds
 * the two id lists and toggles them.
 *
 * **Chips rather than a column of checkboxes** because a card's rate table is
 * four or five of these one under another, and four scrolling lists is not a
 * form anyone fills in. The lists are still **hidden, not unmounted**, while all
 * spending is on, so an answer survives a change of mind and still reaches the
 * store — which keeps it for the same reason. Being controlled is what makes
 * that free: there is no `defaultChecked` to re-seed, so the open counter the
 * checkbox version needed is gone.
 *
 * `note` is optional: a caller that repeats this picker says it once itself,
 * rather than under every row.
 */
export default function SpendingMapFields({
  allLabel,
  allName,
  allSpending,
  onAllSpendingChange,
  budgetIds,
  payeeIds,
  onToggleBudget,
  onTogglePayee,
  note,
}) {
  const { groups, budgets } = useBudgets();
  const { payees } = usePayees();
  // Opened by a payee already named, so an edit shows what it is about to save.
  const [showPayees, setShowPayees] = useState(payeeIds.length > 0);

  const sections = useMemo(
    () => toSections(groups, budgets).filter((section) => section.budgets.length > 0),
    [groups, budgets]
  );
  const sortedPayees = useMemo(
    () => [...payees].sort((a, b) => a.name.localeCompare(b.name)),
    [payees]
  );

  return (
    <>
      <label className="mb-3 flex cursor-pointer items-center gap-2.5">
        {/* `allName` is for a caller that repeats this picker: the row it sits
            in already names itself on screen, so the ordinal belongs in the
            accessible name rather than in the sentence beside the box. */}
        <input
          type="checkbox"
          aria-label={allName}
          checked={allSpending}
          onChange={(event) => onAllSpendingChange(event.target.checked)}
          className="h-3.5 w-3.5 shrink-0 accent-azure"
        />
        <span className="font-sans text-row text-chalk">{allLabel}</span>
      </label>

      {/* The flex classes go on a child: the UA's `[hidden]` rule loses to any
          `display` class, so a hidden flex row is not hidden at all. */}
      <div hidden={allSpending}>
        <fieldset className="mb-3">
          <legend className={legend}>Counts spending in these categories</legend>
          {sections.map((section) => (
            <div key={section.groupId ?? "ungrouped"} className="mb-1.5">
              <div className="mb-1 font-mono text-label uppercase text-chalk-soft/70">
                {section.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {section.budgets.map((budget) => (
                  <Chip
                    key={budget.id}
                    label={budget.name}
                    on={budgetIds.includes(budget.id)}
                    onToggle={() => onToggleBudget(budget.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        {sortedPayees.length > 0 && (
          <fieldset className="mb-3">
            {showPayees ? (
              <>
                <legend className={legend}>…or paid to these payees</legend>
                <div className="flex flex-wrap gap-1.5">
                  {sortedPayees.map((payee) => (
                    <Chip
                      key={payee.id}
                      label={payee.name}
                      on={payeeIds.includes(payee.id)}
                      onToggle={() => onTogglePayee(payee.id)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowPayees(true)}
                className="font-sans text-label uppercase tracking-wide text-chalk-soft underline decoration-edge underline-offset-4 transition-colors hover:text-chalk"
              >
                + or name payees as well
              </button>
            )}
          </fieldset>
        )}
        {note && <p className="mb-5 font-sans text-row text-chalk-soft">{note}</p>}
      </div>
    </>
  );
}
