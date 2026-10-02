import { matchPayees, orderPayeesByUse, searchKey } from "./payeeSearch";

/**
 * The payee search as the pure function it is, the way `paySchedule.test.js`
 * drives the calendar arithmetic. What the control does with a match —
 * when the list opens, what the keyboard does — is `PayeeField`'s business and is
 * tested there.
 *
 * Every name here is one a real list would hold, because what this module has to
 * get right is exactly what punctuation does to a search: an apostrophe, an
 * ampersand and a hyphen are the three characters that make a payee list
 * unsearchable if they are taken literally.
 */
const payee = (name, id = name) => ({ id, name, defaultBudgetId: null });

const PAYEES = [
  payee("AT&T"),
  payee("Acme Payroll"),
  payee("Costco"),
  payee("Costco Gas"),
  payee("Joe's Pizza"),
  payee("Trader Joe's"),
  payee("Wal-Mart"),
];

const names = (result) => result.matches.map((entry) => entry.name);

describe("what a name comes down to for matching", () => {
  test("punctuation and spacing come out, case folds", () => {
    expect(searchKey("AT&T")).toBe("att");
    expect(searchKey("Joe's Pizza")).toBe("joespizza");
    expect(searchKey("Wal-Mart")).toBe("walmart");
    expect(searchKey("  Costco   Gas ")).toBe("costcogas");
  });

  test("nothing in is nothing out, rather than a crash", () => {
    expect(searchKey(null)).toBe("");
    expect(searchKey(undefined)).toBe("");
  });
});

describe("which payees a query might mean", () => {
  test("a prefix matches", () => {
    expect(names(matchPayees(PAYEES, "cost"))).toEqual(["Costco", "Costco Gas"]);
  });

  test("case does not matter", () => {
    expect(names(matchPayees(PAYEES, "COSTCO GAS"))).toEqual(["Costco Gas"]);
  });

  test("punctuation typed or omitted finds the same payee", () => {
    // The three characters a payee list lives or dies by.
    expect(names(matchPayees(PAYEES, "att"))).toEqual(["AT&T"]);
    expect(names(matchPayees(PAYEES, "at&t"))).toEqual(["AT&T"]);
    expect(names(matchPayees(PAYEES, "walmart"))).toEqual(["Wal-Mart"]);
    expect(names(matchPayees(PAYEES, "wal-mart"))).toEqual(["Wal-Mart"]);
    expect(names(matchPayees(PAYEES, "joes"))).toEqual(["Joe's Pizza", "Trader Joe's"]);
  });

  test("a match inside the name counts, and ranks below one that starts it", () => {
    // "Joe's Pizza" starts with the query; "Trader Joe's" only contains it. Both
    // are right answers and the order is what makes the first one pickable with
    // one arrow key.
    expect(names(matchPayees(PAYEES, "joe"))).toEqual(["Joe's Pizza", "Trader Joe's"]);
  });

  test("an exact name leads, even where a longer one also matches", () => {
    expect(names(matchPayees(PAYEES, "costco"))).toEqual(["Costco", "Costco Gas"]);
  });

  test("four ranks, in the order they are worth reading", () => {
    const list = [
      // Lands inside a word: the weakest match there is.
      payee("Apizza Co"),
      // Starts the second word.
      payee("Hut Pizza"),
      // Starts the name.
      payee("Pizzazz Salon"),
      // Is the name.
      payee("Pizza"),
    ];
    // Exact, then what starts the name, then what starts a word in it, then what
    // merely occurs somewhere. The word boundary is what separates the last two,
    // and it survives the punctuation being folded away.
    expect(names(matchPayees(list, "pizza"))).toEqual([
      "Pizza",
      "Pizzazz Salon",
      "Hut Pizza",
      "Apizza Co",
    ]);
  });

  test("ties break alphabetically, so the list never reshuffles on its own", () => {
    const list = [payee("Zebra Cafe"), payee("Apple Cafe"), payee("Mango Cafe")];
    expect(names(matchPayees(list, "cafe"))).toEqual(["Apple Cafe", "Mango Cafe", "Zebra Cafe"]);
  });

  test("nothing matching is an empty list rather than everything", () => {
    expect(matchPayees(PAYEES, "zzz")).toEqual({ matches: [], moreCount: 0 });
  });

  test("an empty query offers the list as it was handed over", () => {
    // Not "no matches": a field that showed nothing until the first keystroke
    // would hide the fact that there is a list at all. The order is the caller's,
    // which is how the most recently used payees get to the top.
    expect(names(matchPayees(PAYEES, ""))).toEqual(PAYEES.slice(0, 7).map((p) => p.name));
    expect(names(matchPayees(PAYEES, "   "))).toHaveLength(7);
  });

  test("the cap holds and says how many it is not showing", () => {
    const many = Array.from({ length: 12 }, (_, index) => payee(`Cafe ${index}`, `c${index}`));
    const result = matchPayees(many, "cafe", { limit: 8 });
    // A truncated list must never look like a complete one.
    expect(result.matches).toHaveLength(8);
    expect(result.moreCount).toBe(4);
  });

  test("a list that is not a list is no matches, not a crash", () => {
    expect(matchPayees(undefined, "cost")).toEqual({ matches: [], moreCount: 0 });
  });
});

describe("the order a field offers before anything is typed", () => {
  const LEDGER = [
    { id: "t1", payeeId: "Costco", date: "2026-03-02" },
    { id: "t2", payeeId: "AT&T", date: "2026-09-14" },
    { id: "t3", payeeId: "Costco", date: "2026-08-30" },
    // Undated: evidence the payee has been used, and none at all about when.
    { id: "t4", payeeId: "Wal-Mart", date: null },
  ];

  test("most recently transacted with first, then the rest by name", () => {
    const ordered = orderPayeesByUse(PAYEES, LEDGER).map((entry) => entry.name);
    expect(ordered.slice(0, 3)).toEqual(["AT&T", "Costco", "Wal-Mart"]);
    // Everything never used follows, alphabetically, rather than in whatever
    // order the store happens to hold it.
    expect(ordered.slice(3)).toEqual(["Acme Payroll", "Costco Gas", "Joe's Pizza", "Trader Joe's"]);
  });

  test("a payee's latest transaction is what places it, not its first", () => {
    const ordered = orderPayeesByUse([payee("Costco"), payee("AT&T")], LEDGER);
    // Costco's earliest row is March and AT&T's only row is September; ordering on
    // the earliest would put a shop used weekly behind one used once a year.
    expect(ordered.map((entry) => entry.name)).toEqual(["AT&T", "Costco"]);
  });

  test("rows naming nobody are ignored rather than counted", () => {
    const ordered = orderPayeesByUse([payee("Costco")], [{ id: "t9", payeeId: null, date: "2026-12-01" }]);
    expect(ordered.map((entry) => entry.name)).toEqual(["Costco"]);
  });
});
