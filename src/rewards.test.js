import {
  CATALOG,
  EARN_MODES,
  OFFER_KINDS,
  OFFER_STATUS,
  bestRateFor,
  cardEarnings,
  earnBps,
  feeYearWindow,
  formatMultiplier,
  offerOverlaps,
  PROGRESS_SOURCES,
  rankCardsFor,
  toPointsPer100Dollars,
  nextOfferWindow,
  offerProgress,
  achievedValuePer100Cents,
  formatPointValue,
  pointsAfterTransfer,
  programById,
  resolvedValuePer100Cents,
  summariseRewards,
  toPoints,
  toValuePer100Cents,
  transferSources,
  valueOfPointsCents,
} from "./rewards";

const balance = (id, programId, points, holder = null) => ({ id, programId, points, holder, asOf: null });
const trip = (id, programId, points, extra = {}) => ({
  id,
  name: id,
  date: null,
  programId,
  points,
  taxesCents: 0,
  cashPriceCents: null,
  ...extra,
});

describe("the catalog", () => {
  test("every transfer names a program the catalog has", () => {
    for (const program of CATALOG) {
      for (const transfer of program.transfers) {
        expect(programById(transfer.to)).not.toBeNull();
        expect(transfer.ratio.every((part) => Number.isInteger(part) && part > 0)).toBe(true);
      }
    }
  });

  test("ids are unique and every value is whole cents per hundred points", () => {
    expect(new Set(CATALOG.map((p) => p.id)).size).toBe(CATALOG.length);
    for (const program of CATALOG) expect(Number.isInteger(program.valuePer100Cents)).toBe(true);
  });
});

describe("valuation", () => {
  test("a typed value beats the catalog's, and blank falls back to it", () => {
    expect(resolvedValuePer100Cents("united", {})).toBe(130);
    expect(resolvedValuePer100Cents("united", { united: 115 })).toBe(115);
    // Zero is a real answer: points somebody never intends to use.
    expect(resolvedValuePer100Cents("united", { united: 0 })).toBe(0);
  });

  test("a balance is valued in whole cents, rounded once", () => {
    expect(valueOfPointsCents(100000, 130)).toBe(130000);
    expect(valueOfPointsCents(333, 45)).toBe(150);
  });

  test("values are typed the way they are said", () => {
    expect(toValuePer100Cents("1.3")).toBe(130);
    expect(toValuePer100Cents("1.35¢")).toBe(135);
    expect(toValuePer100Cents("0.6 cents")).toBe(60);
    expect(toValuePer100Cents("lots")).toBeNull();
    expect(toValuePer100Cents("-1")).toBeNull();
    expect(formatPointValue(135)).toBe("1.35¢");
  });

  test("points take commas, and nothing that is not a whole number", () => {
    expect(toPoints("125,000")).toBe(125000);
    expect(toPoints("1.5")).toBeNull();
    expect(toPoints("twelve")).toBeNull();
  });
});

