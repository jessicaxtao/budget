import { TRANSACTION_KINDS } from "./contexts/TransactionsContext";
import {
  EMPTY_FILTER,
  FILTER_SPANS,
  activeFilterCount,
  filterTransactions,
  matchesFilter,
  readFilter,
  sameFilter,
} from "./transactionFilter";

/**
 * Which rows answer a filter, as the function it is. The control that sets one
 * is `TransactionFilterBar`'s suite through the page; what is here is the rule,
 * which is the half two things have to agree about — the register, and a filter
 * read back out of storage months later.
 */
const PERIOD = "2026-08";

const PAYEES = new Map([
  ["p1", { id: "p1", name: "Trader Joe's" }],
  ["p2", { id: "p2", name: "Acme Payroll" }],
]);

const context = { payeeById: PAYEES, period: PERIOD };

const SPEND = {
  id: "t1",
  kind: TRANSACTION_KINDS.OUTFLOW,
  payeeId: "p1",
  description: "weekly shop #food",
  amountCents: 9840,
  date: "2026-08-11",
  accountId: "acc1",
  toAccountId: null,
  budgetId: "b1",
  splits: null,
};

const PAY = {
  id: "t2",
  kind: TRANSACTION_KINDS.INFLOW,
  payeeId: "p2",
  description: "",
  amountCents: 214000,
  date: "2026-08-01",
  accountId: "acc1",
  toAccountId: null,
  budgetId: null,
  splits: null,
};

const LAST_MONTH = { ...SPEND, id: "t3", date: "2026-07-02", description: "old shop" };

// Folded in from before the ledger tracked dates, so it names nobody and
// carries its own figure — the fixtures are deliberately distinct in every field
// the facets read, or a test could pass for the wrong reason.
const UNDATED = {
  ...SPEND,
  id: "t4",
  date: null,
  description: "folded in",
  payeeId: null,
  amountCents: 2000,
};

const TRANSFER = {
  id: "t5",
  kind: TRANSACTION_KINDS.TRANSFER,
  payeeId: null,
  description: "card payment",
  amountCents: 20000,
  date: "2026-08-20",
  accountId: "acc1",
  toAccountId: "acc2",
  budgetId: null,
  splits: null,
};

const RECEIPT = {
  ...SPEND,
  id: "t6",
  description: "costco run",
  budgetId: null,
  amountCents: 12400,
  splits: [
    { id: "s1", budgetId: "b2", amountCents: 9000 },
    { id: "s2", budgetId: "b3", amountCents: 3400 },
  ],
};

const ALL = [SPEND, PAY, LAST_MONTH, UNDATED, TRANSFER, RECEIPT];

const idsFor = (filter) =>
  filterTransactions(ALL, filter, context).map((transaction) => transaction.id);

describe("the window", () => {
  test("the month on screen by default, and an undated row in every month", () => {
    // The undated band's own rule, read as a filter: a record belonging to no
    // month must not be dropped from all of them.
    expect(idsFor(EMPTY_FILTER)).toEqual(["t1", "t2", "t4", "t5", "t6"]);
  });

  test("all time is what a search widens to", () => {
    expect(idsFor({ span: FILTER_SPANS.ALL })).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });
});

describe("the text", () => {
  test("finds a payee, a note, or the amount", () => {
    expect(idsFor({ text: "trader" })).toEqual(["t1", "t6"]);
    expect(idsFor({ text: "weekly" })).toEqual(["t1"]);
    // Folded through `searchKey`, the payee search's own folding, so "joes"
    // finds "Joe's" here exactly as it does in the entry form.
    expect(idsFor({ text: "joes" })).toEqual(["t1", "t6"]);
  });

  test("the amount is searchable however it is written", () => {
    // "find the ninety-eight dollar one" is how a statement gets reconciled.
    expect(idsFor({ text: "98.40" })).toEqual(["t1"]);
    expect(idsFor({ text: "$98.40" })).toEqual(["t1"]);
    expect(idsFor({ text: "9840" })).toEqual(["t1"]);
  });

  test("a tag typed into the box finds the rows carrying it", () => {
    expect(idsFor({ text: "#food" })).toEqual(["t1"]);
  });

  test("the category and the account are deliberately not searched", () => {
    // Each has a facet that answers exactly; folding their names into the text
    // box would widen a search with nothing on screen to say which rule matched.
    expect(idsFor({ text: "b1" })).toEqual([]);
    expect(idsFor({ text: "acc1" })).toEqual([]);
  });
});

