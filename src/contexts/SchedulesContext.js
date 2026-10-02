import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { TRANSACTION_KINDS } from "./TransactionsContext";
import { isRecurring, recurrence } from "../recurrence";
import { isValidISODate, toCents } from "../utils";

/**
 * The transactions the household already knows about: rent on the 1st, the
 * insurance premium every quarter, the paycheque that is not the household's
 * main one.
 *
 * A record is:
 *
 *   schedule { id, kind, payeeId, amountCents, accountId, budgetId, description,
 *              cadence, startDate, endsOn, enteredThrough }
 *
 * **A schedule is a standing intention and holds no money.** It is the same split
 * `SavingsGoalsContext` keeps against its assignments and `BudgetsContext` keeps
 * against the ledger: what is *expected* lives here, what actually happened lives
 * in the ledger, and the two are never the same record. That is what makes every
 * figure in the app unmoved by this store — no envelope, no balance and no report
 * reads a schedule, so adding one cannot change what the household has.
 *
 * **Nothing here posts itself.** An occurrence becomes a transaction because the
 * user said it did, which is not a limitation to be worked around later — it is
 * the only honest design available. `paySchedule.js` states the reason in one
 * line: nothing in an app with no backend runs at midnight. A schedule that
 * silently wrote rows would be a ledger claiming the rent went out on a day
 * nobody opened the app, and the first thing a household would do with it is stop
 * trusting the balance. What a schedule buys instead is that the row is *offered*,
 * pre-filled, the moment it is due — and that an unpaid one is visible as unpaid.
 *
 * **`enteredThrough` is the cursor, and it is the one stored date.** Every
 * occurrence on or before it has been dealt with — entered, or deliberately
 * skipped. The occurrences themselves are a closed form over `startDate` (see
 * `src/recurrence.js`), for the reason envelope rollover is: a stored "next date"
 * needs advancing by something. A decision, by contrast, cannot be derived — the
 * books cannot tell "this month's rent has not been paid" from "this month's rent
 * was paid in cash and never recorded" — so the decision is what gets stored.
 *
 * It is deliberately *not* a link from the transaction back to the schedule that
 * suggested it. A `scheduleId` on the ledger would make "has this one been
 * entered?" derivable, and then correcting the date of a rent payment would
 * silently un-enter it and the row would be offered a second time. The cursor
 * cannot be disturbed by editing the money.
 *
 * **Every reference on a schedule is inert but kept**, the rule a payee's
 * `defaultBudgetId` follows and for the same reason: this store reads no other, so
 * it cannot check that a payee, an account or a category still exists. A schedule
 * naming something deleted is resolved where it is read — the list says so, and
 * the enter form refuses rather than writing a row against an account that is
 * gone. Nothing cascades in or out, so this provider's position in the order is
 * free.
 *
 * **Two kinds, not three.** Money out and money in; a transfer is not
 * schedulable here. A transfer names no payee at all — it moves money between the
 * household's own accounts — and what it means to the budget depends on which side
 * of the boundary each end sits, a rule that lives in `AddTransactionModal`
 * because the ledger is mounted too high to check it. Putting a third copy of that
 * rule behind a schedule form is how the three come to disagree.
 *
 * **A schedule is not divided between categories.** `splits` is absent rather than
 * null-by-omission: a recurring bill is one payee and one figure, and a division
 * that has to add up to an amount the user is about to retype on the way in is a
 * rule with nowhere safe to be checked. A receipt is divided when it is entered.
 */
const SchedulesContext = React.createContext();

export function useSchedules() {
  return useContext(SchedulesContext);
}

/** Money out and money in. A transfer is not one of these — see above. */
export const SCHEDULE_KINDS = [TRANSACTION_KINDS.OUTFLOW, TRANSACTION_KINDS.INFLOW];

const isAmount = (value) => Number.isInteger(value) && value > 0;

/**
 * Every field a schedule has to satisfy, checked by both mutators.
 *
 * Deliberately stricter than the ledger's own boundary in one place: the amount
 * must be **greater than zero**. The ledger takes what happened, and a refund of
 * nothing is a row somebody can correct; a schedule is a prediction, and a
 * prediction of zero predicts nothing.
 */