describe("redemptions", () => {
  test("value per point is the fare saved, net of the cash still paid, over the points", () => {
    // $1,200 fare, $80 of taxes, 60,000 miles: $1,120 / 60,000 = 1.87¢.
    expect(achievedValuePer100Cents({ points: 60000, cashPriceCents: 120000, taxesCents: 8000 })).toBe(187);
    expect(achievedValuePer100Cents({ points: 60000, cashPriceCents: null, taxesCents: 0 })).toBeNull();
  });

  test("a transfer never pays out a fraction", () => {
    expect(pointsAfterTransfer(1001, [250, 200])).toBe(800);
    expect(pointsAfterTransfer(1000, [1, 2])).toBe(2000);
  });

  test("transfer sources are the bank currencies that list the program", () => {
    const sources = transferSources("hyatt").map((s) => s.programId).sort();
    expect(sources).toEqual(["bilt", "chase-ur"]);
  });

  test("a trip is paid from the program first, then by the largest transferable balance", () => {
    const summary = summariseRewards({
      balances: [
        balance("b1", "aeroplan", 20000),
        balance("b2", "chase-ur", 30000),
        balance("b3", "amex-mr", 50000),
      ],
      trips: [trip("tokyo", "aeroplan", 60000, { cashPriceCents: 150000, taxesCents: 10000 })],
    });
    const [plan] = summary.trips;

    expect(plan.fromProgram).toBe(20000);
    expect(plan.transfers).toEqual([{ programId: "amex-mr", ratio: [1, 1], sent: 40000, arrives: 40000 }]);
    expect(plan.covered).toBe(true);
    // $1,400 saved over 60,000 = 2.33¢, against Aeroplan's catalog 1.50¢.
    expect(plan.achievedPer100Cents).toBe(233);
    expect(plan.goodValue).toBe(true);
  });

  test("points promised to an earlier trip are not counted twice", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "united", 50000)],
      trips: [
        trip("later", "united", 40000, { date: "2027-06-01" }),
        trip("sooner", "united", 30000, { date: "2027-03-01" }),
      ],
    });
    const [later, sooner] = summary.trips;

    expect(sooner.covered).toBe(true);
    expect(later.fromProgram).toBe(20000);
    expect(later.shortfall).toBe(20000);
  });

  test("a ratio is rounded up on the way out so the trip is really covered", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "amex-mr", 100000)],
      trips: [trip("jfk", "jetblue", 1001)],
    });
    const [{ transfers, covered }] = summary.trips;
    expect(transfers[0].sent).toBe(1252);
    expect(transfers[0].arrives).toBeGreaterThanOrEqual(1001);
    expect(covered).toBe(true);
  });

  test("totals add every holder, at each program's resolved value", () => {
    const summary = summariseRewards({
      balances: [balance("b1", "united", 50000, "Alex"), balance("b2", "united", 25000, "Sam"), balance("b3", "hilton", 100000)],
      valuations: { united: 140 },
    });
    expect(summary.programs.map((row) => [row.program.id, row.points, row.valueCents])).toEqual([
      ["united", 75000, 105000],
      ["hilton", 100000, 50000],
    ]);
    expect(summary.totalValueCents).toBe(155000);
    expect(summary.valueByKind).toEqual({ bank: 0, airline: 105000, hotel: 50000, rail: 0 });
  });
});