describe("the facets", () => {
  test("a direction is any of those ticked", () => {
    expect(idsFor({ kinds: [TRANSACTION_KINDS.INFLOW] })).toEqual(["t2"]);
    expect(
      idsFor({ kinds: [TRANSACTION_KINDS.INFLOW, TRANSACTION_KINDS.TRANSFER] })
    ).toEqual(["t2", "t5"]);
  });

  test("a category matches a divided receipt through any of its parts", () => {
    // The reading `getBudgetTransactions` takes: the row is a movement of money
    // that touched that envelope.
    expect(idsFor({ budgetIds: ["b2"] })).toEqual(["t6"]);
    expect(idsFor({ budgetIds: ["b1"] })).toEqual(["t1", "t4"]);
  });

  test("no category is an answer, not an absence", () => {
    // Income into the pool, and the transfer that names none either.
    expect(idsFor({ budgetIds: [null] })).toEqual(["t2", "t5"]);
  });

  test("an account matches either end of a transfer", () => {
    expect(idsFor({ accountIds: ["acc2"] })).toEqual(["t5"]);
    expect(idsFor({ accountIds: ["acc1"] })).toEqual(["t1", "t2", "t4", "t5", "t6"]);
  });

  test("a detached row is reachable without every other row coming with it", () => {
    // Every record that is not a transfer carries `toAccountId: null`, so a
    // filter asking for the rows with no account would match all of them if the
    // far end were consulted where there is none.
    const detached = { ...SPEND, id: "t7", accountId: null };
    expect(
      filterTransactions([...ALL, detached], { accountIds: [null] }, context).map((row) => row.id)
    ).toEqual(["t7"]);
  });

  test("an amount range is inclusive at both ends", () => {
    expect(idsFor({ minCents: 9840, maxCents: 9840 })).toEqual(["t1"]);
    expect(idsFor({ minCents: 20000 })).toEqual(["t2", "t5"]);
    expect(idsFor({ maxCents: 12400 })).toEqual(["t1", "t4", "t6"]);
  });

  test("a second tag narrows rather than widens", () => {
    const gift = { ...SPEND, id: "t8", description: "present #food #gift" };
    const books = [...ALL, gift];
    const ids = (filter) => filterTransactions(books, filter, context).map((row) => row.id);

    expect(ids({ tags: ["food"] })).toEqual(["t1", "t8"]);
    // Clicking a second tag is somebody narrowing — "the food that was also a
    // gift" — so a list that widened would make the second click undo the first.
    expect(ids({ tags: ["food", "gift"] })).toEqual(["t8"]);
  });

  test("facets are all-of across one another", () => {
    expect(idsFor({ text: "trader", kinds: [TRANSACTION_KINDS.OUTFLOW], budgetIds: ["b1"] })).toEqual(
      ["t1"]
    );
    expect(idsFor({ text: "trader", budgetIds: ["b2"] })).toEqual(["t6"]);
  });
});

describe("a filter as a stored thing", () => {
  test("an unreadable facet becomes the empty one rather than refusing the filter", () => {
    // A saved search is a convenience: dropping the condition nobody can read
    // shows more rows than were asked for rather than fewer, and never an error.
    expect(readFilter({ span: "fortnight", kinds: ["sideways"], minCents: 12.5 })).toEqual(
      EMPTY_FILTER
    );
    expect(readFilter(null)).toEqual(EMPTY_FILTER);
    expect(readFilter("nonsense")).toEqual(EMPTY_FILTER);
  });

  test("tags are folded on the way in, so one tag cannot be asked for twice", () => {
    expect(readFilter({ tags: ["Holiday", "holiday", "", null] }).tags).toEqual(["holiday"]);
  });

  test("two filters that say the same thing are the same filter", () => {
    expect(sameFilter({ budgetIds: ["b1", "b2"] }, { budgetIds: ["b2", "b1"] })).toBe(true);
    expect(sameFilter({ text: " costco " }, { text: "costco" })).toBe(true);
    expect(sameFilter({ budgetIds: ["b1"] }, { budgetIds: [] })).toBe(false);
  });

  test("the count is what is in force, and the window counts as one", () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    // The condition a reader is likeliest to forget they set, and the one that
    // most changes what they are looking at.
    expect(activeFilterCount({ span: FILTER_SPANS.ALL })).toBe(1);
    expect(activeFilterCount({ text: "a", tags: ["x", "y"], minCents: 100 })).toBe(4);
  });

  test("one row answers the same question on its own", () => {
    expect(matchesFilter(SPEND, { text: "weekly" }, context)).toBe(true);
    expect(matchesFilter(PAY, { text: "weekly" }, context)).toBe(false);
  });
});
