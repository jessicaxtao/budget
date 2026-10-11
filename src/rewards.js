/**
 * Credit card rewards as arithmetic: the built-in catalog of programs, what a
 * point is worth, and whether a planned redemption can be reached.
 *
 * A pure module like `paySchedule.js` and `chartAxis.js` — no React, no store,
 * no wording beyond the figures themselves — so the page and the tests read the
 * same answers.
 *
 * **A point's value is an integer number of cents per hundred points**
 * (`valuePer100Cents`), the money-is-cents discipline carried one step down: a
 * mile worth 1.3¢ is 130, and a hotel point worth 0.45¢ is 45. Fractional cents
 * per point are the ordinary case here, and a float multiplied by a six-figure
 * balance is exactly where drift shows up as a dollar on screen.
 *
 * **The catalog is built in and the values in it are starting points, not
 * facts.** What a mile is worth depends on how it is spent, so every program's
 * figure can be overridden by the household and the override is what every
 * total reads. The catalog value is still shown beside it, so a figure typed in
 * a hurry can be compared against something.
 *
 * **Transfer partners are listed for the flexible bank currencies only**, as
 * `[from, to]` ratios. They change without notice, so the page says to confirm
 * before moving points — a transfer is irreversible, and nothing here can know
 * about this month's bonus or last month's devaluation.
 */

import { daysBetween, todayISO } from "./utils";

export const PROGRAM_KINDS = {
  BANK: "bank",
  AIRLINE: "airline",
  HOTEL: "hotel",
  RAIL: "rail",
};

export const PROGRAM_KIND_ORDER = [
  PROGRAM_KINDS.BANK,
  PROGRAM_KINDS.AIRLINE,
  PROGRAM_KINDS.HOTEL,
  PROGRAM_KINDS.RAIL,
];

export const PROGRAM_KIND_LABELS = {
  [PROGRAM_KINDS.BANK]: "Card points",
  [PROGRAM_KINDS.AIRLINE]: "Airline miles",
  [PROGRAM_KINDS.HOTEL]: "Hotel points",
  [PROGRAM_KINDS.RAIL]: "Rail points",
};

const one = (to) => ({ to, ratio: [1, 1] });

const airline = (id, name, valuePer100Cents) => ({
  id,
  name,
  kind: PROGRAM_KINDS.AIRLINE,
  unit: "miles",
  valuePer100Cents,
  transfers: [],
});

const hotel = (id, name, valuePer100Cents) => ({
  id,
  name,
  kind: PROGRAM_KINDS.HOTEL,
  unit: "points",
  valuePer100Cents,
  transfers: [],
});

const rail = (id, name, valuePer100Cents) => ({
  id,
  name,
  kind: PROGRAM_KINDS.RAIL,
  unit: "points",
  valuePer100Cents,
  transfers: [],
});

const bank = (id, name, valuePer100Cents, transfers) => ({
  id,
  name,
  kind: PROGRAM_KINDS.BANK,
  unit: "points",
  valuePer100Cents,
  transfers,
});

