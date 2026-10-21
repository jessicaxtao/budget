import {
  DEFAULT_RECURRENCE,
  MAX_OCCURRENCES,
  describeRecurrence,
  isRecurring,
  nextOccurrence,
  occurrencesBetween,
  ordinalDay,
  recurrenceLabel,
  upcomingThrough,
} from "./recurrence";

/**
 * The calendar arithmetic as the pure function it is, `paySchedule.test.js`'s
 * discipline — and **every date here is a real day written out** rather than
 * derived from today, for that suite's reason one step further: the whole point
 * of the months family is what it does to February, so a fixture computed from
 * `todayISO()` would pass in March and prove nothing.
 *
 * The facts these lean on, checked against a real calendar:
 *
 *   2026-01-31  Saturday   2026-02-28  Saturday (2026 is not a leap year)
 *   2026-08-01  Saturday   2028-02-29  Tuesday  (2028 is)
 */

const monthly = (startDate, rest = {}) => ({ cadence: "monthly", startDate, ...rest });

describe("what it will and will not answer", () => {
  test("a cadence it does not know is not a schedule", () => {
    expect(isRecurring({ cadence: "fortnightly-ish", startDate: "2026-01-01" })).toBe(false);
    expect(recurrenceLabel("fortnightly-ish")).toBe("Not set");
  });

  test("a schedule with no anchor is not one either", () => {
    // Every occurrence is computed from the anchor, so without one there is
    // nothing to compute.
    expect(isRecurring(monthly(null))).toBe(false);
    expect(isRecurring(monthly("the 1st"))).toBe(false);
    expect(nextOccurrence(monthly(null), "2026-01-01")).toBeNull();
    expect(occurrencesBetween(monthly(null), "2026-01-01", "2026-12-31")).toEqual([]);
  });

  test("most bills are monthly, which is what the picker starts on", () => {
    expect(DEFAULT_RECURRENCE).toBe("monthly");
  });
});

