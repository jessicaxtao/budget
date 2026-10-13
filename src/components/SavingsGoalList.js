import { useState } from "react";
import Button from "./Button";
import { SortableList, useSortableItem } from "./Sortable";
import {
  amountEditing,
  formatCents,
  formatDateMedium,
  formatPeriod,
  toCentsAgainst,
} from "../utils";

/**
 * The goals recorded so far, in the envelope shape: what each is saving
 * towards, what has actually accumulated toward it, and what this period's
 * contribution is — editable right on the row, the same commit-on-blur
 * contract CategoryPlanner's estimate cell uses.
 *
 * **`savedCents` is the money that is there, wherever it sits**: the goal's
 * cumulative assignment out of the budget (`availableCents`, see useEnvelopes'
 * goalRows) plus whatever it holds in the off-budget accounts it names
 * (`heldCents`). A goal has no ledger of its own, so there is no spend or refund
 * to net against either the way a category's balance does.
 *
 * Where a goal holds both, **the two are named apart** — the holding under the
 * goal's own name, the assignment under the headline figure — because they are
 * two piles of money and the household is the only thing that can move one into
 * the other. A single total would hide the one case worth seeing: money assigned
 * *and* already swept into the holding, counted twice until the earmark is taken
 * back off.
 */

const TICKS = 24;

/**
 * Full means the goal is funded, the reverse of TallyGauge's tone — a goal
 * carrying its whole target forward is the point, not a warning. Local
 * rather than a call to GivenMeter or FundedMeter: each of those already
 * reads its own ratio one way, and a shared component serving three readings
 * would be a trap for whichever of the three came next.
 */
function GoalMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-verdant" : ratio >= 0.5 ? "bg-sulfur" : "bg-azure";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <span key={index} className={`h-3 w-[3px] ${index < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}

const figureClass = "whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums";

const headClass = "whitespace-nowrap py-2 font-mono text-label uppercase text-chalk";

/**
 * Every column the table has, in order, so the header and the full-width error
 * row below a rejected edit cannot come to disagree about how many there are —
 * the same rule `TransactionRegister`'s `COLUMNS` list keeps, and the reason the
 * actions column added here later could not leave a stale colspan behind.
 *
 * The label is a function of the period because one column names itself from the
 * month on screen: what has been assigned is a figure *for* a month, unlike the
 * target and the balance beside it, which are standing facts.
 */
const COLUMNS = [
  { key: "goal", label: () => "Goal", className: "px-4 text-left" },
  { key: "target", label: () => "Target", className: "px-3 text-right" },
  // "Saved" rather than "Available": the figure under it is what the goal has,
  // which is no longer only what the budget assigned to it.
  { key: "saved", label: () => "Saved", className: "px-3 text-right" },
  { key: "assigned", label: (period) => formatPeriod(period), className: "px-3 text-right" },
  { key: "remaining", label: () => "Remaining", className: "px-3 text-right" },
  // Edit and Remove, which head nothing a reader needs to see.
  {
    key: "actions",
    label: () => <span className="sr-only">Actions</span>,
    className: "w-32 px-3",
  },
];

const FULL_SPAN = COLUMNS.length;

const rowBg = (striped) => (striped ? "bg-sheet-alt" : "bg-sheet");

/**
 * The raw-under-the-caret face of the period's contribution, and blank for a
 * goal nothing has been put into this month — an untouched row reads as
 * untouched against the "$0" placeholder rather than as a stored zero, which is
 * exactly the row the store prunes. Through `amountEditing` rather than a bare
 * `fromCents` so $1,250.50 seeds as "1250.50" and the column keeps its decimal
 * point; a negative — money pulled back out of an over-funded goal — round-trips
 * through `toCents` unchanged as "-12.50".
 */
const assignedValue = (row) => (row.assignedCents ? amountEditing(row.assignedCents) : "");

/** The id of the one note explaining the contribution cell, tied to every one
 *  of them: a hint repeated per row would be the same sentence read out once
 *  per goal. */
const HINT_ID = "savings-goal-assign-hint";

/**
 * Where a goal's held money is, said under the goal's own name — the column
 * built for a phrase, beside the target date, rather than in the column of
 * figures. Named accounts up to two, counted past that: three account names on
 * one row is a row read for its names rather than its money.
 */
function heldNote(row) {
  if (!row.heldCents) return null;
  const names = (row.holdings ?? []).map((holding) => holding.name);
  const where =
    names.length === 0
      ? null
      : names.length <= 2
        ? names.join(" and ")
        : `${names.length} accounts`;
  return `${formatCents(row.heldCents)} held${where ? ` in ${where}` : ""}`;
}

