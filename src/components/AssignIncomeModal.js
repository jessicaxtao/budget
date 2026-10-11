import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import PeriodStepper from "./PeriodStepper";
import useEnvelopes from "../hooks/useEnvelopes";
import useSavingsGoalEnvelopes from "../hooks/useSavingsGoalEnvelopes";
import { useAssignments } from "../contexts/AssignmentsContext";
import { useSavingsGoalAssignments } from "../contexts/SavingsGoalAssignmentsContext";
import {
  amountAtRest,
  amountField,
  currentPeriod,
  formatCents,
  periodLTE,
  toCents,
} from "../utils";

const FIELD_PREFIX = "assign:";
const GOAL_FIELD_PREFIX = "goal:";

/**
 * Give a month's money a job, one category — or one savings goal — at a
 * time. This is the app's single door into the shared "to be assigned" pool
 * (see ToBeAssignedBar's comment), so a goal is funded here rather than
 * through a second entry point: it draws from the same dollar a category
 * does, and useEnvelopes' goalRows are what make that pool figure honest.
 *
 * Uncontrolled, like every other form here: one `name` per row, read back with
 * FormData. The live "remaining to assign" figure does not need controlled
 * inputs — one `onChange` on the form recomputes it from the same FormData on
 * every keystroke (React routes that to the native input event, so it fires per
 * character and bubbles from every row), which keeps `form.reset()` working and
 * this modal inside the pattern the rest of the suite is built around. Holding
 * a row of useState instead would only move the re-seeding hazard somewhere
 * harder to see: seeding from the derived rows would let the store echo of the
 * modal's own write clobber whatever the user was typing.
 *
 * **The month is a control on the form, which is what makes funding a month
 * ahead possible** — rent out of this paycheque, a quarterly premium funded
 * three early. It is here rather than on a page for two reasons. The dashboard
 * deliberately has no month on it (everything there is as of today), and this
 * is already the app's one door into the pool, so a second door for a month not
 * yet reached would be two forms competing for one dollar. The pool is the same
 * figure whichever month is on screen — `useEnvelopes` takes every assignment
 * out of it, before *and* after the month being funded — so stepping forward
 * never conjures money, it only moves where this form will file it.
 */