describe("card offers", () => {
  const CARD = "card";
  const CHECKING = "checking";
  const dining = {
    id: "o1",
    name: "9% on dining",
    kind: OFFER_KINDS.CAP,
    accountId: CARD,
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    limitCents: 100000,
    allSpending: false,
    budgetIds: ["dining"],
    payeeIds: [],
    rateBps: 900,
    bonusPoints: null,
    programId: null,
  };
  const out = (id, date, amountCents, budgetId, accountId = CARD, extra = {}) => ({
    id,
    kind: "outflow",
    date,
    amountCents,
    budgetId,
    accountId,
    payeeId: null,
    splits: null,
    ...extra,
  });

  test("counts the card's spending in the mapped categories, inside the window, up to today", () => {
    const progress = offerProgress(
      dining,
      [
        out("a", "2026-09-05", 30000, "dining"),
        out("b", "2026-09-06", 50000, "groceries"), // not mapped
        out("c", "2026-08-31", 40000, "dining"), // before the window
        out("d", "2026-10-20", 10000, "dining"), // after today
        out("e", null, 10000, "dining"), // undated
        { id: "f", kind: "transfer", date: "2026-09-10", amountCents: 90000, accountId: CHECKING, toAccountId: CARD },
      ],
      "2026-10-08"
    );
    expect(progress.status).toBe(OFFER_STATUS.ACTIVE);
    expect(progress.qualifyingCents).toBe(30000);
    expect(progress.remainingCents).toBe(70000);
    expect(progress.earnedCents).toBe(2700);
    expect(progress.daysLeft).toBe(23);
    expect(progress.purchaseCount).toBe(1);
  });

  test("a refund in the category comes back off, a payee match counts, and a split counts only its part", () => {
    const offer = { ...dining, payeeIds: ["cafe"] };
    const progress = offerProgress(
      offer,
      [
        out("a", "2026-09-05", 30000, "dining"),
        { ...out("b", "2026-09-07", 5000, "dining"), kind: "inflow" },
        // Filed as groceries, but paid to the mapped payee.
        out("c", "2026-09-08", 2000, "groceries", CARD, { payeeId: "cafe" }),
        out("d", "2026-09-09", 12000, "dining", CARD, {
          splits: [
            { id: "p1", budgetId: "dining", amountCents: 4000 },
            { id: "p2", budgetId: "household", amountCents: 8000 },
          ],
        }),
        // Income on the card — a statement credit — is not a refund.
        { ...out("e", "2026-09-10", 7000, null), kind: "inflow" },
      ],
      "2026-10-08"
    );
    expect(progress.qualifyingCents).toBe(30000 - 5000 + 2000 + 4000);
  });

  test("past the cap is reported apart, and the offer says it is done", () => {
    const progress = offerProgress(dining, [out("a", "2026-09-05", 125000, "dining")], "2026-10-08");
    expect(progress.status).toBe(OFFER_STATUS.DONE);
    expect(progress.remainingCents).toBe(0);
    expect(progress.overCents).toBe(25000);
    // The bonus only applies up to the cap.
    expect(progress.earnedCents).toBe(9000);
  });

  test("spending elsewhere counts as missed only while the cap still had room", () => {
    const progress = offerProgress(
      dining,
      [
        out("a", "2026-09-01", 80000, "dining"),
        out("b", "2026-09-02", 30000, "dining", CHECKING), // $200 of room left: $200 missed
        out("c", "2026-09-03", 20000, "dining"), // fills the cap
        out("d", "2026-09-04", 40000, "dining", CHECKING), // after: rightly elsewhere
      ],
      "2026-10-08"
    );
    expect(progress.elsewhereCents).toBe(20000);
  });

  test("a spending target counts all spending and says what a week it takes", () => {
    const target = {
      ...dining,
      kind: OFFER_KINDS.TARGET,
      allSpending: true,
      budgetIds: [],
      startDate: "2026-09-01",
      endDate: "2026-11-30",
      limitCents: 400000,
      rateBps: null,
    };
    const progress = offerProgress(
      target,
      [out("a", "2026-09-05", 100000, "rent"), out("b", "2026-09-06", 50000, "dining")],
      "2026-10-08"
    );
    expect(progress.qualifyingCents).toBe(150000);
    expect(progress.remainingCents).toBe(250000);
    // 53 days left, today included: 54 days, $2,500 × 7 / 54.
    expect(progress.daysLeft).toBe(53);
    expect(progress.perWeekCents).toBe(Math.ceil((250000 * 7) / 54));
    expect(progress.earnedCents).toBeNull();
  });

  test("an offer not yet open and one already over say so", () => {
    expect(offerProgress({ ...dining, startDate: "2026-11-01", endDate: "2026-12-31" }, [], "2026-10-08").status).toBe(
      OFFER_STATUS.UPCOMING
    );
    const ended = offerProgress(
      { ...dining, startDate: "2026-07-01", endDate: "2026-09-30" },
      [out("a", "2026-09-30", 10000, "dining"), out("b", "2026-10-01", 10000, "dining")],
      "2026-10-08"
    );
    expect(ended.status).toBe(OFFER_STATUS.ENDED);
    expect(ended.qualifyingCents).toBe(10000);
    expect(ended.daysLeft).toBeNull();
  });

  test("the next round of a calendar quarter is the next calendar quarter", () => {
    expect(nextOfferWindow({ startDate: "2026-01-01", endDate: "2026-03-31" })).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    expect(nextOfferWindow({ startDate: "2026-10-01", endDate: "2026-12-31" })).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-03-31",
    });
    // Not month-aligned: stepped by its own length.
    expect(nextOfferWindow({ startDate: "2026-09-15", endDate: "2026-10-14" })).toEqual({
      startDate: "2026-10-15",
      endDate: "2026-11-13",
    });
    expect(nextOfferWindow({ startDate: "2026-09-15", endDate: null })).toBeNull();
  });
});

