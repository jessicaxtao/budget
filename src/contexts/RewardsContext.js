import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { isValidISODate, toBps, toCents } from "../utils";
import {
  EARN_MODES,
  OFFER_KINDS,
  OFFER_KINDS_NEEDING_END,
  PROGRESS_SOURCES,
  isCashProgram,
  programById,
  toPoints,
  toPointsPer100Dollars,
  toValuePer100Cents,
} from "../rewards";

/**
 * Credit card rewards: the points and miles the household holds, what they say
 * each is worth, and the trips they mean to spend them on.
 *
 * **A store of its own, outside the books, holding no money.** A point is not a
 * dollar until it is redeemed, and what it is worth is a judgement, so nothing
 * here reaches an envelope, a balance, a report or net worth — the same split
 * `RetirementContext` keeps as a store of guesses. Three keys:
 *
 *   - `rewardsBalances` — `{ id, programId, holder, points, asOf }`, one per
 *     program per person, since two cardholders in one household each have an
 *     account with the same airline. `holder` is optional free text. One
 *     program in the catalog, `"cashback"`, is not points at all — an
 *     issuer's own unredeemed cash-back balance, kept here for the same
 *     reason a mileage balance is (not yet money) and read by `points` the
 *     same way everywhere else, holding cents rather than a point count.
 *     **Not** the same figure as a card's `cashbackBps`, which has already
 *     posted as a refund in the ledger (`src/cashback.js`) — this is what the
 *     issuer still owes, that is what the household already has.
 *   - `rewardsValuations` — `{ [programId]: valuePer100Cents }`, the household's
 *     own figure where it disagrees with the catalog. Absent is the catalog's
 *     figure, so a blank field puts it back rather than storing a copy that
 *     would stop following the catalog. Refused outright for `"cashback"`,
 *     the one program whose value is not a judgement call.
 *   - `rewardsTrips` — `{ id, name, date, programId, points, taxesCents,
 *     cashPriceCents }`, a redemption being planned: what it costs in points and
 *     cash, and what the same trip would cost paid outright.
 *   - `rewardsOffers` — `{ id, name, kind, accountId, startDate, endDate,
 *     limitCents, allSpending, budgetIds, payeeIds, rateBps, bonusPoints,
 *     programId, progressSource, usedCents }`, a card offer being tracked: a
 *     capped bonus or a spending target (`OFFER_KINDS`), on one card, over a
 *     window, mapped onto the household's own categories and payees. **It
 *     holds no money either** — it is a question asked of the ledger, and
 *     `useCardOffers` is what answers it. Its references to an account,
 *     categories and payees are **inert but kept**, the payee-default rule:
 *     this store reads no other, so a deleted category simply stops matching
 *     anything. The fields one kind does not read (a rate on a target, a bonus
 *     on a cap) are kept, not cleared, and so are the lists while `allSpending`
 *     is on — switching back is the point. A `CREDIT` only may instead be
 *     marked off by hand (`progressSource: "manual"`, `PROGRESS_SOURCES` in
 *     `src/rewards.js`): `usedCents` is the household's own typed figure, kept
 *     — not cleared — if it switches back to matching the ledger, the same
 *     both-answers-kept rule as everything else here.
 *   - `rewardsCards` — `{ accountId, annualFeeCents, renewsOn }`, what a card
 *     *costs*: the fee and the day it falls, so the credits it gives back can
 *     be weighed against it over the right year. **Its identity is the
 *     account**, like a valuation's is the program — a card has one fee, and a
 *     second record for the same card could only contradict the first. A blank
 *     fee and a blank renewal date together **remove the record**, the blank-
 *     versus-zero rule: a fee of zero is the answer "this card is free", while
 *     a blank is the question still open.
 *   - `rewardsEarnRates` — `{ id, accountId, mode, programId, rateBps,
 *     pointsPer100Dollars, allSpending, budgetIds, payeeIds }`, what a card
 *     *earns*: one record per advertised rate, in cash back or in points
 *     (`EARN_MODES`), mapped onto the household's own categories and payees the
 *     way an offer is. **Both answers kept** across a change of mode, so a card
 *     flipped from points to cash keeps the multiplier it is not reading.
 *     Uncapped by design — a rate with a limit is a `CAP` offer, which already
 *     knows how to walk a window — and inert about everything it names. Added
 *     **only in batches** (`addEarnRates`), because a card advertises a table
 *     of them and not one.
 *
 * **Programs come from the built-in catalog (`src/rewards.js`) and a record
 * naming an id it does not know is dropped on the way in** — unlike the inert-
 * but-kept references elsewhere, there is no other store a program could have
 * been deleted from; an unknown id is a catalog entry a newer build removed, and
 * nothing on the page could show it.
 *
 * Nothing cascades into or out of this store, so its position in the provider
 * order is free.
 */