function parseScheduleFields({
  kind,
  payeeId,
  amount,
  amountCents,
  accountId,
  budgetId,
  description,
  cadence,
  startDate,
  endsOn,
}) {
  if (!SCHEDULE_KINDS.includes(kind)) {
    return { ok: false, error: "Choose whether this is money out or money in." };
  }

  const cents = amountCents !== undefined ? amountCents : toCents(amount);
  if (!isAmount(cents)) return { ok: false, error: "Enter an amount greater than zero." };

  if (!accountId) return { ok: false, error: "Choose the account this goes through." };

  // The ledger's own rule, restated where a schedule can check it: an outflow
  // names a category, an inflow may — and an inflow with one is a refund rather
  // than income, exactly as it is on a real row.
  if (kind === TRANSACTION_KINDS.OUTFLOW && !budgetId) {
    return { ok: false, error: "Money out comes out of a category. Choose one." };
  }

  if (recurrence(cadence) == null) return { ok: false, error: "Choose how often this repeats." };
  if (!isValidISODate(startDate)) {
    return { ok: false, error: "Enter the date of the first one, as YYYY-MM-DD." };
  }

  const ends = endsOn || null;
  if (ends !== null && !isValidISODate(ends)) {
    return { ok: false, error: "Enter a valid end date, or leave it blank." };
  }
  // A schedule that ends before it starts has no occurrences at all, which would
  // be a row on the list that can never do anything.
  if (ends !== null && ends < startDate) {
    return { ok: false, error: "The end date is before the first one." };
  }

  return {
    ok: true,
    fields: {
      kind,
      // "" from an unpicked select is normalised to null at the boundary, the
      // rule the ledger keeps for the same three fields.
      payeeId: payeeId || null,
      amountCents: cents,
      accountId,
      budgetId: budgetId || null,
      description: (description ?? "").trim(),
      cadence,
      startDate,
      endsOn: ends,
    },
  };
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migrateSchedules(stored) {
  const schedules = Array.isArray(stored) ? stored : [];
  return schedules
    .filter((schedule) => schedule && isRecurring(schedule) && isAmount(schedule.amountCents))
    .map((schedule) => ({
      id: schedule.id ?? uuidV4(),
      kind: SCHEDULE_KINDS.includes(schedule.kind) ? schedule.kind : TRANSACTION_KINDS.OUTFLOW,
      payeeId: schedule.payeeId ?? null,
      amountCents: schedule.amountCents,
      accountId: schedule.accountId ?? null,
      budgetId: schedule.budgetId ?? null,
      description: schedule.description ?? "",
      cadence: schedule.cadence,
      startDate: schedule.startDate,
      endsOn: isValidISODate(schedule.endsOn) ? schedule.endsOn : null,
      // Null is "nothing has been dealt with yet", which is what a schedule
      // starts on and what makes its first occurrence the first thing offered.
      enteredThrough: isValidISODate(schedule.enteredThrough) ? schedule.enteredThrough : null,
    }));
}

export const SchedulesProvider = ({ children }) => {
  const [schedules, setSchedules] = useSyncedState("schedules", [], migrateSchedules);

  const addSchedule = useCallback(
    (input) => {
      const parsed = parseScheduleFields(input);
      if (!parsed.ok) return parsed;

      const id = uuidV4();
      setSchedules((previous) => [
        ...previous,
        {
          id,
          ...parsed.fields,
          // A new schedule has dealt with nothing, so its own `startDate` is the
          // first thing it offers. Seeding the cursor to today instead would
          // silently swallow an occurrence the user deliberately backdated.
          enteredThrough: null,
        },
      ]);
      return { ok: true, id };
    },
    [setSchedules]
  );

  /**
   * Restate a schedule. Every field is given at once — the form is the only
   * caller and asks for all of them — so this validates a whole record rather
   * than a patch, unlike the ledger's `updateTransaction`.
   *
   * **The cursor is not a field here.** Editing what a bill is does not change
   * how much of it has been dealt with: correcting the rent from $1,800 to $1,850
   * must not re-offer every month already entered, and must not skip the one
   * coming. Moving the cursor is `advanceSchedule`'s job and it is only ever moved
   * forward.
   *
   * Refuses an id it cannot find rather than letting a `map` that matches nothing
   * report the write as landed — `updateSavingsGoal`'s rule, for its reason: a
   * delete from another device syncs in while the modal is open on the row.
   */
  const updateSchedule = useCallback(
    ({ id, ...input }) => {
      const existing = schedules.find((schedule) => schedule.id === id);
      if (!existing) return { ok: false, error: "That schedule no longer exists." };

      const parsed = parseScheduleFields(input);
      if (!parsed.ok) return parsed;

      setSchedules((previous) =>
        previous.map((schedule) =>
          schedule.id === id ? { ...schedule, ...parsed.fields } : schedule
        )
      );
      return { ok: true, id };
    },
    [schedules, setSchedules]
  );

  /**
   * Mark everything up to and including `through` as dealt with.
   *
   * Called twice from the same panel and meaning the same thing both times: after
   * a transaction has been written for an occurrence, and when one is skipped
   * outright. The store cannot tell those apart and does not need to — what it
   * records is that the user has decided about that date.
   *
   * **It only ever moves forward.** `Math.max` on the two dates rather than a
   * plain assignment, because the same occurrence can be actioned twice — two
   * devices, or a stale render of the list — and a cursor that could move
   * backwards would re-offer a bill that was already paid.
   *
   * The date is the **scheduled** one, never the date the transaction was given.
   * A bill due on the 1st and paid on the 3rd has had its 1st dealt with; stamping
   * the 3rd would swallow anything else due in between.
   */
  const advanceSchedule = useCallback(
    ({ id, through }) => {
      const existing = schedules.find((schedule) => schedule.id === id);
      if (!existing) return { ok: false, error: "That schedule no longer exists." };
      if (!isValidISODate(through)) return { ok: false, error: "That is not a date." };

      const cursor =
        existing.enteredThrough != null && existing.enteredThrough > through
          ? existing.enteredThrough
          : through;
      if (cursor === existing.enteredThrough) return { ok: true, id };

      setSchedules((previous) =>
        previous.map((schedule) =>
          schedule.id === id ? { ...schedule, enteredThrough: cursor } : schedule
        )
      );
      return { ok: true, id };
    },
    [schedules, setSchedules]
  );

  /**
   * Remove a schedule. Never refused, and nothing else moves: it holds no money,
   * and the transactions it suggested are ordinary rows that name it nowhere —
   * which is the whole reason the ledger carries no `scheduleId`. Stopping a
   * standing order does not unpay the rent.
   */
  const deleteSchedule = useCallback(
    ({ id }) => {
      setSchedules((previous) => previous.filter((schedule) => schedule.id !== id));
      return { ok: true };
    },
    [setSchedules]
  );

  // Memoised so a change in any other store does not re-render every consumer of
  // this one.
  const value = useMemo(
    () => ({ schedules, addSchedule, updateSchedule, advanceSchedule, deleteSchedule }),
    [schedules, addSchedule, updateSchedule, advanceSchedule, deleteSchedule]
  );

  return <SchedulesContext.Provider value={value}>{children}</SchedulesContext.Provider>;
};
