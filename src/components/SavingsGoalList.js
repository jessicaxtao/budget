import { useEffect, useState } from "react";
import Button from "./Button";
import { SortableList, useSortableItem } from "./Sortable";
import { currentPeriod, formatCents, formatDateMedium, toCents, toPeriod } from "../utils";

const TICKS = 24;

function GoalMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  return (
    <div className="flex gap-1" role="progressbar" aria-label={label} aria-valuenow={Math.round(Math.min(ratio, 1) * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: TICKS }, (_, i) => <span key={i} className={`h-2 flex-1 rounded-full ${i < filled ? (ratio >= 1 ? "bg-verdant" : "bg-azure") : "bg-edge"}`} />)}
    </div>
  );
}

function monthsUntil(targetDate, now) {
  const target = toPeriod(targetDate);
  if (!target || !now) return null;
  const [ty, tm] = now.split("-").map(Number);
  const [gy, gm] = target.split("-").map(Number);
  return (gy - ty) * 12 + gm - tm;
}

function GoalEnvelope({ row, onAssign, onEdit, onDelete, error, sortable }) {
  const item = useSortableItem(row.goalId, { disabled: !sortable });
  const [opened, setOpened] = useState(false);
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
    <article ref={item.ref} style={item.style} {...item.handle} className={`relative overflow-hidden rounded-2xl border border-edge bg-panel shadow-sm transition-shadow hover:shadow-lg ${item.isDragging ? "z-10" : ""}`}>
      <div className="relative min-h-52 overflow-hidden bg-gradient-to-br from-[#f5b75c] via-[#e99a52] to-[#d77b50] p-5 text-[#2b2118]">
        {row.photo ? <img src={row.photo} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" /> : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-7xl opacity-25">✦</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/5" />
        <div className="relative z-[1] flex min-h-40 flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <span className="rounded-full bg-black/25 px-3 py-1 font-sans text-label uppercase tracking-wide text-white backdrop-blur-sm">{row.targetDate ? `By ${formatDateMedium(row.targetDate)}` : "Saving up"}</span>
            <button id={`savings-goal-add-${row.goalId}`} type="button" onClick={() => setOpened((value) => !value)} aria-expanded={opened} className="rounded-full bg-white/90 px-3 py-2 font-sans text-label font-semibold text-[#34291e] shadow transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              {opened ? "Close envelope ↑" : "Open envelope ↓"}
            </button>
          </div>
          <div>
            <h3 className="font-sans text-xl font-semibold text-white drop-shadow">{row.name}</h3>
            <p className="mt-1 font-mono text-row text-white/90">{formatCents(row.savedCents)} <span className="font-sans text-label">of {formatCents(row.targetCents)}</span></p>
          </div>
        </div>
        <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 z-0 h-16 origin-bottom border-t border-white/20 bg-[#f3b766]/75 transition-transform duration-500 ${opened ? "-translate-y-10 -skew-y-6 opacity-30" : "[clip-path:polygon(0_0,100%_0,50%_88%)]"}`} />
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ${opened ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden" aria-hidden={!opened} inert={!opened}>
          <div className="space-y-4 p-5">
            <GoalMeter ratio={ratio} label={`${Math.round(Math.min(ratio, 1) * 100)} percent of the way to ${row.name}`} />
            <div className="flex items-center justify-between gap-2 font-sans text-row">
              <span className="text-chalk-soft">{row.remainingCents === 0 ? "Goal reached! 🎉" : `${formatCents(row.remainingCents)} to go`}</span>
              {pace && <span className="text-label text-chalk-soft">{pace}</span>}
            </div>
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
        </div>
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
        <div><h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Your goal envelopes</h2><p className="font-sans text-label text-chalk-soft">Open one to add money and see your progress.</p></div>
        <span aria-hidden="true" className="text-2xl">✉️</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 font-sans text-row text-chalk-soft">No savings goals yet. Add one for something you’re excited about — a trip, a new camera, or a cozy home upgrade.</p>
      ) : (
        <div className="p-4 sm:p-5">
          <SortableList ids={rows.map((row) => row.goalId)} onReorder={onReorder ?? (() => {})}>
            <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => <GoalEnvelope key={row.goalId} row={row} onAssign={commit} onEdit={onEdit} onDelete={onDelete} error={error?.id === row.goalId ? error.message : null} sortable={onReorder != null} />)}
            </div>
          </SortableList>
        </div>
      )}
    </section>
  );
}
