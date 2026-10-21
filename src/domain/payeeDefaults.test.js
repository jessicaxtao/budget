import {
  SHARES_WHOLE,
  describeDefaultSplitProblem,
  describeShares,
  liveShares,
  partsForTotal,
  sameShares,
  sharesFromSplits,
} from "./payeeDefaults";

/**
 * The arithmetic behind a payee's remembered split. The claim the feature rests
 * on is the ledger's sum rule: whatever total is typed, the parts laid out from
 * the shares add up to it exactly — asserted here against totals that do not
 * divide evenly, since an even one would pass with any rounding at all.
 */

const SEVENTY_THIRTY = [
  { budgetId: "food", shareBps: 7000 },
  { budgetId: "home", shareBps: 3000 },
];

describe("laying the shares out against a total", () => {
  test("the parts add up to the total exactly, whatever it is", () => {
    const thirds = [
      { budgetId: "a", shareBps: 3334 },
      { budgetId: "b", shareBps: 3333 },
      { budgetId: "c", shareBps: 3333 },
    ];
    for (const total of [1, 2, 99, 100, 1001, 12345, 999999]) {
      for (const shares of [SEVENTY_THIRTY, thirds]) {
        const parts = partsForTotal(shares, total);
        expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      }
    }
  });

  test("a total not yet typed lays out no figures", () => {
    expect(partsForTotal(SEVENTY_THIRTY, null)).toEqual([null, null]);
  });

  test("shares left after a category is dropped still divide the whole receipt", () => {
    const shares = liveShares(
      [...SEVENTY_THIRTY, { budgetId: "gone", shareBps: 0 }],
      ["food", "home"]
    );
    expect(shares).toEqual(SEVENTY_THIRTY);
    const live = liveShares(
      [
        { budgetId: "food", shareBps: 5000 },
        { budgetId: "home", shareBps: 2500 },
        { budgetId: "gone", shareBps: 2500 },
      ],
      ["food", "home"]
    );
    expect(partsForTotal(live, 300)).toEqual([200, 100]);
  });
});

describe("learning shares off a receipt", () => {
  test("a receipt's parts become shares adding up to the whole", () => {
    const shares = sharesFromSplits([
      { budgetId: "food", amountCents: 8680 },
      { budgetId: "home", amountCents: 3720 },
    ]);
    expect(shares).toEqual(SEVENTY_THIRTY);

    const uneven = sharesFromSplits([
      { budgetId: "a", amountCents: 100 },
      { budgetId: "b", amountCents: 100 },
      { budgetId: "c", amountCents: 100 },
    ]);
    expect(uneven.reduce((sum, part) => sum + part.shareBps, 0)).toBe(SHARES_WHOLE);
    expect(describeDefaultSplitProblem(uneven)).toBeNull();
  });

  test("a part too small to be any share is not remembered as a division nobody made", () => {
    expect(
      sharesFromSplits([
        { budgetId: "food", amountCents: 1 },
        { budgetId: "home", amountCents: 10000000 },
      ])
    ).toBeNull();
    expect(sharesFromSplits([{ budgetId: "food", amountCents: 100 }])).toBeNull();
  });
});

describe("the stored shape", () => {
  test("only two or more positive whole shares adding up to the whole are a split", () => {
    expect(describeDefaultSplitProblem(null)).toBeNull();
    expect(describeDefaultSplitProblem(SEVENTY_THIRTY)).toBeNull();
    expect(describeDefaultSplitProblem([{ budgetId: "food", shareBps: 10000 }])).not.toBeNull();
    expect(
      describeDefaultSplitProblem([
        { budgetId: "food", shareBps: 7000 },
        { budgetId: "home", shareBps: 2999 },
      ])
    ).not.toBeNull();
    expect(
      describeDefaultSplitProblem([
        { budgetId: "", shareBps: 7000 },
        { budgetId: "home", shareBps: 3000 },
      ])
    ).not.toBeNull();
  });

  test("two divisions are the same only part for part", () => {
    expect(sameShares(SEVENTY_THIRTY, [...SEVENTY_THIRTY])).toBe(true);
    expect(sameShares(SEVENTY_THIRTY, [...SEVENTY_THIRTY].reverse())).toBe(false);
    expect(sameShares(SEVENTY_THIRTY, null)).toBe(false);
    expect(sameShares(null, null)).toBe(true);
  });

  test("a division reads as named percentages", () => {
    const names = { food: "Groceries", home: "Household" };
    expect(describeShares(SEVENTY_THIRTY, (id) => names[id])).toBe("Groceries 70% · Household 30%");
    expect(
      describeShares(
        [
          { budgetId: "food", shareBps: 6667 },
          { budgetId: "gone", shareBps: 3333 },
        ],
        (id) => names[id]
      )
    ).toBe("Groceries 66.67% · Unknown category 33.33%");
  });
});