const RewardsContext = React.createContext();

export function useRewards() {
  return useContext(RewardsContext);
}

const isPoints = (value) => Number.isInteger(value) && value >= 0;
const isMoney = (value) => Number.isInteger(value) && value >= 0;
const known = (programId) => programById(programId) != null;
const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

function migrateBalances(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((balance) => balance && known(balance.programId) && isPoints(balance.points))
    .map((balance) => ({
      id: typeof balance.id === "string" ? balance.id : uuidV4(),
      programId: balance.programId,
      holder: cleanText(balance.holder) || null,
      points: balance.points,
      asOf: isValidISODate(balance.asOf) ? balance.asOf : null,
    }));
}

function migrateValuations(stored) {
  const valuations = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return valuations;
  for (const [programId, value] of Object.entries(stored)) {
    // Cash is never overridden — a dollar is always a dollar — so a stored
    // one here is from a build that let it slip through, and is dropped.
    if (known(programId) && !isCashProgram(programId) && Number.isInteger(value) && value >= 0) {
      valuations[programId] = value;
    }
  }
  return valuations;
}

function migrateTrips(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((trip) => trip && known(trip.programId) && isPoints(trip.points) && trip.points > 0)
    .map((trip) => ({
      id: typeof trip.id === "string" ? trip.id : uuidV4(),
      name: cleanText(trip.name) || "Untitled trip",
      date: isValidISODate(trip.date) ? trip.date : null,
      programId: trip.programId,
      points: trip.points,
      taxesCents: isMoney(trip.taxesCents) ? trip.taxesCents : 0,
      cashPriceCents: isMoney(trip.cashPriceCents) ? trip.cashPriceCents : null,
    }));
}

const isBlank = (value) => value == null || String(value).trim() === "";

const idList = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string" && id))] : [];

function migrateOffers(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (offer) =>
        offer &&
        Object.values(OFFER_KINDS).includes(offer.kind) &&
        isValidISODate(offer.startDate) &&
        Number.isInteger(offer.limitCents) &&
        offer.limitCents > 0
    )
    .map((offer) => ({
      id: typeof offer.id === "string" ? offer.id : uuidV4(),
      name: cleanText(offer.name) || "Untitled offer",
      kind: offer.kind,
      accountId: typeof offer.accountId === "string" ? offer.accountId : null,
      startDate: offer.startDate,
      endDate: isValidISODate(offer.endDate) ? offer.endDate : null,
      limitCents: offer.limitCents,
      allSpending: offer.allSpending === true,
      budgetIds: idList(offer.budgetIds),
      payeeIds: idList(offer.payeeIds),
      rateBps: Number.isInteger(offer.rateBps) && offer.rateBps >= 0 ? offer.rateBps : null,
      bonusPoints: isPoints(offer.bonusPoints) ? offer.bonusPoints : null,
      programId: known(offer.programId) ? offer.programId : null,
      progressSource: Object.values(PROGRESS_SOURCES).includes(offer.progressSource)
        ? offer.progressSource
        : PROGRESS_SOURCES.LEDGER,
      usedCents: isMoney(offer.usedCents) ? offer.usedCents : null,
    }));
}