function GoalRow({ row, period, striped, error, onAssign, onEdit, onDelete, sortable }) {
  const item = useSortableItem(row.goalId, { disabled: !sortable });
  const ratio = row.targetCents > 0 ? row.savedCents / row.targetCents : 0;
  const held = heldNote(row);

  function handleBlur(e) {
    const raw = e.target.value;
    // A blank is "nothing this month", which is the row the store prunes. A
    // figure written with a leading plus is added to what is already there, so
    // another $250 into a goal is "+250" rather than arithmetic done in the
    // reader's head — `toCentsAgainst` is where that rule lives, and a bare
    // minus still states a negative figure, which is how money is pulled back
    // out of a goal that was over-funded.
    const cents = raw.trim() === "" ? 0 : toCentsAgainst(raw, row.assignedCents);
    const result = onAssign(row, cents);
    // Put the stored figure back when the store refuses the typed one — and say
    // why, under the row: a figure that reverts with no explanation reads as the
    // app having lost the edit rather than having refused it.
    if (!result.ok) e.target.value = assignedValue(row);
  }

  return (
    <>
      <tr ref={item.ref} style={item.style} {...item.handle} className={rowBg(striped)}>
        <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
          {row.name}
          {/* Through `formatDateMedium`, carrying the year, like every other
              date in the app that can be a long way from today — a goal's
              target date is years out as often as it is months. */}
          {row.targetDate && (
            <div className="mt-0.5 font-mono text-label uppercase text-ink-soft">
              By {formatDateMedium(row.targetDate)}
            </div>
          )}
          {held && (
            <div className="mt-0.5 font-mono text-label uppercase text-ink-soft">{held}</div>
          )}
        </th>
        <td data-label="Target" className={`${figureClass} text-ink-soft`}>
          {formatCents(row.targetCents)}
        </td>
        <td data-label="Saved" className={figureClass}>
          <div>
            <div className="font-medium text-ink">{formatCents(row.savedCents)}</div>
            <div className="mt-1 flex justify-end">
              <GoalMeter
                ratio={ratio}
                label={`${Math.round(Math.min(ratio, 1) * 100)} percent of the way to ${row.name}`}
              />
            </div>
            {/* Only where there is held money to tell it apart from: on every
                other goal the two figures are the same one, and printing it
                twice would read as two facts. */}
            {held && (
              <div className="mt-1 font-mono text-label uppercase text-ink-soft">
                {formatCents(row.availableCents)} assigned
              </div>
            )}
          </div>
        </td>
        <td data-label={formatPeriod(period)} className="px-3 py-2 text-right">
          {/* Keyed on the stored figure, like every other blur-commit field
              here: a rejected edit is put back, and a change made elsewhere
              (there is nowhere else yet, but the contract is the same one
              every other row-level field in the app keeps) re-seeds it. */}
          <input
            key={row.assignedCents}
            type="text"
            inputMode="decimal"
            defaultValue={assignedValue(row)}
            placeholder="$0"
            aria-label={`Assign to ${row.name} this period`}
            aria-describedby={HINT_ID}
            onBlur={handleBlur}
            className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
          />
        </td>
        <td
          data-label="Remaining"
          className={`${figureClass} ${
            row.remainingCents === 0 ? "font-medium text-verdant" : "text-ink-soft"
          }`}
        >
          {row.remainingCents === 0 ? "Funded" : formatCents(row.remainingCents)}
        </td>
        {/* Editing before removing, and drawn as a button where Remove is bare
            text, the same reading order AccountList gives the same pair: the
            quiet one is the destructive one. */}
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="row-action"
              size="sm"
              aria-label={`Edit goal: ${row.name}`}
              onClick={() => onEdit(row)}
            >
              Edit
            </Button>
            <Button
              variant="row"
              size="sm"
              aria-label={`Remove goal: ${row.name}`}
              onClick={() => onDelete(row)}
            >
              Remove
            </Button>
          </div>
        </td>
      </tr>
      {/* Under the row rather than beside it, so a rejected edit does not change
          the width of a column the eye is reading down. `vermilion-ink`, not
          `vermilion`: this sits on the light sheet, where the dark-chrome
          accents are too pale to read. */}
      {error && (
        <tr className={rowBg(striped)}>
          <td colSpan={FULL_SPAN} className="px-3 pb-2">
            <p role="alert" className="font-sans text-row text-vermilion-ink">
              {error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * `onReorder`, where given, lets a goal be dragged to a new place in the list —
 * anywhere on the row but the contribution field, which is for typing in.
 */
export default function SavingsGoalList({ rows, period, onAssign, onEdit, onDelete, onReorder }) {
  // One at a time, keyed on the row it belongs to: a rejection is a reply to the
  // edit just made, and a page of stale messages from earlier attempts would say
  // nothing about the cell the user is in. The same contract
  // `TransactionRegister` and `DonationList` keep.
  const [error, setError] = useState(null);

  function commit(row, cents) {
    const result = onAssign(row, cents);
    setError(result.ok ? null : { id: row.goalId, message: result.error });
    return result;
  }

  return (
    <section
      aria-label="Savings goals"
      className="overflow-hidden rounded-2xl border border-edge bg-panel"
    >
      <div className="border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Goals</h2>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No savings goals yet. Add one for anything expected to exceed the normal budget — a
          camera, a wedding, a special event.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="stack w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                {COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={`${headClass} ${column.className}`}>
                    {column.label(period)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SortableList
                ids={rows.map((row) => row.goalId)}
                onReorder={onReorder ?? (() => {})}
              >
                {rows.map((row, index) => (
                  <GoalRow
                    key={row.goalId}
                    row={row}
                    period={period}
                    striped={index % 2 === 1}
                    error={error?.id === row.goalId ? error.message : null}
                    onAssign={commit}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    sortable={onReorder != null}
                  />
                ))}
              </SortableList>
            </tbody>
          </table>
        </div>
      )}

      {/* Said once, under the table, and tied to every contribution cell by
          `aria-describedby`: the plus is the whole reason the cell no longer
          asks the reader to add up what is already in it. */}
      {rows.length > 0 && (
        <p
          id={HINT_ID}
          className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft"
        >
          Type a figure in the {formatPeriod(period)} column to set this month's contribution, or
          start it with a plus — <span className="font-mono text-chalk">+250</span> — to add that
          much to what is already there.
        </p>
      )}
    </section>
  );
}
