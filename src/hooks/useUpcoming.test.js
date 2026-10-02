import { act, renderHook } from "@testing-library/react";
import AppProviders from "../contexts/AppProviders";
import { useSchedules } from "../contexts/SchedulesContext";
import { TRANSACTION_KINDS, useTransactions } from "../contexts/TransactionsContext";
import useUpcoming from "./useUpcoming";
import { addDays, todayISO } from "../utils";

/**
 * The schedule store and the join that reads it, in one suite.
 *
 * Deliberately **not** in `dataModel.test.js`, which is the home of the envelope
 * identity and the cascades around it: a schedule holds no money, nothing derived
 * from the books reads one, and adding a schedule cannot move a figure anywhere in
 * the app. Putting it there would suggest it were part of an invariant it has no
 * term in. `useGiving.test.js` is the precedent for a store and its join tested
 * together — what is worth pinning down is the half that crosses between them.
 *
 * Dates are relative to today here, unlike `recurrence.test.js`, and for the
 * opposite reason: what these assert is *overdue against today*, which is the one
 * thing a fixed calendar date cannot express.
 */
const TODAY = todayISO();

const wrapper = ({ children }) => <AppProviders>{children}</AppProviders>;

const ACCOUNT = {
  id: "acc1",
  name: "Everyday",
  type: "asset",
  scope: "on-budget",
  assetClass: "Cash",
  openingBalanceCents: 500000,
  openingDate: null,
};

function seed({ schedules = [], ...rest } = {}) {
  localStorage.setItem("accounts", JSON.stringify([ACCOUNT]));
  localStorage.setItem(
    "budgets",
    JSON.stringify([{ id: "b1", name: "Bills", groupId: null, plannedCents: 0, bucket: "essentials" }])
  );
  localStorage.setItem("schedules", JSON.stringify(schedules));
  for (const [key, value] of Object.entries(rest)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

/** A monthly bill, anchored `days` from today so the window can be aimed. */
function bill(fields = {}) {
  return {
    id: "s1",
    kind: TRANSACTION_KINDS.OUTFLOW,
    payeeId: null,
    amountCents: 180000,
    accountId: "acc1",
    budgetId: "b1",
    description: "Rent",
    cadence: "monthly",
    startDate: TODAY,
    endsOn: null,
    enteredThrough: null,
    ...fields,
  };
}

const stored = (key) => JSON.parse(localStorage.getItem(key));

function renderStore() {
  return renderHook(
    () => ({ ...useSchedules(), ledger: useTransactions(), upcoming: useUpcoming(TODAY) }),
    { wrapper }
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("what a schedule has to say for itself", () => {
  const valid = {
    kind: TRANSACTION_KINDS.OUTFLOW,
    // Written the way a figure is written, commas and all — `toCents` takes it and
    // `parseFloat` would have read this as 1.
    amount: "1,800.00",
    accountId: "acc1",
    budgetId: "b1",
    cadence: "monthly",
    startDate: TODAY,
  };

  test("a whole one lands, with nothing dealt with yet", () => {
    seed();
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.addSchedule({ ...valid, payeeId: null, description: "Rent" });
    });

    expect(outcome.ok).toBe(true);
    expect(stored("schedules")).toEqual([
      {
        id: expect.any(String),
        kind: TRANSACTION_KINDS.OUTFLOW,
        payeeId: null,
        amountCents: 180000,
        accountId: "acc1",
        budgetId: "b1",
        description: "Rent",
        cadence: "monthly",
        startDate: TODAY,
        endsOn: null,
        // Nothing has been dealt with, so its own first occurrence is the first
        // thing it offers. Seeding the cursor to today would silently swallow an
        // occurrence the user deliberately backdated.
        enteredThrough: null,
      },
    ]);
  });

  test("a prediction of nothing predicts nothing", () => {
    seed();
    const { result } = renderStore();

    for (const amount of ["0", "-40", "twelve apples", ""]) {
      let outcome;
      act(() => {
        outcome = result.current.addSchedule({ ...valid, amount });
      });
      expect(outcome).toEqual({ ok: false, error: "Enter an amount greater than zero." });
    }
    expect(stored("schedules")).toEqual([]);
  });

  test("money out names a category and an account, as it does on a real row", () => {
    seed();
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.addSchedule({ ...valid, budgetId: "" });
    });
    expect(outcome.ok).toBe(false);

    act(() => {
      outcome = result.current.addSchedule({ ...valid, accountId: "" });
    });
    expect(outcome.ok).toBe(false);

    // Money in may name one — an inflow with a category is a refund and one
    // without it is income, the ledger's own rule restated where a schedule can
    // check it.
    act(() => {
      outcome = result.current.addSchedule({
        ...valid,
        kind: TRANSACTION_KINDS.INFLOW,
        budgetId: "",
      });
    });
    expect(outcome.ok).toBe(true);
  });

  test("a transfer is not schedulable here", () => {
    seed();
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.addSchedule({ ...valid, kind: TRANSACTION_KINDS.TRANSFER });
    });
    // It names no payee, and what it means to the budget is decided by a rule that
    // lives in the entry form — a third copy of that rule is how three come to
    // disagree.
    expect(outcome.ok).toBe(false);
  });

  test("an anchor and a cadence it knows, or nothing", () => {
    seed();
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.addSchedule({ ...valid, cadence: "whenever" });
    });
    expect(outcome.ok).toBe(false);

    act(() => {
      outcome = result.current.addSchedule({ ...valid, startDate: "the 1st" });
    });
    expect(outcome.ok).toBe(false);
  });

  test("a schedule that ends before it starts has no occurrences at all", () => {
    seed();
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.addSchedule({ ...valid, endsOn: addDays(TODAY, -1) });
    });
    expect(outcome).toEqual({ ok: false, error: "The end date is before the first one." });
  });
});