describe("the months family", () => {
  test("the same day of every month", () => {
    expect(occurrencesBetween(monthly("2026-01-15"), "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
  });

  test("a day the month is too short for is clamped to its last", () => {
    const dates = occurrencesBetween(monthly("2026-01-31"), "2026-01-01", "2026-04-30");

    // February has no 31st, so the bill falls on the 28th — and **March is the
    // 31st again**. This is the whole reason every occurrence is computed from the
    // anchor rather than from the one before it: stepping a month from the 28th
    // would clamp once and never recover, and a bill due at the end of the month
    // would be due on the 28th for the rest of its life after one February.
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  test("the clamp knows about leap years", () => {
    expect(occurrencesBetween(monthly("2028-01-31"), "2028-01-01", "2028-02-29")).toEqual([
      "2028-01-31",
      "2028-02-29",
    ]);
  });

  test("a bill due on a Saturday is due on the Saturday", () => {
    // Deliberately unlike `paySchedule.js`, which moves a payday off a weekend
    // because that is what payroll departments do. A direct debit is taken when it
    // is taken, and reporting it two days early would be the wrong way to be wrong
    // about a bill.
    expect(nextOccurrence(monthly("2026-08-01"), "2026-08-01")).toBe("2026-08-01");
  });

  test("quarterly steps three months, annually twelve", () => {
    expect(
      occurrencesBetween({ cadence: "quarterly", startDate: "2026-01-15" }, "2026-01-01", "2026-12-31")
    ).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);

    expect(
      occurrencesBetween({ cadence: "annually", startDate: "2026-03-15" }, "2026-01-01", "2028-12-31")
    ).toEqual(["2026-03-15", "2027-03-15", "2028-03-15"]);
  });
});

describe("the interval family", () => {
  test("stepped from the anchor, so every one lands on the same weekday", () => {
    expect(
      occurrencesBetween({ cadence: "weekly", startDate: "2026-09-29" }, "2026-09-29", "2026-10-20")
    ).toEqual(["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"]);
  });

  test("a fortnight is fourteen days, not half a month", () => {
    expect(
      occurrencesBetween({ cadence: "biweekly", startDate: "2026-01-02" }, "2026-01-01", "2026-03-01")
    ).toEqual(["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27"]);
  });
});

describe("the window", () => {
  test("both ends are inclusive", () => {
    // The treatment a window of months gets in the spending report, so the two
    // cannot disagree about whether the last day counts.
    expect(occurrencesBetween(monthly("2026-01-15"), "2026-01-15", "2026-02-15")).toEqual([
      "2026-01-15",
      "2026-02-15",
    ]);
  });

  test("nothing before the anchor, whatever the window asks for", () => {
    // Propagating a schedule backwards would invent history the household never
    // agreed to — the stance the ledger takes towards an undated record.
    expect(occurrencesBetween(monthly("2026-06-01"), "2026-01-01", "2026-07-01")).toEqual([
      "2026-06-01",
      "2026-07-01",
    ]);
  });

  test("an end date is a second, earlier ceiling", () => {
    const schedule = monthly("2026-01-10", { endsOn: "2026-03-10" });

    expect(occurrencesBetween(schedule, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
    ]);
    // A lease that ended has no next one — which is what lets the list say
    // "Finished" rather than offering a bill that will never be due.
    expect(nextOccurrence(schedule, "2026-04-01")).toBeNull();
  });

  test("one schedule cannot flood the list", () => {
    // A weekly schedule anchored two years back that nobody ever entered. The
    // honest reading of that is "the oldest few, and there are more" — a hundred
    // rows is not a list anybody can act on.
    const dates = occurrencesBetween(
      { cadence: "weekly", startDate: "2024-01-01" },
      "2024-01-01",
      "2026-12-31"
    );
    expect(dates).toHaveLength(MAX_OCCURRENCES);
    expect(dates[0]).toBe("2024-01-01");
  });

  test("a caller can ask for fewer, never for more", () => {
    expect(
      occurrencesBetween(monthly("2026-01-01"), "2026-01-01", "2026-12-31", { limit: 2 })
    ).toHaveLength(2);
    expect(
      occurrencesBetween(monthly("2026-01-01"), "2026-01-01", "2030-12-31", { limit: 500 })
    ).toHaveLength(MAX_OCCURRENCES);
  });
});

describe("the next one", () => {
  test("a date that is today is today, not next month", () => {
    // The same stance `nextPayday` takes for the family it counts off the
    // calendar: a bill due today is due today, and a countdown that skipped it
    // would report the household as clear on the morning the money leaves.
    expect(nextOccurrence(monthly("2026-01-01"), "2026-03-01")).toBe("2026-03-01");
  });

  test("a date in the middle of a month reaches the next one", () => {
    expect(nextOccurrence(monthly("2026-01-01"), "2026-03-02")).toBe("2026-04-01");
  });

  test("asked from before the anchor, the answer is the anchor", () => {
    expect(nextOccurrence(monthly("2026-06-01"), "2026-01-01")).toBe("2026-06-01");
  });

  test("asked from long after, it rolls all the way forward", () => {
    // A schedule nobody has looked at in two years still names a real date rather
    // than an answer in the past — `nextPayday`'s rule.
    expect(nextOccurrence(monthly("2024-01-20"), "2026-09-29")).toBe("2026-10-20");
  });
});

describe("said in words", () => {
  test("one phrase per schedule, so two screens cannot describe one differently", () => {
    expect(describeRecurrence(monthly("2026-01-01"))).toBe("monthly on the 1st");
    expect(describeRecurrence(monthly("2026-01-22"))).toBe("monthly on the 22nd");
    expect(describeRecurrence({ cadence: "quarterly", startDate: "2026-01-15" })).toBe(
      "every 3 months on the 15th"
    );
    expect(describeRecurrence({ cadence: "annually", startDate: "2026-03-15" })).toBe(
      "every year on Mar 15"
    );
    expect(describeRecurrence({ cadence: "weekly", startDate: "2026-01-01" })).toBe("every week");
    expect(describeRecurrence({ cadence: "biweekly", startDate: "2026-01-01" })).toBe(
      "every 2 weeks"
    );
  });

  test("a cadence with no anchor still says what it is", () => {
    expect(describeRecurrence(monthly(null))).toBe("monthly");
  });

  test("nothing at all is nothing, not a guess", () => {
    expect(describeRecurrence(null)).toBe("");
    expect(describeRecurrence({ cadence: "never" })).toBe("");
  });

  test("the 31st is the 31st, not the last day", () => {
    // `payDayLabel` in paySchedule reads 31 as "last day", which is true of a
    // payroll and wrong here: the day is clamped like any other overlong one
    // rather than *meaning* the end of the month.
    expect(ordinalDay(31)).toBe("31st");
    expect(ordinalDay(11)).toBe("11th");
    expect(ordinalDay(12)).toBe("12th");
    expect(ordinalDay(13)).toBe("13th");
    expect(ordinalDay(2)).toBe("2nd");
    expect(ordinalDay(3)).toBe("3rd");
  });
});

test("the upcoming window is four weeks of real days", () => {
  // Four weeks rather than a calendar month, so the question does not change size
  // with the month it is asked in.
  expect(upcomingThrough("2026-02-01")).toBe("2026-03-01");
  expect(upcomingThrough("2026-09-29", 7)).toBe("2026-10-06");
});
