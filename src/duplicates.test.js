import { findDuplicates } from "./duplicates";

// Every date is a real day written out, `paySchedule.test.js`'s rule: the
// window is counted in calendar days, so a fixture derived from today would
// test nothing about where it ends.
const LOGGED = {
  id: "t1",
  kind: "outflow",
  amountCents: 1250,
  accountId: "chk",
  toAccountId: null,
  payeeId: "shop",
  budgetId: "groceries",
  splits: null,
  description: "",
  date: "2026-10-15",
};

const candidate = (overrides = {}) => ({
  kind: "outflow",
  amountCents: 1250,
  accountId: "chk",
  toAccountId: null,
  payeeId: "shop",
  date: "2026-10-15",
  ...overrides,
});

describe("findDuplicates", () => {
  test("the same direction, amount, account and payee on the same day is a match", () => {
    expect(findDuplicates(candidate(), [LOGGED])).toEqual([LOGGED]);
  });

  test("three days either side still matches; a fourth does not", () => {
    expect(findDuplicates(candidate({ date: "2026-10-18" }), [LOGGED])).toEqual([LOGGED]);
    expect(findDuplicates(candidate({ date: "2026-10-12" }), [LOGGED])).toEqual([LOGGED]);
    expect(findDuplicates(candidate({ date: "2026-10-19" }), [LOGGED])).toEqual([]);
    expect(findDuplicates(candidate({ date: "2026-10-11" }), [LOGGED])).toEqual([]);
  });

  test("the window crosses a month end by calendar days", () => {
    const logged = { ...LOGGED, date: "2026-10-30" };
    expect(findDuplicates(candidate({ date: "2026-11-02" }), [logged])).toEqual([logged]);
  });

  test("a different amount, account or direction is a different transaction", () => {
    expect(findDuplicates(candidate({ amountCents: 1251 }), [LOGGED])).toEqual([]);
    expect(findDuplicates(candidate({ accountId: "card" }), [LOGGED])).toEqual([]);
    expect(findDuplicates(candidate({ kind: "inflow" }), [LOGGED])).toEqual([]);
  });

  test("two named payees that differ rule a match out; a missing one does not", () => {
    expect(findDuplicates(candidate({ payeeId: "other" }), [LOGGED])).toEqual([]);
    expect(findDuplicates(candidate({ payeeId: null }), [LOGGED])).toEqual([LOGGED]);
    expect(findDuplicates(candidate(), [{ ...LOGGED, payeeId: null }])).toHaveLength(1);
  });

  test("a payee not yet on file is not the payee of any logged entry", () => {
    const ask = candidate({ payeeId: null, newPayee: true });
    expect(findDuplicates(ask, [LOGGED])).toEqual([]);
    expect(findDuplicates(ask, [{ ...LOGGED, payeeId: null }])).toHaveLength(1);
  });

  test("the category plays no part", () => {
    expect(findDuplicates(candidate(), [{ ...LOGGED, budgetId: "dining" }])).toHaveLength(1);
  });

  test("a transfer matches only the same pair of accounts", () => {
    const transfer = { ...LOGGED, kind: "transfer", toAccountId: "sav", payeeId: null };
    const ask = candidate({ kind: "transfer", toAccountId: "sav", payeeId: null });
    expect(findDuplicates(ask, [transfer])).toEqual([transfer]);
    expect(findDuplicates({ ...ask, toAccountId: "card" }, [transfer])).toEqual([]);
  });

  test("an undated record is never a match, and nothing is asked without an amount or a date", () => {
    expect(findDuplicates(candidate(), [{ ...LOGGED, date: null }])).toEqual([]);
    expect(findDuplicates(candidate({ amountCents: null }), [LOGGED])).toEqual([]);
    expect(findDuplicates(candidate({ date: "" }), [LOGGED])).toEqual([]);
  });

  test("matches come back nearest in date first", () => {
    const far = { ...LOGGED, id: "far", date: "2026-10-13" };
    const near = { ...LOGGED, id: "near", date: "2026-10-16" };
    expect(findDuplicates(candidate(), [far, near]).map((entry) => entry.id)).toEqual([
      "near",
      "far",
    ]);
  });
});