export const CATALOG = [
  bank("chase-ur", "Chase Ultimate Rewards", 170, [
    one("united"),
    one("southwest"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("jetblue"),
    one("hyatt"),
    one("marriott"),
    one("ihg"),
  ]),
  bank("amex-mr", "Amex Membership Rewards", 170, [
    one("delta"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    { to: "jetblue", ratio: [250, 200] },
    { to: "hilton", ratio: [1, 2] },
    one("marriott"),
    one("choice"),
  ]),
  bank("citi-ty", "Citi ThankYou Points", 160, [
    one("aadvantage"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    one("turkish"),
    one("jetblue"),
    { to: "choice", ratio: [1, 2] },
    one("wyndham"),
  ]),
  bank("capital-one", "Capital One Miles", 160, [
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("krisflyer"),
    one("lifemiles"),
    one("turkish"),
    one("wyndham"),
    one("choice"),
  ]),
  bank("bilt", "Bilt Rewards", 180, [
    one("united"),
    one("aadvantage"),
    one("alaska"),
    one("aeroplan"),
    one("avios"),
    one("flying-blue"),
    one("virgin"),
    one("turkish"),
    one("hyatt"),
    one("ihg"),
    one("marriott"),
    one("hilton"),
    one("amtrak"),
  ]),
  airline("united", "United MileagePlus", 130),
  airline("delta", "Delta SkyMiles", 120),
  airline("aadvantage", "American AAdvantage", 150),
  airline("southwest", "Southwest Rapid Rewards", 135),
  airline("alaska", "Alaska Mileage Plan", 150),
  airline("jetblue", "JetBlue TrueBlue", 130),
  airline("aeroplan", "Air Canada Aeroplan", 150),
  airline("avios", "British Airways Avios", 140),
  airline("flying-blue", "Air France-KLM Flying Blue", 130),
  airline("virgin", "Virgin Atlantic Flying Club", 140),
  airline("krisflyer", "Singapore KrisFlyer", 140),
  airline("lifemiles", "Avianca LifeMiles", 150),
  airline("turkish", "Turkish Miles&Smiles", 140),
  hotel("hyatt", "World of Hyatt", 180),
  hotel("marriott", "Marriott Bonvoy", 80),
  hotel("hilton", "Hilton Honors", 50),
  hotel("ihg", "IHG One Rewards", 60),
  hotel("wyndham", "Wyndham Rewards", 90),
  hotel("choice", "Choice Privileges", 60),
  // Rail is its own kind rather than a mile: Amtrak Guest Rewards pays out in
  // points on a fare, and calling it an airline would put it under a heading
  // that is not true of it. One program today, and room for the next one.
  rail("amtrak", "Amtrak Guest Rewards", 220),
];

const BY_ID = new Map(CATALOG.map((program) => [program.id, program]));

/** The catalog entry, or null for an id this build does not know. */
export function programById(id) {
  return BY_ID.get(id) ?? null;
}

/** What one point of `programId` is worth: the household's figure, else the catalog's. */
export function resolvedValuePer100Cents(programId, valuations = {}) {
  const override = valuations[programId];
  if (Number.isInteger(override) && override >= 0) return override;
  return programById(programId)?.valuePer100Cents ?? 0;
}

/** A balance in dollars, rounded once at the end rather than per point. */
export function valueOfPointsCents(points, valuePer100Cents) {
  return Math.round((points * valuePer100Cents) / 100);
}

/** "1.30¢" — two places, since 1.3¢ and 1.35¢ are different valuations. */
export function formatPointValue(valuePer100Cents) {
  if (valuePer100Cents == null) return "—";
  return `${(valuePer100Cents / 100).toFixed(2)}¢`;
}

/**
 * A valuation typed the way it is said — "1.3", "1.3¢", "1.35 cents" — as cents
 * per hundred points. Null for junk, the `toCents` contract, and for anything
 * negative or absurd (a point worth more than a dollar is a typo for a cent).
 */
export function toValuePer100Cents(text) {
  if (text == null) return null;
  const cleaned = String(text).trim().replace(/¢|cents?|c$/gi, "").trim();
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100);
  return value >= 0 && value <= 10000 ? value : null;
}

/** A whole number of points, commas and spaces allowed. Null for anything else. */
export function toPoints(text) {
  if (typeof text === "number") return Number.isInteger(text) && text >= 0 ? text : null;
  if (text == null) return null;
  const cleaned = String(text).trim().replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Points arriving on the other side of a transfer. Partners never pay out a fraction. */
export function pointsAfterTransfer(points, [from, to]) {
  return Math.floor((points * to) / from);
}

/**
 * What a redemption gets per point, as cents per hundred: the cash fare it
 * replaces, less the taxes still paid in cash, over the points it costs. Null
 * where there is nothing to divide by or no fare to compare against.
 */
export function achievedValuePer100Cents({ points, cashPriceCents, taxesCents }) {
  if (!points || points <= 0 || cashPriceCents == null) return null;
  const saved = cashPriceCents - (taxesCents ?? 0);
  return Math.round((saved * 100) / points);
}

/** Every bank currency that can move points into `programId`, with its ratio. */
export function transferSources(programId) {
  const sources = [];
  for (const program of CATALOG) {
    for (const transfer of program.transfers) {
      if (transfer.to === programId) sources.push({ programId: program.id, ratio: transfer.ratio });
    }
  }
  return sources;
}

/**
 * The whole page's figures from the three stored lists.
 *
 * `programs` is one row per program the household holds, with every holder's
 * points summed and valued at the resolved figure. `trips` carries, for each
 * planned redemption, the value it achieves, whether that beats the program's
 * own valuation, and how it would be paid for: points already in the program
 * first, then transfers from bank currencies, largest balance first. A balance
 * already promised to an earlier trip is not counted twice — trips are funded
 * in date order (undated last), the order they will actually be booked in.
 */
export function summariseRewards({ balances = [], valuations = {}, trips = [] }) {
  const pointsByProgram = new Map();
  const holdersByProgram = new Map();
  for (const balance of balances) {
    if (!programById(balance.programId)) continue;
    pointsByProgram.set(
      balance.programId,
      (pointsByProgram.get(balance.programId) ?? 0) + balance.points
    );
    const holders = holdersByProgram.get(balance.programId) ?? [];
    holders.push(balance);
    holdersByProgram.set(balance.programId, holders);
  }

  const programs = CATALOG.filter((program) => pointsByProgram.has(program.id)).map((program) => {
    const points = pointsByProgram.get(program.id);
    const valuePer100Cents = resolvedValuePer100Cents(program.id, valuations);
    return {
      program,
      points,
      valuePer100Cents,
      valueCents: valueOfPointsCents(points, valuePer100Cents),
      balances: holdersByProgram.get(program.id),
    };
  });

  const totalValueCents = programs.reduce((sum, row) => sum + row.valueCents, 0);
  const valueByKind = Object.fromEntries(PROGRAM_KIND_ORDER.map((kind) => [kind, 0]));
  for (const row of programs) valueByKind[row.program.kind] += row.valueCents;

  // What is still unpromised as each trip claims its points.
  const remaining = new Map(pointsByProgram);
  const ordered = [...trips].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    return a.date < b.date ? -1 : 1;
  });

  const planned = new Map();
  for (const trip of ordered) {
    const program = programById(trip.programId);
    const valuePer100Cents = resolvedValuePer100Cents(trip.programId, valuations);
    const achieved = achievedValuePer100Cents(trip);

    let needed = trip.points;
    const fromProgram = Math.min(needed, remaining.get(trip.programId) ?? 0);
    needed -= fromProgram;
    remaining.set(trip.programId, (remaining.get(trip.programId) ?? 0) - fromProgram);

    const transfers = [];
    const sources = transferSources(trip.programId)
      .map((source) => ({ ...source, available: remaining.get(source.programId) ?? 0 }))
      .filter((source) => source.available > 0)
      .sort((a, b) => b.available - a.available);
    for (const source of sources) {
      if (needed <= 0) break;
      const [from, to] = source.ratio;
      // Partners move in whole units of the ratio, so round the cost up.
      const sourceNeeded = Math.ceil((needed * from) / to);
      const sent = Math.min(sourceNeeded, source.available);
      const arrives = pointsAfterTransfer(sent, source.ratio);
      if (arrives <= 0) continue;
      transfers.push({ programId: source.programId, ratio: source.ratio, sent, arrives });
      remaining.set(source.programId, source.available - sent);
      needed -= arrives;
    }

    planned.set(trip.id, {
      trip,
      program,
      valuePer100Cents,
      achievedPer100Cents: achieved,
      // Whether the redemption beats what the household says a point is worth —
      // the whole reason to have a valuation at all.
      goodValue: achieved == null ? null : achieved >= valuePer100Cents,
      fromProgram,
      transfers,
      shortfall: Math.max(0, needed),
      covered: needed <= 0,
    });
  }

  return {
    programs,
    totalValueCents,
    valueByKind,
    totalPoints: programs.reduce((sum, row) => sum + row.points, 0),
    // Back in the order the household entered them.
    trips: trips.map((trip) => planned.get(trip.id)),
  };
}

/* ---------------------------------------------------------------- card offers */

/**
 * **A card offer is a promise about spending, and there are two shapes of it.**
 *
 *   - **A capped bonus** (`CAP`) — a higher rate on some spending, up to a
 *     limit: 9% back on dining up to $1,000, a rotating 5% quarter capped at
 *     $1,500. Progress is room *used up*, and the useful moment is the limit,
 *     because that is when the household goes back to its usual card.
 *   - **A spending target** (`TARGET`) — spend at least this much by a date to
 *     earn a bonus: a sign-up bonus, a retention offer. Progress is distance
 *     *covered*, and the useful moment is the deadline.
 *   - **A credit to use up** (`CREDIT`) — the card pays some spending back, up
 *     to an amount, by a date: $300 of travel a year, $15 of ride-hailing a
 *     month. The arithmetic is a cap's exactly — spending on the card, in the
 *     mapped categories, counted up to a limit — but what the figure *means* is
 *     the reverse: room left under a bonus is an opportunity, while a credit
 *     left unused at its deadline is money already paid for and thrown away.
 *     That is the figure an annual fee is weighed against, which is why a
 *     credit is a kind here rather than a cap the household words carefully.
 *
 * Both read the same thing off the ledger — the household's own spending, on
 * one card, inside a window, in the categories (or at the payees) the offer is
 * mapped to — and differ only in what the figure is measured against and which
 * side of the limit is good news. A rotating-category card is a capped bonus
 * per quarter; nothing about it needs a third shape.
 *
 * **What counts is decided by the household's categories, not the issuer's.**
 * An issuer files a purchase by the merchant's code, which the books do not
 * have and could not check; what the books do have is the category each
 * purchase was filed under and who it was paid to. So an offer names
 * categories, payees, or "all spending", and a purchase counts if it matches
 * any of them. Where the two filings disagree — a café the issuer calls a
 * grocery — the issuer wins and this is an estimate; the page says so.
 */
export const OFFER_KINDS = {
  CAP: "cap",
  TARGET: "target",
  CREDIT: "credit",
};

export const OFFER_KIND_LABELS = {
  [OFFER_KINDS.CAP]: "Bonus up to a limit",
  [OFFER_KINDS.TARGET]: "Spend to earn a bonus",
  [OFFER_KINDS.CREDIT]: "Credit to use up",
};

/** A credit is only worth tracking against the day it expires, like a target. */
export const OFFER_KINDS_NEEDING_END = [OFFER_KINDS.TARGET, OFFER_KINDS.CREDIT];

export const OFFER_STATUS = {
  UPCOMING: "upcoming",
  ACTIVE: "active",
  /** A capped bonus with no room left, or a target already met. */
  DONE: "done",
  ENDED: "ended",
};

/**
 * Whether one leg of a record falls under a mapping — an offer's or an earn
 * rate's, which name what they apply to in the same three fields, because the
 * question ("is this purchase one of these?") is the same question.
 */
export function legMatches(mapping, payeeId, budgetId) {
  if (mapping.allSpending) return true;
  if (budgetId != null && mapping.budgetIds.includes(budgetId)) return true;
  return payeeId != null && mapping.payeeIds.includes(payeeId);
}

/**
 * The legs of a record a card can earn on, signed: spending positive, a refund
 * negative.
 *
 * Only outflows and inflows. A transfer is never a purchase — paying the card
 * off is a transfer *into* it, and a cash advance is not what any bonus pays
 * on — so it is read here as nothing at all, whatever `budgetLegs` makes of it.
 * An inflow counts only where it names a category: that is a refund, which an
 * issuer takes back off qualifying spend, while an inflow naming none is
 * income — a statement credit, cash back redeemed — which an issuer does not.
 *
 * One reading for both an offer's progress and a rate's earnings, so a division
 * or a refund cannot count towards a bonus and be missed by the rate that pays
 * on it.
 */
function spendingLegs(transaction) {
  const { kind } = transaction;
  if (kind !== "outflow" && kind !== "inflow") return [];
  const parts =
    Array.isArray(transaction.splits) && transaction.splits.length > 0
      ? transaction.splits
      : [{ budgetId: transaction.budgetId, amountCents: transaction.amountCents }];
  const legs = [];
  for (const part of parts) {
    if (kind === "inflow" && part.budgetId == null) continue;
    legs.push({
      budgetId: part.budgetId ?? null,
      cents: kind === "outflow" ? part.amountCents : -part.amountCents,
    });
  }
  return legs;
}

function qualifyingCents(offer, transaction) {
  let cents = 0;
  for (const leg of spendingLegs(transaction)) {
    if (!legMatches(offer, transaction.payeeId ?? null, leg.budgetId)) continue;
    cents += leg.cents;
  }
  return cents;
}

/**
 * Where an offer stands as of `today`.
 *
 * The window is inclusive at both ends and **stops at today** — a record dated
 * next week is a plan, not spending, the envelope view's rule for the future.
 * An undated record is in no window, the spending report's rule: whether it
 * counts is a question about a date nobody wrote down.
 *
 * Records are walked **in date order**, which is what makes `elsewhereCents`
 * honest. It is matching spending that went on some *other* card while this
 * offer still had a use for it — room left under a cap, or a target not yet
 * met — and only a walk in order can tell a dinner bought on the usual card
 * before the cap filled (a missed bonus) from one bought after (exactly right).
 * On one day the offer's own card goes first, the generous reading.
 *
 * `qualifyingCents` is floored at zero: refunds can outweigh purchases inside a
 * window, and a negative figure would be a cap with more room than it started
 * with.
 */
export function offerProgress(offer, transactions, today) {
  const start = offer.startDate;
  const end = offer.endDate ?? null;
  const through = end != null && end < today ? end : today;

  let status;
  if (start > today) status = OFFER_STATUS.UPCOMING;
  else if (end != null && end < today) status = OFFER_STATUS.ENDED;
  else status = OFFER_STATUS.ACTIVE;

  const inWindow = transactions
    .filter((t) => t.date != null && t.date >= start && t.date <= through)
    .map((t) => ({ t, cents: qualifyingCents(offer, t), onCard: t.accountId === offer.accountId }))
    .filter((row) => row.cents !== 0)
    .sort((a, b) => {
      if (a.t.date !== b.t.date) return a.t.date < b.t.date ? -1 : 1;
      return a.onCard === b.onCard ? 0 : a.onCard ? -1 : 1;
    });

  const limit = offer.limitCents;
  let running = 0;
  let elsewhere = 0;
  let purchaseCount = 0;
  for (const row of inWindow) {
    if (row.onCard) {
      running += row.cents;
      if (row.cents > 0) purchaseCount += 1;
    } else if (row.cents > 0 && Math.max(0, running) < limit) {
      // Only as much as there was still a use for: $300 of dinners elsewhere
      // with $100 of room left is $100 missed, not $300.
      elsewhere += Math.min(row.cents, limit - Math.max(0, running));
    }
  }

  const qualifying = Math.max(0, running);
  const remainingCents = Math.max(0, limit - qualifying);
  const reached = remainingCents === 0;
  if (reached && status === OFFER_STATUS.ACTIVE) status = OFFER_STATUS.DONE;

  const daysLeft = end != null && status !== OFFER_STATUS.ENDED ? daysBetween(today, end) : null;

  // What still has to go on the card each week to make a deadline: the days
  // left include today, so the last day of the offer is one day, not zero.
  // A credit is paced like a target — both are spending that has to happen by
  // a date, and a cap is spending that may simply stop.
  const paced = offer.kind === OFFER_KINDS.TARGET || offer.kind === OFFER_KINDS.CREDIT;
  const perWeekCents =
    paced && !reached && daysLeft != null && status === OFFER_STATUS.ACTIVE
      ? Math.ceil((remainingCents * 7) / (daysLeft + 1))
      : null;

  // **A credit pays back what it covers, which is a rate of 100%**, so one
  // formula answers both: a cap earns at a rate it may not even state, and a
  // credit earns the covered spending itself. A target earns points, not money.
  const rateBps = offer.kind === OFFER_KINDS.CREDIT ? 10000 : offer.rateBps;
  const earnedCents =
    offer.kind !== OFFER_KINDS.TARGET && rateBps != null
      ? Math.round((Math.min(qualifying, limit) * rateBps) / 10000)
      : null;

  return {
    offer,
    status,
    qualifyingCents: qualifying,
    remainingCents,
    /** Spent past a cap — at the card's ordinary rate, which is the point of knowing. */
    overCents: offer.kind === OFFER_KINDS.CAP ? Math.max(0, qualifying - limit) : 0,
    reached,
    earnedCents,
    elsewhereCents: elsewhere,
    purchaseCount,
    daysLeft,
    perWeekCents,
  };
}

/**
 * The same offer's next round, for a card whose categories rotate.
 *
 * A window that runs from the first of a month to the last of one is stepped
 * by **whole months** — a calendar quarter is 90, 91 or 92 days, and stepping
 * by days would drift off the quarter within a year. Anything else is stepped
 * by its own length in days. An offer with no end has no length to repeat.
 */
export function nextOfferWindow({ startDate, endDate }) {
  if (!startDate || !endDate) return null;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const lastOfMonth = new Date(ey, em, 0).getDate() === ed;
  if (sd === 1 && lastOfMonth) {
    const months = (ey - sy) * 12 + (em - sm) + 1;
    return {
      startDate: todayISO(new Date(sy, sm - 1 + months, 1)),
      endDate: todayISO(new Date(ey, em + months, 0)),
    };
  }
  const length = daysBetween(startDate, endDate) + 1;
  return {
    startDate: todayISO(new Date(sy, sm - 1, sd + length)),
    endDate: todayISO(new Date(ey, em - 1, ed + length)),
  };
}

/**
 * Which running offers bear on a purchase being entered, for the entry form's
 * reminder — read off `useCardOffers`' rows, so the room left is the page's own
 * figure and the two cannot disagree.
 *
 * Only an offer that is open on the purchase's date and still has a use for
 * spending (room under a cap, a target not yet met) is returned, and only
 * where the purchase matches its mapping in at least one category or by payee.
 * `onCard` says which way round the reminder reads: this purchase counts, or
 * another card would have counted it. `afterCents` is the room or distance left
 * once this purchase lands — only meaningful `onCard`, and floored at zero.
 */
export function offerNudges(rows, { accountId, payeeId, budgetIds, date, amountCents }) {
  if (!date) return [];
  const ids = budgetIds.filter(Boolean);
  return rows
    .filter((row) => row.status === OFFER_STATUS.ACTIVE && !row.reached)
    .filter(({ offer }) => offer.startDate <= date && (offer.endDate == null || date <= offer.endDate))
    .filter(
      ({ offer }) =>
        legMatches(offer, payeeId ?? null, null) || ids.some((id) => legMatches(offer, null, id))
    )
    .map((row) => {
      const onCard = row.offer.accountId === accountId;
      const spent = onCard && Number.isInteger(amountCents) && amountCents > 0 ? amountCents : 0;
      return {
        row,
        onCard,
        afterCents: Math.max(0, row.remainingCents - spent),
        pastCents:
          row.offer.kind === OFFER_KINDS.CAP ? Math.max(0, spent - row.remainingCents) : 0,
      };
    })
    // The card being used first: what this purchase does matters more than
    // what it might have done elsewhere.
    .sort((a, b) => (a.onCard === b.onCard ? 0 : a.onCard ? -1 : 1));
}

/* ------------------------------------------------- what a card earns, and costs */

/**
 * **A household does not hold points cards or cashback cards; it holds both,
 * and the only question that matters is which card to reach for.** That
 * question can only be answered in one unit, so every earn rate — 2% back, 3×
 * United, 5× on dining — is reduced to **the share of the purchase it returns
 * in value, in basis points** (`earnBps`), the rate discipline already used for
 * interest and for a bonus rate. Cash back is that figure outright: 2% back is
 * 200. Points go through the household's own valuation: 3× at 1.70¢ a point
 * returns 5.1¢ on the dollar, which is 510. Put that way a cashback card and a
 * points card are comparable, and they are comparable **on this household's
 * valuation of a point**, not on a magazine's.
 *
 * A rate is therefore stored in whichever unit it is advertised in and
 * converted on the way out, never on the way in:
 *
 *   - `mode: CASHBACK` reads `rateBps` — basis points, `toBps`' unit.
 *   - `mode: POINTS` reads `pointsPer100Dollars` and `programId` — points per
 *     hundred dollars, so a 1.25× card is 125 and an integer, the same
 *     per-hundred trick `valuePer100Cents` plays on a fraction of a cent.
 *
 * **Both answers are kept** when the mode is switched, the store's rule: a card
 * whose rewards the household flips between cash and points keeps the figure it
 * is not currently reading.
 *
 * **A rate is uncapped by design.** "5% on groceries, up to $6,000 a year" is
 * two facts — a rate and a cap — and the cap is a `CAP` offer, which already
 * walks the ledger in date order and says when the room runs out. Teaching a
 * rate about limits would be the same arithmetic in a second place, and the two
 * would disagree the first time one of them changed.
 */
export const EARN_MODES = {
  CASHBACK: "cashback",
  POINTS: "points",
};

export const EARN_MODE_LABELS = {
  [EARN_MODES.CASHBACK]: "Cash back",
  [EARN_MODES.POINTS]: "Points or miles",
};

/**
 * A multiplier written the way cards advertise it — "3", "3x", "3×", "1.5x" —
 * as points per hundred dollars. Null for junk, the `toCents` contract, and for
 * anything over 100× (a typo for a percentage).
 */
export function toPointsPer100Dollars(text) {
  if (typeof text === "number") {
    return Number.isInteger(text) && text > 0 && text <= 10000 ? text : null;
  }
  if (text == null) return null;
  const cleaned = String(text)
    .trim()
    .replace(/[x×]$/i, "")
    .replace(/points?\s*per\s*(dollar|\$)/i, "")
    .trim();
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100);
  return value > 0 && value <= 10000 ? value : null;
}