describe("editing one", () => {
  test("restating what a bill is leaves the cursor alone", () => {
    seed({ schedules: [bill({ enteredThrough: addDays(TODAY, -1) })] });
    const { result } = renderStore();

    act(() => {
      result.current.updateSchedule({
        id: "s1",
        kind: TRANSACTION_KINDS.OUTFLOW,
        amount: "1,850.00",
        accountId: "acc1",
        budgetId: "b1",
        cadence: "monthly",
        startDate: TODAY,
      });
    });

    // A rent rise must not re-offer every month already entered, nor skip the one
    // coming: how much of a schedule has been dealt with is not a field on what the
    // schedule *is*.
    expect(stored("schedules")[0].amountCents).toBe(185000);
    expect(stored("schedules")[0].enteredThrough).toBe(addDays(TODAY, -1));
  });

  test("an id the store no longer has is refused rather than reported as landed", () => {
    seed({ schedules: [bill()] });
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.updateSchedule({ id: "gone", amount: "10", cadence: "monthly" });
    });
    // `useSyncedState` syncs a delete from another device, and the modal can be
    // open on a record that has gone — `updateSavingsGoal`'s rule.
    expect(outcome).toEqual({ ok: false, error: "That schedule no longer exists." });
  });

  test("removing one keeps every transaction already entered from it", () => {
    seed({ schedules: [bill()] });
    const { result } = renderStore();

    act(() => {
      result.current.ledger.addTransaction({
        kind: TRANSACTION_KINDS.OUTFLOW,
        amount: "180",
        date: TODAY,
        accountId: "acc1",
        budgetId: "b1",
      });
    });
    act(() => {
      result.current.deleteSchedule({ id: "s1" });
    });

    // Nothing on the ledger names a schedule, which is exactly why: stopping a
    // standing order does not unpay the rent.
    expect(stored("schedules")).toEqual([]);
    expect(stored("transactions")).toHaveLength(1);
  });
});

describe("the cursor", () => {
  test("only ever moves forward", () => {
    seed({ schedules: [bill({ enteredThrough: TODAY })] });
    const { result } = renderStore();

    act(() => {
      result.current.advanceSchedule({ id: "s1", through: addDays(TODAY, -60) });
    });

    // The same occurrence can be actioned twice — two devices, or a stale render
    // of the list — and a cursor that could move backwards would re-offer a bill
    // that had already been paid.
    expect(stored("schedules")[0].enteredThrough).toBe(TODAY);
  });

  test("a date it cannot read is refused", () => {
    seed({ schedules: [bill()] });
    const { result } = renderStore();

    let outcome;
    act(() => {
      outcome = result.current.advanceSchedule({ id: "s1", through: "soon" });
    });
    expect(outcome.ok).toBe(false);
    expect(stored("schedules")[0].enteredThrough).toBeNull();
  });
});

