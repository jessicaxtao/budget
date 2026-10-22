import { useEffect, useState } from "react";
import Button from "./Button";
import { SortableList, useSortableItem } from "./Sortable";
import { currentPeriod, formatCents, formatDateMedium, toCents, toPeriod } from "../utils";

/**
 * The goals recorded so far: what each is saving towards, what has accumulated,
 * and — where there is a target date — how much is needed each month to arrive
 * on time. The month does not appear anywhere: a savings goal is about a total,
 * not a monthly budget line.
 *
 * **`savedCents` is the money that is there, wherever it sits**: the goal's
 * cumulative assignment out of the budget (`availableCents`) plus whatever it
 * holds in off-budget accounts (`heldCents`).
 *
 * Where a goal holds both, **the two are named apart** — the holding under the
 * goal's own name, the assignment under the headline figure — because they are
 * two piles of money and the household is the only thing that can move one into
 * the other.
 */

const TICKS = 24;

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

const COLUMNS = [
  { key: "goal", label: () => "Goal", className: "px-4 text-left" },
  { key: "target", label: () => "Target", className: "px-3 text-right" },
  { key: "saved", label: () => "Saved", className: "px-3 text-right" },
  { key: "remaining", label: () => "Remaining", className: "px-3 text-right" },
  { key: "pace", label: () => "Pace", className: "px-3 text-right" },
  { key: "this-month", label: () => "This month", className: "px-3 text-right" },
  { key: "add", label: () => "Add", className: "px-3 text-right" },
  { key: "actions", label: () => <span className="sr-only">Actions</span>, className: "w-32 px-3" },
];

const FULL_SPAN = COLUMNS.length; // goal, target, saved, this month, remaining, pace, add, actions

const rowBg = (striped) => (striped ? "bg-sheet-alt" : "bg-sheet");

/**
 * Months from `now` (a period string) to the target date's period.
 * Positive = future, zero = this month, negative = past, null = no target date.
 */
function monthsUntil(targetDate, now) {
  const targetPeriod = toPeriod(targetDate);
  if (!targetPeriod || !now) return null;
  const [ty, tm] = now.split("-").map(Number);
  const [gy, gm] = targetPeriod.split("-").map(Number);
  return (gy - ty) * 12 + (gm - tm);
}

function GoalRow({ row, striped, error, onAssign, onEdit, onDelete, sortable }) {
  const item = useSortableItem(row.goalId, { disabled: !sortable });
  const ratio = row.targetCents > 0 ? row.savedCents / row.targetCents : 0;
  const months = monthsUntil(row.targetDate, currentPeriod());
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (confirmation === null) return;
    const id = setTimeout(() => setConfirmation(null), 1500);
    return () => clearTimeout(id);
  }, [confirmation]);

  let paceContent;
  if (row.savedCents >= row.targetCents || months === null) {
    paceContent = <span className="text-ink-soft/40">—</span>;
  } else if (months <= 0) {
    const overdue = Math.abs(months);
    paceContent = (
      <span className="text-vermilion-ink font-mono text-label uppercase">
        {overdue === 0 ? "Due this month" : `${overdue}mo overdue`}
      </span>
    );
  } else {
    const monthlyCents = Math.ceil(row.remainingCents / months);
    const monthsLabel = months === 1 ? "1 month left" : `${months} months left`;
    paceContent = (
      <div>
        <div className="text-ink">{formatCents(monthlyCents)}/mo</div>
        <div className="font-mono text-label uppercase text-ink-soft">{monthsLabel}</div>
      </div>
    );
  }

  function handleBlur(e) {
    const raw = e.target.value.trim();
    if (raw === "") return;
    const delta = toCents(raw);
    // Invalid or zero input — clear the field silently.
    if (delta === null || delta === 0) {
      e.target.value = "";
      return;
    }
    const result = onAssign(row, row.assignedCents + delta);
    e.target.value = "";
    if (result.ok) setConfirmation(delta);
  }

  return (
    <>
      <tr ref={item.ref} style={item.style} {...item.handle} className={rowBg(striped)}>
        <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
          {row.name}
          {row.targetDate && (
            <div className="mt-0.5 font-mono text-label uppercase text-ink-soft">
              By {formatDateMedium(row.targetDate)}
            </div>
          )}
          {row.categoryName && (
            <div className="mt-0.5 font-mono text-label uppercase text-ink-soft">
              Category: {row.categoryName}
            </div>
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
          </div>
        </td>
        <td
          data-label="Remaining"
          className={`${figureClass} ${
            row.remainingCents === 0 ? "font-medium text-verdant" : "text-ink-soft"
          }`}
        >
          {row.remainingCents === 0 ? "Funded" : formatCents(row.remainingCents)}
        </td>
        <td data-label="Pace" className={`${figureClass}`}>
          {paceContent}
        </td>
        <td data-label="This month" className={`${figureClass} ${row.assignedCents ? "text-ink" : "text-ink-soft/40"}`}>
          {row.assignedCents ? formatCents(row.assignedCents) : "—"}
        </td>
        <td data-label="Add" className="px-3 py-2 text-right">
          <input
            key={row.assignedCents}
            id={`savings-goal-add-${row.goalId}`}
            type="text"
            inputMode="decimal"
            defaultValue=""
            placeholder="$0"
            aria-label={`Add to ${row.name}`}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            onBlur={handleBlur}
            className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
          />
          {confirmation !== null && (
            <div
              className={`mt-1 font-mono text-label uppercase ${confirmation > 0 ? "text-verdant" : "text-ink-soft"}`}
            >
              {confirmation > 0 ? "+" : ""}
              {formatCents(confirmation)}
            </div>
          )}
        </td>
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

export default function SavingsGoalList({ rows, onAssign, onEdit, onDelete, onReorder }) {
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
                    {column.label()}
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

    </section>
  );
}