/**
 * One record per card, so the first record for an account wins and the rest are
 * dropped: a second fee for the same card is not a second card.
 */
function migrateCards(stored) {
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  const cards = [];
  for (const card of stored) {
    if (!card || typeof card.accountId !== "string" || !card.accountId) continue;
    if (seen.has(card.accountId)) continue;
    const annualFeeCents = isMoney(card.annualFeeCents) ? card.annualFeeCents : null;
    const renewsOn = isValidISODate(card.renewsOn) ? card.renewsOn : null;
    if (annualFeeCents === null && renewsOn === null) continue;
    seen.add(card.accountId);
    cards.push({ accountId: card.accountId, annualFeeCents, renewsOn });
  }
  return cards;
}

/** A rate that cannot be read earns nothing, so it is not kept. */
function migrateEarnRates(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((rate) => rate && typeof rate.accountId === "string" && rate.accountId)
    .filter((rate) => Object.values(EARN_MODES).includes(rate.mode))
    .map((rate) => ({
      id: typeof rate.id === "string" ? rate.id : uuidV4(),
      accountId: rate.accountId,
      mode: rate.mode,
      programId: known(rate.programId) ? rate.programId : null,
      rateBps: Number.isInteger(rate.rateBps) && rate.rateBps > 0 ? rate.rateBps : null,
      pointsPer100Dollars:
        Number.isInteger(rate.pointsPer100Dollars) && rate.pointsPer100Dollars > 0
          ? rate.pointsPer100Dollars
          : null,
      allSpending: rate.allSpending === true,
      budgetIds: idList(rate.budgetIds),
      payeeIds: idList(rate.payeeIds),
    }))
    .filter((rate) =>
      rate.mode === EARN_MODES.CASHBACK
        ? rate.rateBps != null
        : rate.programId != null && rate.pointsPer100Dollars != null
    )
    .filter((rate) => rate.allSpending || rate.budgetIds.length > 0 || rate.payeeIds.length > 0);
}

/** A money field that may be blank, as cents or a refusal. */
function readMoney(value, { blank, label }) {
  if (isBlank(value)) return { ok: true, cents: blank };
  const cents = typeof value === "number" ? value : toCents(value);
  if (!isMoney(cents)) return { ok: false, error: `Enter ${label} as an amount of zero or more.` };
  return { ok: true, cents };
}

function parseBalance({ programId, holder, points, asOf }) {
  if (!known(programId)) return { ok: false, error: "Choose a program from the list." };
  // Cash's "points" are cents — the one program whose balance is money
  // already, typed and read back the way every other money field is.
  const cash = isCashProgram(programId);
  const parsed = cash ? toCents(points) : toPoints(points);
  if (parsed == null) {
    return {
      ok: false,
      error: cash
        ? "Enter the balance as an amount, like $42.50."
        : "Enter the balance as a whole number of points.",
    };
  }
  const date = asOf || null;
  if (date !== null && !isValidISODate(date)) {
    return { ok: false, error: "Enter a valid date, or leave it blank." };
  }
  return { ok: true, record: { programId, holder: cleanText(holder) || null, points: parsed, asOf: date } };
}

function parseTrip({ name, date, programId, points, taxes, cashPrice }) {
  const trimmed = cleanText(name);
  if (!trimmed) return { ok: false, error: "Give the trip a name." };
  if (!known(programId)) return { ok: false, error: "Choose which program the trip is booked with." };
  const parsedPoints = toPoints(points);
  if (!parsedPoints) return { ok: false, error: "Enter how many points the trip costs." };
  const when = date || null;
  if (when !== null && !isValidISODate(when)) {
    return { ok: false, error: "Enter a valid date, or leave it blank." };
  }
  const taxesRead = readMoney(taxes, { blank: 0, label: "the taxes and fees" });
  if (!taxesRead.ok) return taxesRead;
  const cashRead = readMoney(cashPrice, { blank: null, label: "the cash price" });
  if (!cashRead.ok) return cashRead;
  return {
    ok: true,
    record: {
      name: trimmed,
      date: when,
      programId,
      points: parsedPoints,
      taxesCents: taxesRead.cents,
      cashPriceCents: cashRead.cents,
    },
  };
}