describe("what is due", () => {
  test("a bill due today is due, not late", () => {
    seed({ schedules: [bill({ startDate: TODAY })] });
    const { result } = renderStore();

    const { rows, overdueCount, dueCents } = result.current.upcoming;
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(TODAY);
    expect(rows[0].dueInDays).toBe(0);
    // A direct debit taken this morning and a bill being paid this afternoon are
    // the same row; calling it overdue would cry wolf every month.
    expect(overdueCount).toBe(0);
    expect(dueCents).toBe(180000);
  });

  test("the window opens at the cursor, not at today", () => {
    seed({ schedules: [bill({ startDate: addDays(TODAY, -9) })] });
    const { result } = renderStore();

    const { rows, overdueCount, overdueCents } = result.current.upcoming;
    // Nine days ago and nobody entered it. This is the one failure a bill reminder
    // cannot have: a list that started at today would let it vanish in silence.
    expect(rows[0].date).toBe(addDays(TODAY, -9));
    expect(rows[0].overdue).toBe(true);
    expect(overdueCount).toBe(1);
    expect(overdueCents).toBe(180000);
  });

  test("dealing with an occurrence takes it off the list", () => {
    const due = addDays(TODAY, -9);
    seed({ schedules: [bill({ startDate: due })] });
    const { result } = renderStore();

    act(() => {
      result.current.advanceSchedule({ id: "s1", through: due });
    });

    // Skipped or entered, the store cannot tell and does not need to — what it
    // records is that the user decided about that date.
    expect(result.current.upcoming.rows.map((row) => row.date)).not.toContain(due);
    expect(result.current.upcoming.overdueCount).toBe(0);
  });

  test("a month further out than the window is not on the list yet", () => {
    seed({ schedules: [bill({ startDate: addDays(TODAY, 40) })] });
    const { result } = renderStore();

    expect(result.current.upcoming.rows).toEqual([]);
    // Which is a different fact from having nothing scheduled, and the panel says
    // so differently.
    expect(result.current.upcoming.scheduleCount).toBe(1);
  });

  test("one weekly schedule is several things to do", () => {
    seed({ schedules: [bill({ cadence: "weekly", startDate: TODAY, amountCents: 1000 })] });
    const { result } = renderStore();

    // Four weeks of a weekly bill, each entered or skipped on its own — which is
    // why a row is an occurrence rather than a schedule.
    expect(result.current.upcoming.rows).toHaveLength(5);
    expect(result.current.upcoming.dueCents).toBe(5000);
  });

  test("oldest first, so the most overdue thing is read first", () => {
    // `endsOn` equal to `startDate` is how a one-off is said, which is what keeps
    // this about the ordering: a monthly bill anchored three days ago would
    // otherwise contribute two occurrences to a four-week window.
    const once = (id, date) => bill({ id, startDate: date, endsOn: date });
    seed({
      schedules: [
        once("s1", addDays(TODAY, 5)),
        once("s2", addDays(TODAY, -3)),
        once("s3", TODAY),
      ],
    });
    const { result } = renderStore();

    expect(result.current.upcoming.rows.map((row) => row.schedule.id)).toEqual(["s2", "s3", "s1"]);
  });

  test("an expected paycheque is not netted off what has to be paid", () => {
    seed({
      schedules: [
        bill(),
        bill({
          id: "s2",
          kind: TRANSACTION_KINDS.INFLOW,
          budgetId: null,
          amountCents: 400000,
          description: "Rent from the lodger",
        }),
      ],
    });
    const { result } = renderStore();

    expect(result.current.upcoming.rows).toHaveLength(2);
    // Both are worth knowing about, and netting them would report a smaller bill
    // than the household actually has to cover.
    expect(result.current.upcoming.dueCents).toBe(180000);
    expect(result.current.upcoming.expectedCents).toBe(400000);
  });

  test("a schedule that has ended offers nothing beyond its end", () => {
    seed({
      schedules: [
        bill({
          startDate: addDays(TODAY, -60),
          endsOn: addDays(TODAY, -30),
          // Both of its occurrences were dealt with while it was live.
          enteredThrough: addDays(TODAY, -30),
        }),
      ],
    });
    const { result } = renderStore();

    // The cadence would happily go on stepping forward; the end date is what stops
    // it, so a cancelled subscription does not keep asking to be paid.
    expect(result.current.upcoming.rows).toEqual([]);
  });

  test("an occurrence nobody entered before it ended is still outstanding", () => {
    seed({
      schedules: [bill({ startDate: addDays(TODAY, -60), endsOn: addDays(TODAY, -30) })],
    });
    const { result } = renderStore();

    // It was a real bill on a real day and nothing recorded it. Dropping it because
    // the schedule has since finished is the silent disappearance this list exists
    // to prevent.
    const dates = result.current.upcoming.rows.map((row) => row.date);
    expect(dates[0]).toBe(addDays(TODAY, -60));
    expect(result.current.upcoming.overdueCount).toBe(dates.length);
    // However many fell before it ended, none fell after.
    expect(dates.every((date) => date <= addDays(TODAY, -30))).toBe(true);
  });

  test("a stored schedule with no cadence is dropped on the way in", () => {
    // The migration keeps only records it can compute occurrences for, so a
    // hand-edited file cannot put a row on the dashboard that has no date.
    seed({ schedules: [bill(), { id: "s2", amountCents: 100, cadence: "whenever" }] });
    const { result } = renderStore();

    expect(result.current.schedules).toHaveLength(1);
  });
});