describe("credits to use up", () => {
  const CARD = "card";
  const travel = {
    id: "c1",
    name: "$300 travel credit",
    kind: OFFER_KINDS.CREDIT,
    accountId: CARD,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    limitCents: 30000,
    allSpending: false,
    budgetIds: ["travel"],
    payeeIds: [],
    rateBps: null,
    bonusPoints: null,
    programId: null,
  };
  const spend = (id, date, amountCents, budgetId, accountId = CARD) => ({
    id,
    kind: "outflow",
    date,
    amountCents,
    budgetId,
    accountId,
    payeeId: null,
    splits: null,
  });

  test("a credit pays back what it covers, and says what is left to use", () => {
    const progress = offerProgress(travel, [spend("a", "2026-03-04", 11000, "travel")], "2026-10-08");
    expect(progress.status).toBe(OFFER_STATUS.ACTIVE);
    expect(progress.qualifyingCents).toBe(11000);
    // 100% back, which nothing on the record had to state.
    expect(progress.earnedCents).toBe(11000);
    expect(progress.remainingCents).toBe(19000);
    // Paced like a target, since both are spending that has to happen by a date.
    expect(progress.perWeekCents).toBe(Math.ceil((19000 * 7) / (progress.daysLeft + 1)));
  });

  test("spending past a credit is ordinary spending, and a used credit is done", () => {
    const progress = offerProgress(travel, [spend("a", "2026-03-04", 50000, "travel")], "2026-10-08");
    expect(progress.status).toBe(OFFER_STATUS.DONE);
    expect(progress.earnedCents).toBe(30000);
    expect(progress.remainingCents).toBe(0);
    // Past a cap is spending at a worse rate; past a credit it is just a purchase.
    expect(progress.overCents).toBe(0);
    expect(progress.perWeekCents).toBeNull();
  });

  test("a credit that ended unused keeps the figure that was thrown away", () => {
    const progress = offerProgress(travel, [spend("a", "2026-02-04", 5000, "travel")], "2027-02-01");
    expect(progress.status).toBe(OFFER_STATUS.ENDED);
    expect(progress.remainingCents).toBe(25000);
    expect(progress.earnedCents).toBe(5000);
  });

  test("a credit's window either overlaps a fee year or it does not", () => {
    expect(offerOverlaps(travel, { from: "2026-06-01", through: "2026-10-08" })).toBe(true);
    expect(offerOverlaps(travel, { from: "2027-01-01", through: "2027-03-01" })).toBe(false);
    const open = { startDate: "2026-01-01", endDate: null };
    expect(offerOverlaps(open, { from: "2030-01-01", through: "2030-02-01" })).toBe(true);
  });

  describe("marked off by hand", () => {
    const hotel = {
      ...travel,
      id: "c2",
      name: "$300 hotel credit",
      progressSource: PROGRESS_SOURCES.MANUAL,
      usedCents: null,
    };

    test("ignores the ledger entirely, even a purchase on the mapped category and card", () => {
      const progress = offerProgress(
        { ...hotel, usedCents: 20000 },
        [spend("a", "2026-03-04", 11000, "travel")],
        "2026-10-08"
      );
      expect(progress.qualifyingCents).toBe(20000);
      expect(progress.remainingCents).toBe(10000);
      expect(progress.earnedCents).toBe(20000);
      expect(progress.elsewhereCents).toBe(0);
      expect(progress.purchaseCount).toBe(0);
    });

    test("nothing stated reads as nothing used, not an error", () => {
      const progress = offerProgress(hotel, [], "2026-10-08");
      expect(progress.qualifyingCents).toBe(0);
      expect(progress.remainingCents).toBe(30000);
      expect(progress.reached).toBe(false);
    });

    test("typing the full amount reaches it, like a ledger match would", () => {
      const progress = offerProgress({ ...hotel, usedCents: 30000 }, [], "2026-10-08");
      expect(progress.status).toBe(OFFER_STATUS.DONE);
      expect(progress.reached).toBe(true);
      expect(progress.remainingCents).toBe(0);
    });

    test("a cap or a target cannot be marked off by hand — only a credit reads the flag", () => {
      const cap = {
        ...travel,
        kind: OFFER_KINDS.CAP,
        progressSource: PROGRESS_SOURCES.MANUAL,
        usedCents: 99999999,
      };
      const progress = offerProgress(cap, [], "2026-10-08");
      expect(progress.qualifyingCents).toBe(0);
    });
  });
});