/**
 * A whole offer, as the form hands it over: money and rates as typed strings,
 * read here so the page and the store cannot disagree about what "$1,000" or
 * "9%" means.
 */
function parseOffer(fields) {
  const name = cleanText(fields.name);
  if (!name) return { ok: false, error: "Give the offer a name." };
  if (!Object.values(OFFER_KINDS).includes(fields.kind)) {
    return { ok: false, error: "Choose what kind of offer this is." };
  }
  if (typeof fields.accountId !== "string" || !fields.accountId) {
    return { ok: false, error: "Choose the card the offer is on." };
  }
  if (!isValidISODate(fields.startDate)) return { ok: false, error: "Enter the day the offer starts." };
  const endDate = fields.endDate || null;
  if (endDate !== null && !isValidISODate(endDate)) {
    return { ok: false, error: "Enter a valid end date, or leave it blank." };
  }
  if (endDate !== null && endDate < fields.startDate) {
    return { ok: false, error: "The offer has to end on or after the day it starts." };
  }
  if (OFFER_KINDS_NEEDING_END.includes(fields.kind) && endDate === null) {
    return {
      ok: false,
      error:
        fields.kind === OFFER_KINDS.CREDIT
          ? "A credit needs the date it has to be used by."
          : "A spending target needs the date it has to be met by.",
    };
  }

  const limitCents = typeof fields.limit === "number" ? fields.limit : toCents(fields.limit);
  if (!Number.isInteger(limitCents) || limitCents <= 0) {
    return {
      ok: false,
      error: {
        [OFFER_KINDS.CAP]: "Enter the most spending the bonus applies to, as an amount above zero.",
        [OFFER_KINDS.TARGET]: "Enter how much has to be spent, as an amount above zero.",
        [OFFER_KINDS.CREDIT]: "Enter how much the credit is worth, as an amount above zero.",
      }[fields.kind],
    };
  }

  // Only a credit can be marked off by hand — a cap and a target are promises
  // *about* spending, and the ledger is the only way to answer those at all.
  const progressSource =
    fields.kind === OFFER_KINDS.CREDIT && fields.progressSource === PROGRESS_SOURCES.MANUAL
      ? PROGRESS_SOURCES.MANUAL
      : PROGRESS_SOURCES.LEDGER;
  const usedRead = readMoney(fields.used, { blank: null, label: "how much you've used" });
  if (!usedRead.ok) return usedRead;

  const allSpending = fields.allSpending === true;
  const budgetIds = idList(fields.budgetIds);
  const payeeIds = idList(fields.payeeIds);
  // A manual credit answers the ledger question itself, so it does not need a
  // mapping to be coherent — unlike every other offer, which has nothing else
  // to go on.
  if (
    progressSource !== PROGRESS_SOURCES.MANUAL &&
    !allSpending &&
    budgetIds.length === 0 &&
    payeeIds.length === 0
  ) {
    return {
      ok: false,
      error: "Choose at least one category or payee the offer applies to, or count all spending.",
    };
  }

  let rateBps = null;
  if (!isBlank(fields.rate)) {
    rateBps = typeof fields.rate === "number" ? fields.rate : toBps(fields.rate);
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      return { ok: false, error: "Enter the bonus rate as a percentage, like 5%, or leave it blank." };
    }
  }

  let bonusPoints = null;
  if (!isBlank(fields.bonusPoints)) {
    bonusPoints = toPoints(fields.bonusPoints);
    if (bonusPoints == null) {
      return { ok: false, error: "Enter the bonus as a whole number of points, or leave it blank." };
    }
  }
  const programId = fields.programId || null;
  if (programId !== null && !known(programId)) {
    return { ok: false, error: "Choose a program from the list, or leave it blank." };
  }

  return {
    ok: true,
    record: {
      name,
      kind: fields.kind,
      accountId: fields.accountId,
      startDate: fields.startDate,
      endDate,
      limitCents,
      allSpending,
      budgetIds,
      payeeIds,
      rateBps,
      bonusPoints,
      programId,
      progressSource,
      usedCents: usedRead.cents,
    },
  };
}