/** "3×", "1.25×" — the way a card advertises it, trailing zeroes dropped. */
export function formatMultiplier(pointsPer100Dollars) {
  if (pointsPer100Dollars == null) return "—";
  const value = pointsPer100Dollars / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")}×`;
}

/**
 * What a rate returns on a dollar, in basis points of the purchase — the one
 * figure a cashback card and a points card can be compared on.
 */
export function earnBps(rate, valuations = {}) {
  if (rate == null) return 0;
  if (rate.mode === EARN_MODES.CASHBACK) return rate.rateBps ?? 0;
  if (rate.programId == null || rate.pointsPer100Dollars == null) return 0;
  const per100 = resolvedValuePer100Cents(rate.programId, valuations);
  return Math.round((rate.pointsPer100Dollars * per100) / 100);
}

/**
 * The rate a card would pay on one leg of a purchase: the best of the rates
 * whose mapping it matches, or null where the card claims nothing for it.
 *
 * **The best one and only the best one**, because an issuer pays one rate per
 * purchase — a card with 3× on travel and 1× on everything pays 3× at the
 * airline, not 4×. "Best" is by `earnBps`, so a 5% cashback category beats a 3×
 * points one or not depending on what the household says a point is worth,
 * which is the whole point of the valuation.
 */
export function bestRateFor(rates, { payeeId = null, budgetId = null } = {}, valuations = {}) {
  let best = null;
  let bestBps = -1;
  for (const rate of rates) {
    if (!legMatches(rate, payeeId, budgetId)) continue;
    const bps = earnBps(rate, valuations);
    if (bps > bestBps) {
      best = rate;
      bestBps = bps;
    }
  }
  return best;
}