export default function AssignIncomeModal({
  show,
  period,
  handleClose,
  title,
  poolCentsOverride,
}) {
  const formRef = useRef();
  const [error, setError] = useState(null);
  const [remainingCents, setRemainingCents] = useState(0);
  // The month being funded. Seeded from the page's own period on every open, so
  // stepping ahead is a decision taken inside one sitting rather than a state
  // the next sitting inherits — and so the page's stepper still moves the form
  // underneath an open dialog.
  const [month, setMonth] = useState(period);

  const { setPeriodAssignments } = useAssignments();
  const { setPeriodAssignments: setGoalPeriodAssignments } = useSavingsGoalAssignments();
  const { rows, toBeAssignedCents, assignedAheadCents } = useEnvelopes(month);
  const goalRows = useSavingsGoalEnvelopes(month);
  // Onboarding's starting-balance flow reuses this same form but is not
  // funded from this month's ordinary pool — see `useStartingBalances`. The
  // month is part of what that override *means* (a period before the books
  // open), so that is the one use with no stepper on it.
  const poolCents = poolCentsOverride ?? toBeAssignedCents;
  const steppable = poolCentsOverride == null;

  // What the pool figure needs said about it, in the order it needs saying. A
  // month ahead is funded out of today's money, and the pool does not move when
  // the month does — so the reader has to be told that is the point rather than
  // a stuck figure. The second is the same money seen from an earlier month:
  // already promised, still in the accounts, and worded as it is on the
  // dashboard's pool tile and `ToBeAssignedBar`.
  const notes = steppable
    ? [
        periodLTE(month, currentPeriod()) ? null : "Funding ahead, out of today's money",
        assignedAheadCents > 0 ? `${formatCents(assignedAheadCents)} assigned ahead` : null,
      ].filter(Boolean)
    : [];

  // Configured categories, plus Uncategorized whenever it holds a balance or
  // saw activity. Keyed on the balance and not only on this month's activity:
  // an uncovered overspend carried in from an earlier month is precisely the
  // row the user has come here to settle.
  const editable = rows.filter(
    (row) =>
      row.kind === "category" ||
      row.availableCents !== 0 ||
      row.assignedCents !== 0 ||
      row.activityCents !== 0
  );

  const storedCents =
    editable.reduce((sum, row) => sum + row.assignedCents, 0) +
    goalRows.reduce((sum, row) => sum + row.assignedCents, 0);

  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    let entered = 0;
    for (const [key, value] of data) {
      if (!key.startsWith(FIELD_PREFIX) && !key.startsWith(GOAL_FIELD_PREFIX)) continue;
      entered += toCents(value) ?? 0;
    }
    // Replacing these rows moves the pool by exactly the difference between
    // what is stored for them and what is on screen.
    setRemainingCents(poolCents + storedCents - entered);
  }, [poolCents, storedCents]);

  // The page's month is the month the form opens on. A separate effect from the
  // re-seed below, so stepping the form's own month does not have to pretend the
  // page moved.
  useEffect(() => {
    if (show) setMonth(period);
  }, [show, period]);

  // The modal stays mounted, so re-seed every time it opens — and again if the
  // month moves underneath it, from the page's stepper or from its own, since
  // every figure on it is period-scoped.
  useEffect(() => {
    if (!show) return;
    const form = formRef.current;
    form.reset();
    setError(null);
    for (const row of editable) {
      const input = form.elements[FIELD_PREFIX + row.budgetId];
      // Left blank rather than "0" so an untouched row reads as untouched, and
      // otherwise as money — the same face the estimate beside it wears.
      if (input) input.value = row.assignedCents === 0 ? "" : amountAtRest(row.assignedCents);
    }
    for (const row of goalRows) {
      const input = form.elements[GOAL_FIELD_PREFIX + row.goalId];
      if (input) input.value = row.assignedCents === 0 ? "" : amountAtRest(row.assignedCents);
    }
    recompute();
    // `editable` and `goalRows` are rebuilt every render; depending on them
    // would re-seed the form out from under the user on every keystroke
    // elsewhere in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, month]);

  function setRowValue(budgetId, cents) {
    const input = formRef.current.elements[FIELD_PREFIX + budgetId];
    if (input) input.value = amountAtRest(cents);
  }

  function setGoalRowValue(goalId, cents) {
    const input = formRef.current.elements[GOAL_FIELD_PREFIX + goalId];
    if (input) input.value = amountAtRest(cents);
  }

  // Fill tops a category up to its configured monthly estimate outright, rather
  // than to the estimate minus what it carried in. That is what makes a sinking
  // fund work: $100 a month into car repairs should be $100 every month, not
  // $100 the first month and nothing after.
  function handleFill(row) {
    setRowValue(row.budgetId, row.plannedCents);
    recompute();
  }

  function handleFillAll() {
    for (const row of editable) {
      if (row.plannedCents > 0) setRowValue(row.budgetId, row.plannedCents);
    }
    recompute();
  }

  // A goal has no monthly estimate to top up to — its target is the whole
  // sum, not a per-period figure — so Fill sets this period's contribution to
  // whatever is left to reach it outright, the same "remainingCents" figure
  // the Savings goals page shows.
  function handleFillGoal(row) {
    setGoalRowValue(row.goalId, row.assignedCents + row.remainingCents);
    recompute();
  }

  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(formRef.current);
    const entries = [];
    const goalEntries = [];

    // Validated up front: a form that assigns eight categories and fails on the
    // third must not leave two of them committed.
    for (const row of editable) {
      const raw = data.get(FIELD_PREFIX + row.budgetId);
      // An empty row means "nothing this month", not a malformed figure.
      const cents = String(raw ?? "").trim() === "" ? 0 : toCents(raw);
      if (cents == null) {
        setError(`Enter a valid amount for ${row.name}.`);
        formRef.current.elements[FIELD_PREFIX + row.budgetId]?.focus();
        return;
      }
      entries.push({ budgetId: row.budgetId, amountCents: cents, label: row.name });
    }

    for (const row of goalRows) {
      const raw = data.get(GOAL_FIELD_PREFIX + row.goalId);
      const cents = String(raw ?? "").trim() === "" ? 0 : toCents(raw);
      if (cents == null) {
        setError(`Enter a valid amount for ${row.name}.`);
        formRef.current.elements[GOAL_FIELD_PREFIX + row.goalId]?.focus();
        return;
      }
      goalEntries.push({ goalId: row.goalId, amountCents: cents, label: row.name });
    }

    // Two stores, so this cannot be one atomic write — but every figure is
    // validated above before either call runs, which is what keeps a bad
    // figure from landing in one store after the other already committed.
    const result = setPeriodAssignments({ period: month, entries });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const goalResult = setGoalPeriodAssignments({ period: month, entries: goalEntries });
    if (!goalResult.ok) {
      setError(goalResult.error);
      return;
    }
    handleClose();
  }

  const remainingTone =
    remainingCents < 0 ? "text-vermilion" : remainingCents > 0 ? "text-sulfur" : "text-verdant";

  return (
    <Dialog
      show={show}
      handleClose={handleClose}
      wide
      /* The month is stated once, by the control that sets it — the page
         idiom, where a `PeriodStepper` in the header is the whole statement of
         which month is on screen. Onboarding's flow has no stepper and passes
         its own title. */
      title={title ?? "Assign income"}
      actions={steppable ? <PeriodStepper period={month} onChange={setMonth} /> : null}
    >
      <form ref={formRef} onSubmit={handleSubmit} onChange={recompute}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-edge bg-panel-raised px-4 py-3">
          <div>
            <div className="font-mono text-label uppercase text-chalk-soft">Remaining to assign</div>
            {/* A status region, so the figure is announced as it changes
                rather than only being visible. */}
            <div role="status" className={`font-mono text-figure font-medium ${remainingTone}`}>
              {formatCents(remainingCents)}
            </div>
            {/* Said under the figure they are about, in the label's own voice —
                the same place and weight the tiles elsewhere put a note that
                qualifies a figure above it. */}
            {notes.length > 0 && (
              <div className="mt-0.5 font-mono text-label uppercase text-chalk-soft">
                {notes.join(" · ")}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" type="button" onClick={handleFillAll}>
            Fill all to estimate
          </Button>
        </div>

        {goalRows.length > 0 && (
          <div className="mb-2 font-mono text-label uppercase text-chalk-soft">Categories</div>
        )}
        {editable.length === 0 ? (
          <p className="mb-5 font-sans text-row text-chalk-soft">
            No categories yet. Add one on the Budget plan page, then come back to fund it.
          </p>
        ) : (
          <div className="mb-5 scroll-x">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-raised">
                  <th className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
                    Category
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Estimate
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Goal
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Assign
                  </th>
                  <th className="w-12 px-3 py-2">
                    <span className="sr-only">Fill to estimate</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {editable.map((row, i) => (
                  <tr key={row.budgetId} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                    <td className="px-3 py-2">
                      <div className="font-sans text-row text-ink">{row.name}</div>
                      <div className="font-mono text-label uppercase text-ink-soft">
                        {formatCents(row.availableCents)} available
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                      {row.plannedCents ? formatCents(row.plannedCents) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                      {row.goalCents == null ? "—" : formatCents(row.goalCents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        {...amountField}
                        name={FIELD_PREFIX + row.budgetId}
                        aria-label={`Assign to ${row.name}`}
                        placeholder="$0"
                        className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="row"
                        size="sm"
                        type="button"
                        disabled={!row.plannedCents}
                        onClick={() => handleFill(row)}
                      >
                        Fill
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {goalRows.length > 0 && (
          <>
            <div className="mb-2 font-mono text-label uppercase text-chalk-soft">
              Savings goals
            </div>
            <div className="mb-5 scroll-x">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-panel-raised">
                    <th className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
                      Goal
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                      Remaining
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                      Assign
                    </th>
                    <th className="w-12 px-3 py-2">
                      <span className="sr-only">Fill to target</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {goalRows.map((row, i) => (
                    <tr key={row.goalId} className={i % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}>
                      <td className="px-3 py-2">
                        <div className="font-sans text-row text-ink">{row.name}</div>
                        {/* `savedCents`, not the assignment alone: a goal part
                            funded out of an off-budget holding is that much
                            closer to its target, and Remaining beside it is
                            already read that way. */}
                        <div className="font-mono text-label uppercase text-ink-soft">
                          {formatCents(row.savedCents)} of {formatCents(row.targetCents)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row text-ink-soft">
                        {row.remainingCents === 0 ? "Funded" : formatCents(row.remainingCents)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          {...amountField}
                          name={GOAL_FIELD_PREFIX + row.goalId}
                          aria-label={`Assign to ${row.name} goal`}
                          placeholder="$0"
                          className="w-24 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="row"
                          size="sm"
                          type="button"
                          disabled={row.remainingCents === 0}
                          onClick={() => handleFillGoal(row)}
                        >
                          Fill
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