describe("what a card earns", () => {
  const cash = (id, rateBps, extra = {}) => ({
    id,
    accountId: "freedom",
    mode: EARN_MODES.CASHBACK,
    rateBps,
    programId: null,
    pointsPer100Dollars: null,
    allSpending: false,
    budgetIds: [],
    payeeIds: [],
    ...extra,
  });
  const earns = (id, pointsPer100Dollars, extra = {}) => ({
    id,
    accountId: "sapphire",
    mode: EARN_MODES.POINTS,
    rateBps: null,
    programId: "chase-ur",
    pointsPer100Dollars,
    allSpending: false,
    budgetIds: [],
    payeeIds: [],
    ...extra,
  });
  const spend = (id, date, amountCents, budgetId, accountId = "sapphire", extra = {}) => ({
    id,
    kind: "outflow",
    date,
    amountCents,
    budgetId,
    accountId,
    payeeId: null,
    splits: null,
    ...extra,
  });
  const refund = (id, date, amountCents, budgetId, accountId) => ({
    id,
    kind: "inflow",
    date,
    amountCents,
    budgetId,
    accountId,
    payeeId: null,
    splits: null,
  });

  test("a multiplier is read the way a card advertises it", () => {
    expect(toPointsPer100Dollars("3")).toBe(300);
    expect(toPointsPer100Dollars("3x")).toBe(300);
    expect(toPointsPer100Dollars("1.25X")).toBe(125);
    expect(toPointsPer100Dollars("1.5×")).toBe(150);
    expect(toPointsPer100Dollars("three")).toBeNull();
    expect(toPointsPer100Dollars("0")).toBeNull();
    // 500× is a percentage somebody typed into the wrong box.
    expect(toPointsPer100Dollars("500")).toBeNull();
    expect(formatMultiplier(300)).toBe("3×");
    expect(formatMultiplier(125)).toBe("1.25×");
    expect(formatMultiplier(150)).toBe("1.5×");
  });

  test("cash back and points meet on the share of the purchase they give back", () => {
    expect(earnBps(cash("r1", 200))).toBe(200);
    // Three points a dollar at the catalog's 1.70¢ is 5.1% back.
    expect(earnBps(earns("r2", 300))).toBe(510);
    // And the household's own valuation moves it, which is the whole point.
    expect(earnBps(earns("r2", 300), { "chase-ur": 100 })).toBe(300);
    expect(earnBps(earns("r2", 300), { "chase-ur": 0 })).toBe(0);
    expect(earnBps(null)).toBe(0);
  });

  test("one card pays its best matching rate, and nothing where it claims none", () => {
    const rates = [
      earns("base", 100, { allSpending: true }),
      earns("dining", 300, { budgetIds: ["dining"] }),
      earns("amazon", 500, { payeeIds: ["amz"] }),
    ];
    expect(bestRateFor(rates, { budgetId: "dining" }).id).toBe("dining");
    expect(bestRateFor(rates, { budgetId: "groceries" }).id).toBe("base");
    expect(bestRateFor(rates, { payeeId: "amz", budgetId: "dining" }).id).toBe("amazon");
    const only = [earns("dining", 300, { budgetIds: ["dining"] })];
    expect(bestRateFor(only, { budgetId: "fuel" })).toBeNull();
  });

  test("the cards are ranked for one kind of spending, best first", () => {
    const cards = [
      { accountId: "freedom", rates: [cash("f", 500, { budgetIds: ["groceries"] })] },
      { accountId: "sapphire", rates: [earns("s", 300, { budgetIds: ["groceries", "dining"] })] },
      { accountId: "plain", rates: [cash("p", 150, { allSpending: true })] },
    ];
    // 3× points beats 5% cash, because this household says a point is 1.70¢.
    expect(rankCardsFor(cards, { budgetId: "groceries" }).map((row) => [row.accountId, row.bps])).toEqual([
      ["sapphire", 510],
      ["freedom", 500],
      ["plain", 150],
    ]);
    // Value the points at a cent and the cashback card wins the same purchase.
    expect(
      rankCardsFor(cards, { budgetId: "groceries" }, { "chase-ur": 100 }).map((row) => row.accountId)
    ).toEqual(["freedom", "sapphire", "plain"]);
    // Dining: only the two cards that claim anything at all.
    expect(rankCardsFor(cards, { budgetId: "dining" }).map((row) => row.accountId)).toEqual([
      "sapphire",
      "plain",
    ]);
  });

  test("earnings are the ledger read at those rates, over the window and nothing else", () => {
    const earned = cardEarnings({
      accountId: "sapphire",
      rates: [earns("base", 100, { allSpending: true }), earns("dining", 300, { budgetIds: ["dining"] })],
      transactions: [
        spend("a", "2026-03-01", 10000, "dining"),
        spend("b", "2026-03-02", 10000, "groceries"),
        spend("c", "2025-12-31", 90000, "dining"), // before the window
        spend("d", "2026-12-01", 90000, "dining"), // after it
        spend("e", null, 90000, "dining"), // undated
        spend("f", "2026-03-03", 90000, "dining", "freedom"), // another card
        // A transfer is never a purchase, whatever it looks like.
        {
          id: "g",
          kind: "transfer",
          date: "2026-03-04",
          amountCents: 50000,
          accountId: "sapphire",
          toAccountId: "chk",
        },
        // A refund takes its earnings back, off the rate that paid them.
        refund("h", "2026-03-05", 2000, "dining", "sapphire"),
      ],
      from: "2026-01-01",
      through: "2026-10-08",
    });

    // $100 of dining at 3× less a $20 refund, and $100 of groceries at 1×.
    expect(earned.byRate.map((row) => [row.rate.id, row.points])).toEqual([
      ["dining", 240],
      ["base", 100],
    ]);
    expect(earned.points).toEqual([
      {
        programId: "chase-ur",
        program: expect.objectContaining({ id: "chase-ur" }),
        points: 340,
        valueCents: 578,
      },
    ]);
    expect(earned.valueCents).toBe(578);
    expect(earned.cashCents).toBe(0);
    expect(earned.unratedCents).toBe(0);
  });

  test("a divided receipt earns part by part, and uncovered spending is claimed for nothing", () => {
    const earned = cardEarnings({
      accountId: "freedom",
      rates: [cash("groceries", 500, { budgetIds: ["groceries"] })],
      transactions: [
        spend("a", "2026-03-01", 12000, null, "freedom", {
          splits: [
            { budgetId: "groceries", amountCents: 10000 },
            { budgetId: "fuel", amountCents: 2000 },
          ],
        }),
      ],
      from: "2026-01-01",
      through: "2026-10-08",
    });
    expect(earned.cashCents).toBe(500);
    expect(earned.unratedCents).toBe(2000);
    expect(earned.spendCents).toBe(12000);
  });

  test("a rate refunded past what it earned is floored, never taken off another", () => {
    const earned = cardEarnings({
      accountId: "freedom",
      rates: [
        cash("groceries", 500, { budgetIds: ["groceries"] }),
        cash("base", 100, { allSpending: true }),
      ],
      transactions: [
        refund("r", "2026-03-05", 20000, "groceries", "freedom"),
        spend("b", "2026-03-06", 10000, "fuel", "freedom"),
      ],
      from: "2026-01-01",
      through: "2026-10-08",
    });
    expect(earned.cashCents).toBe(100);
  });

  test("the fee year is the year the fee bought, or the calendar year with none stated", () => {
    expect(feeYearWindow(null, "2026-10-08")).toEqual({
      from: "2026-01-01",
      through: "2026-10-08",
      renewsOn: null,
      calendar: true,
    });
    // A renewal already past this year: the year running now started on it.
    expect(feeYearWindow("2026-03-01", "2026-10-08")).toEqual({
      from: "2026-03-01",
      through: "2026-10-08",
      renewsOn: "2027-03-01",
      calendar: false,
    });
    // One still to come this year: today is inside the year before it.
    expect(feeYearWindow("2026-12-01", "2026-10-08")).toEqual({
      from: "2025-12-01",
      through: "2026-10-08",
      renewsOn: "2026-12-01",
      calendar: false,
    });
    // The day the card was taken out, years ago, still anchors the anniversary.
    expect(feeYearWindow("2019-06-15", "2026-10-08").from).toBe("2026-06-15");
    // 29 February lands on the 28th in a year that has no 29th.
    expect(feeYearWindow("2024-02-29", "2026-10-08").from).toBe("2026-02-28");
  });
});