/**
 * Every card ranked by what it would pay on one kind of spending, best first —
 * the "which card to reach for" answer. A card with no matching rate is left
 * out rather than ranked at zero: a card that claims nothing for groceries has
 * no answer to give, and showing it at 0% would read as a card that earns
 * nothing at all.
 */
export function rankCardsFor(cards, target, valuations = {}) {
  return cards
    .map((card) => {
      const rate = bestRateFor(card.rates ?? [], target, valuations);
      return rate == null ? null : { accountId: card.accountId, rate, bps: earnBps(rate, valuations) };
    })
    .filter(Boolean)
    .sort((a, b) => b.bps - a.bps);
}

/**
 * What one card earned over a window, off the household's own ledger.
 *
 * Read the way an offer is read — `spendingLegs`, so a transfer earns nothing,
 * a division earns per part and a refund takes its earnings back — and then
 * each leg is paid at `bestRateFor`. Dated records only, inside the window at
 * both ends, which the caller sets (`feeYearWindow`).
 *
 * **It is an estimate and it is one the books can actually make.** The issuer
 * pays by merchant code, which is not in the books; what is in the books is the
 * category the household filed the purchase under, so this says what the rates
 * the household typed come to on the spending the household recorded. It is
 * **not** a statement balance, and nothing here is written back to a ledger.
 *
 * Each rate's earnings are floored at zero before they are summed, so the
 * totals are the sum of the rows beside them, and a category whose refunds
 * outran its spending cannot pull another one's earnings down.
 */
