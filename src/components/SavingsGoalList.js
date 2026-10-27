import { useEffect, useState } from "react";
import Button from "./Button";
import SavingsGoalEnvelope from "./SavingsGoalEnvelope";
import { SortableList, useSortableItem } from "./Sortable";
import { currentPeriod, formatCents, formatDateMedium, toCents, toPeriod } from "../utils";

function monthsUntil(targetDate, now) {
  const target = toPeriod(targetDate);
  if (!target || !now) return null;
  const [ty, tm] = now.split("-").map(Number);
  const [gy, gm] = target.split("-").map(Number);
  return (gy - ty) * 12 + gm - tm;
}

function GoalCard({ row, onAssign, onEdit, onDelete, error, sortable }) {
  const item = useSortableItem(row.goalId, { disabled: !sortable });
  const [confirmation, setConfirmation] = useState(null);
  const ratio = row.targetCents > 0 ? row.savedCents / row.targetCents : 0;
  const months = monthsUntil(row.targetDate, currentPeriod());

  useEffect(() => {
    if (confirmation === null) return;
    const id = setTimeout(() => setConfirmation(null), 1500);
    return () => clearTimeout(id);
  }, [confirmation]);

  function handleBlur(event) {
    const raw = event.target.value.trim();
    if (!raw) return;
    const delta = toCents(raw);
    if (delta === null || delta === 0) { event.target.value = ""; return; }
    const result = onAssign(row, row.assignedCents + delta);
    event.target.value = "";
    if (result.ok) setConfirmation(delta);
  }

  const pace = row.savedCents >= row.targetCents || months === null ? null : months <= 0
    ? (months === 0 ? "Due this month" : `${Math.abs(months)}mo overdue`)
    : `${formatCents(Math.ceil(row.remainingCents / months))}/mo · ${months} ${months === 1 ? "month" : "months"} left`;

  return (
    <article ref={item.ref} style={item.style} {...item.handle} className={`relative min-w-0 rounded-xl border border-edge bg-panel p-5 text-chalk ${item.isDragging ? "z-10" : ""}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-chalk-soft font-sans text-label uppercase tracking-wide">{row.targetDate ? `By ${formatDateMedium(row.targetDate)}` : "Saving up"}</p>
            <h3 className="mt-1 break-words font-sans text-xl font-medium tracking-tight">{row.name}</h3>
          </div>
          {row.photo && <img src={row.photo} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />}
        </div>
        <SavingsGoalEnvelope ratio={ratio} color={row.envelopeColor} name={row.name} />
        <p className="break-words flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-2xl tracking-tight">{formatCents(row.savedCents)}</span>
          <span className="text-chalk-soft font-sans text-label">of {formatCents(row.targetCents)} saved</span>
        </p>
        <div className="text-chalk-soft flex flex-wrap items-center justify-between gap-3 font-sans text-label">
          <span>{row.remainingCents === 0 ? "Goal reached!" : `${formatCents(row.remainingCents)} to go`}</span>
          <span className="font-mono">{Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%</span>
        </div>
        {pace && <p className="font-sans text-label text-chalk-soft">{pace}</p>}
      </div>
      <div className="mt-4 space-y-3">
        {row.categoryName && <p className="text-label text-chalk-soft">Linked to {row.categoryName}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          <label className="font-sans text-label uppercase text-chalk-soft" htmlFor={`goal-add-${row.goalId}`}>Add money</label>
          <input key={row.assignedCents} id={`goal-add-${row.goalId}`} type="text" inputMode="decimal" placeholder="$0" aria-label={`Add to ${row.name}`} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} onBlur={handleBlur} className="w-28 border-b-2 border-rule bg-transparent px-1 py-1 text-right font-mono text-row text-chalk outline-none focus:border-azure" />
          {confirmation !== null && <span className="text-label text-verdant">{confirmation > 0 ? "+" : ""}{formatCents(confirmation)}</span>}
          <span className="flex-1" />
          <Button variant="row-action" size="sm" aria-label={`Edit goal: ${row.name}`} onClick={() => onEdit(row)}>Edit</Button>
          <Button variant="row" size="sm" aria-label={`Remove goal: ${row.name}`} onClick={() => onDelete(row)}>Remove</Button>
        </div>
        {error && <p role="alert" className="font-sans text-row text-vermilion">{error}</p>}
      </div>
    </article>
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
    <section aria-label="Savings goals" className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Your savings goals</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-sans text-row text-chalk-soft">No savings goals yet. Add one for something you are excited about: a trip, a new camera, or a cozy home upgrade.</p>
      ) : (
        <div className="p-4 sm:p-5">
          <SortableList ids={rows.map((row) => row.goalId)} onReorder={onReorder ?? (() => {})}>
            <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => <GoalCard key={row.goalId} row={row} onAssign={commit} onEdit={onEdit} onDelete={onDelete} error={error?.id === row.goalId ? error.message : null} sortable={onReorder != null} />)}
            </div>
          </SortableList>
        </div>
      )}
    </section>
  );
}