/**
 * What a card costs, as the page's two inline fields hand it over. A record of
 * `null` is the answer "nothing stated about this card" and removes it.
 */
function parseCard({ accountId, fee, renewsOn }) {
  if (typeof accountId !== "string" || !accountId) {
    return { ok: false, error: "That card no longer exists." };
  }
  const feeRead = readMoney(fee, { blank: null, label: "the annual fee" });
  if (!feeRead.ok) return feeRead;
  const renews = isBlank(renewsOn) ? null : renewsOn;
  if (renews !== null && !isValidISODate(renews)) {
    return { ok: false, error: "Enter a valid renewal date, or leave it blank." };
  }
  if (feeRead.cents === null && renews === null) return { ok: true, record: null };
  return { ok: true, record: { accountId, annualFeeCents: feeRead.cents, renewsOn: renews } };
}

/**
 * One earn rate. **Both figures are read whenever they are given**, whichever
 * mode is in force, so switching a rate from points to cash and back finds the
 * multiplier where it was left; only the one the mode reads is required.
 */
function parseEarnRate(fields) {
  if (typeof fields.accountId !== "string" || !fields.accountId) {
    return { ok: false, error: "Choose the card this rate is on." };
  }
  if (!Object.values(EARN_MODES).includes(fields.mode)) {
    return { ok: false, error: "Choose whether this rate pays cash back or points." };
  }

  let rateBps = null;
  if (!isBlank(fields.rate)) {
    rateBps = typeof fields.rate === "number" ? fields.rate : toBps(fields.rate);
    if (!Number.isInteger(rateBps) || rateBps <= 0 || rateBps > 10000) {
      return { ok: false, error: "Enter the cash back as a percentage, like 2%." };
    }
  }
  let pointsPer100Dollars = null;
  if (!isBlank(fields.multiplier)) {
    pointsPer100Dollars = toPointsPer100Dollars(fields.multiplier);
    if (pointsPer100Dollars == null) {
      return { ok: false, error: "Enter how many points a dollar earns, like 3x." };
    }
  }
  const programId = fields.programId || null;
  if (programId !== null && !known(programId)) {
    return { ok: false, error: "Choose a program from the list." };
  }

  if (fields.mode === EARN_MODES.CASHBACK && rateBps === null) {
    return { ok: false, error: "Enter the cash back as a percentage, like 2%." };
  }
  if (fields.mode === EARN_MODES.POINTS) {
    if (pointsPer100Dollars === null) {
      return { ok: false, error: "Enter how many points a dollar earns, like 3x." };
    }
    if (programId === null) {
      return { ok: false, error: "Choose which program the points land in." };
    }
  }

  const allSpending = fields.allSpending === true;
  const budgetIds = idList(fields.budgetIds);
  const payeeIds = idList(fields.payeeIds);
  if (!allSpending && budgetIds.length === 0 && payeeIds.length === 0) {
    return {
      ok: false,
      error: "Choose at least one category or payee this rate applies to, or apply it to all spending.",
    };
  }

  return {
    ok: true,
    record: {
      accountId: fields.accountId,
      mode: fields.mode,
      programId,
      rateBps,
      pointsPer100Dollars,
      allSpending,
      budgetIds,
      payeeIds,
    },
  };
}