export function cardEarnings({ accountId, rates = [], transactions = [], from, through, valuations = {} }) {
  const tally = new Map(
    rates.map((rate) => [
      rate.id,
      { rate, bps: earnBps(rate, valuations), spendCents: 0, cashCents: 0, points: 0 },
    ])
  );
  let spendCents = 0;
  let unratedCents = 0;

  for (const transaction of transactions) {
    if (transaction.accountId !== accountId) continue;
    if (transaction.date == null || transaction.date < from || transaction.date > through) continue;
    for (const leg of spendingLegs(transaction)) {
      spendCents += leg.cents;
      const rate = bestRateFor(rates, { payeeId: transaction.payeeId ?? null, budgetId: leg.budgetId }, valuations);
      if (rate == null) {
        unratedCents += leg.cents;
        continue;
      }
      const row = tally.get(rate.id);
      row.spendCents += leg.cents;
      if (rate.mode === EARN_MODES.CASHBACK) {
        row.cashCents += Math.round((leg.cents * (rate.rateBps ?? 0)) / 10000);
      } else {
        row.points += Math.round((leg.cents * (rate.pointsPer100Dollars ?? 0)) / 10000);
      }
    }
  }

  const byRate = [...tally.values()]
    .map((row) => ({ ...row, cashCents: Math.max(0, row.cashCents), points: Math.max(0, row.points) }))
    .sort((a, b) => b.bps - a.bps);

  const pointsByProgram = new Map();
  let cashCents = 0;
  for (const row of byRate) {
    if (row.rate.mode === EARN_MODES.CASHBACK) {
      cashCents += row.cashCents;
    } else if (row.points > 0) {
      const { programId } = row.rate;
      pointsByProgram.set(programId, (pointsByProgram.get(programId) ?? 0) + row.points);
    }
  }

  const points = [...pointsByProgram.entries()].map(([programId, amount]) => ({
    programId,
    program: programById(programId),
    points: amount,
    valueCents: valueOfPointsCents(amount, resolvedValuePer100Cents(programId, valuations)),
  }));
  const pointsValueCents = points.reduce((sum, row) => sum + row.valueCents, 0);

  return {
    spendCents,
    unratedCents,
    byRate,
    cashCents,
    points,
    pointsValueCents,
    valueCents: cashCents + pointsValueCents,
  };
}

const anniversary = (year, month, day) =>
  todayISO(new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate())));

/**
 * The year a card's annual fee buys, as of `today`: the window its credits and
 * its earnings are weighed against the fee over.
 *
 * **The fee year, not the calendar year**, where the household has said when
 * the fee falls — a card that renews in March is paid for from March, and the
 * $300 credit it came with resets then too, so January to today would weigh
 * nine months of credits against a whole fee. With no renewal date stated
 * there is nothing to anchor it to, and the calendar year is both the usual
 * reset for a credit and the one a household can check.
 *
 * `through` is **today**, never the end of the year: the fee is paid in full on
 * day one and the credits are not, which is the asymmetry the page is for. A
 * renewal date of 29 February lands on the 28th in a year that has no 29th.
 */
export function feeYearWindow(renewsOn, today) {
  if (!renewsOn) {
    return { from: `${today.slice(0, 4)}-01-01`, through: today, renewsOn: null, calendar: true };
  }
  const [, month, day] = renewsOn.split("-").map(Number);
  const thisYear = Number(today.slice(0, 4));
  let from = anniversary(thisYear, month, day);
  if (from > today) from = anniversary(thisYear - 1, month, day);
  const nextYear = Number(from.slice(0, 4)) + 1;
  return { from, through: today, renewsOn: anniversary(nextYear, month, day), calendar: false };
}

/** Whether an offer's window overlaps a fee year at all. */
export function offerOverlaps({ startDate, endDate }, { from, through }) {
  return startDate <= through && (endDate == null || endDate >= from);
}