export const RewardsProvider = ({ children }) => {
  const [balances, setBalances] = useSyncedState("rewardsBalances", [], migrateBalances);
  const [valuations, setValuations] = useSyncedState("rewardsValuations", {}, migrateValuations);
  const [trips, setTrips] = useSyncedState("rewardsTrips", [], migrateTrips);
  const [offers, setOffers] = useSyncedState("rewardsOffers", [], migrateOffers);
  const [cards, setCards] = useSyncedState("rewardsCards", [], migrateCards);
  const [earnRates, setEarnRates] = useSyncedState("rewardsEarnRates", [], migrateEarnRates);

  const addBalance = useCallback(
    (fields) => {
      const parsed = parseBalance(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setBalances((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setBalances]
  );

  /** A patch: only the named fields are checked, so the points cell can commit alone. */
  const updateBalance = useCallback(
    ({ id, ...patch }) => {
      const existing = balances.find((balance) => balance.id === id);
      if (!existing) return { ok: false, error: "That balance no longer exists." };
      const parsed = parseBalance({ ...existing, ...patch });
      if (!parsed.ok) return parsed;
      setBalances((previous) =>
        previous.map((balance) => (balance.id === id ? { id, ...parsed.record } : balance))
      );
      return { ok: true };
    },
    [balances, setBalances]
  );

  const deleteBalance = useCallback(
    ({ id }) => setBalances((previous) => previous.filter((balance) => balance.id !== id)),
    [setBalances]
  );

  /** The household's own figure for a program. Blank goes back to the catalog's. */
  const setValuation = useCallback(
    ({ programId, value }) => {
      if (!known(programId)) return { ok: false, error: "That program is not in the catalog." };
      if (isCashProgram(programId)) {
        return { ok: false, error: "Cash back is always worth its face value." };
      }
      if (isBlank(value)) {
        setValuations((previous) => {
          const { [programId]: _dropped, ...rest } = previous;
          return rest;
        });
        return { ok: true };
      }
      const parsed = typeof value === "number" ? value : toValuePer100Cents(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
        return {
          ok: false,
          error: "Enter a value in cents per point, like 1.4, or leave it blank for the catalog's.",
        };
      }
      setValuations((previous) => ({ ...previous, [programId]: parsed }));
      return { ok: true };
    },
    [setValuations]
  );

  const addTrip = useCallback(
    (fields) => {
      const parsed = parseTrip(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setTrips((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setTrips]
  );

  const updateTrip = useCallback(
    ({ id, ...fields }) => {
      if (!trips.some((trip) => trip.id === id)) {
        return { ok: false, error: "That trip no longer exists." };
      }
      const parsed = parseTrip(fields);
      if (!parsed.ok) return parsed;
      setTrips((previous) => previous.map((trip) => (trip.id === id ? { id, ...parsed.record } : trip)));
      return { ok: true };
    },
    [trips, setTrips]
  );

  const deleteTrip = useCallback(
    ({ id }) => setTrips((previous) => previous.filter((trip) => trip.id !== id)),
    [setTrips]
  );

  const addOffer = useCallback(
    (fields) => {
      const parsed = parseOffer(fields);
      if (!parsed.ok) return parsed;
      const id = uuidV4();
      setOffers((previous) => [...previous, { id, ...parsed.record }]);
      return { ok: true, id };
    },
    [setOffers]
  );

  /** A whole offer, like `updateTrip`: the form states every field every time. */
  const updateOffer = useCallback(
    ({ id, ...fields }) => {
      if (!offers.some((offer) => offer.id === id)) {
        return { ok: false, error: "That offer no longer exists." };
      }
      const parsed = parseOffer(fields);
      if (!parsed.ok) return parsed;
      setOffers((previous) => previous.map((offer) => (offer.id === id ? { id, ...parsed.record } : offer)));
      return { ok: true };
    },
    [offers, setOffers]
  );

  const deleteOffer = useCallback(
    ({ id }) => setOffers((previous) => previous.filter((offer) => offer.id !== id)),
    [setOffers]
  );

  /**
   * A card's fee and renewal, by account: one record each, so this upserts
   * rather than appends, and a card with nothing left stated is removed.
   */
  const saveCard = useCallback(
    (fields) => {
      const parsed = parseCard(fields);
      if (!parsed.ok) return parsed;
      setCards((previous) => {
        const rest = previous.filter((card) => card.accountId !== fields.accountId);
        return parsed.record === null ? rest : [...rest, parsed.record];
      });
      return { ok: true };
    },
    [setCards]
  );

  const deleteCard = useCallback(
    ({ accountId }) => setCards((previous) => previous.filter((card) => card.accountId !== accountId)),
    [setCards]
  );

  /**
   * A card's rates, however many of them, in one write — the only way in, since
   * a card is advertised as a table ("4× dining, 4× groceries, 1× everything
   * else") and typing it a modal at a time was the whole of the friction.
   *
   * **The whole batch is validated before anything is written**, the rule every
   * batch mutator here keeps: a table of five rates that fails on the third
   * cannot leave two committed, because the form would then have to work out
   * which of its rows are already in the store to avoid writing them twice.
   * The error names the row, since the figure refused is one of several on
   * screen — but a batch of one says only what is wrong with it, as it is the
   * only thing the user could have meant.
   *
   * Nothing is checked *across* the rows. Two rates reaching the same category
   * is not incoherent, only redundant: `bestRateFor` pays the better one, which
   * is what the issuer does.
   */
  const addEarnRates = useCallback(
    (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: false, error: "Add at least one rate." };
      }
      const records = [];
      for (const [index, fields] of rows.entries()) {
        const parsed = parseEarnRate(fields);
        if (!parsed.ok) {
          return rows.length === 1
            ? parsed
            : { ok: false, error: `Rate ${index + 1}: ${parsed.error}` };
        }
        records.push({ id: uuidV4(), ...parsed.record });
      }
      setEarnRates((previous) => [...previous, ...records]);
      return { ok: true, ids: records.map((record) => record.id) };
    },
    [setEarnRates]
  );

  /** A whole rate, like `updateOffer`: the form states every field every time. */
  const updateEarnRate = useCallback(
    ({ id, ...fields }) => {
      if (!earnRates.some((rate) => rate.id === id)) {
        return { ok: false, error: "That rate no longer exists." };
      }
      const parsed = parseEarnRate(fields);
      if (!parsed.ok) return parsed;
      setEarnRates((previous) =>
        previous.map((rate) => (rate.id === id ? { id, ...parsed.record } : rate))
      );
      return { ok: true };
    },
    [earnRates, setEarnRates]
  );

  const deleteEarnRate = useCallback(
    ({ id }) => setEarnRates((previous) => previous.filter((rate) => rate.id !== id)),
    [setEarnRates]
  );

  const value = useMemo(
    () => ({
      balances,
      valuations,
      trips,
      offers,
      cards,
      earnRates,
      saveCard,
      deleteCard,
      addEarnRates,
      updateEarnRate,
      deleteEarnRate,
      addBalance,
      updateBalance,
      deleteBalance,
      setValuation,
      addTrip,
      updateTrip,
      deleteTrip,
      addOffer,
      updateOffer,
      deleteOffer,
    }),
    [
      balances,
      valuations,
      trips,
      offers,
      cards,
      earnRates,
      saveCard,
      deleteCard,
      addEarnRates,
      updateEarnRate,
      deleteEarnRate,
      addBalance,
      updateBalance,
      deleteBalance,
      setValuation,
      addTrip,
      updateTrip,
      deleteTrip,
      addOffer,
      updateOffer,
      deleteOffer,
    ]
  );

  return <RewardsContext.Provider value={value}>{children}</RewardsContext.Provider>;
};
