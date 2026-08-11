import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { CADENCES, expectedCentsInPeriod, occurrencesInPeriod } from "../recurrence";
import { isValidISODate, toCents } from "../utils";

/**
 * The income side of the plan: the paycheques and other money the user expects
 * to arrive, and when.
 *
 * This is to IncomeContext what BudgetPlanContext is to expenses — the estimate,
 * not the record. Nothing here is money that has landed, and nothing here is
 * spendable: the envelope figures on the Transactions page are built entirely
 * from income that actually arrived. Expected income exists so the plan can
 * answer one question before the month starts — does what I intend to spend fit
 * inside what I intend to earn?
 *
 * A source is stored once with a cadence and one real payday (`anchorDate`), and
 * every period's figure is derived from it by counting the paydays that fall in
 * that month. See src/recurrence.js for why they are counted rather than
 * averaged. `endDate` retires a source without deleting it, which matters
 * because these figures are derived: deleting a finished job would also rewrite
 * what every month it paid out in expected to earn.
 */
const IncomePlanContext = React.createContext();

export function useIncomePlan() {
  return useContext(IncomePlanContext);
}

function migrateIncomeSources(stored) {
  const sources = Array.isArray(stored) ? stored : [];
  return sources
    .filter((source) => source && source.name != null)
    .map((source) => ({
      id: source.id ?? uuidV4(),
      name: source.name,
      amountCents: source.amountCents ?? toCents(source.amount) ?? 0,
      cadence: source.cadence,
      anchorDate: source.anchorDate ?? null,
      // Absent and "runs forever" are the same thing; store one of them.
      endDate: source.endDate ?? null,
    }));
}

export const IncomePlanProvider = ({ children }) => {
  const [sources, setSources] = useLocalStorage("incomeSources", [], migrateIncomeSources);

  /**
   * Each source with the paydays it has in this period and what they add up to.
   * Sources that do not pay this month are kept in the list with an empty
   * `dates` — a quarterly source is silent two months in three, and dropping it
   * from the table would read as though it had been deleted.
   */
  const getPeriodSources = useCallback(
    (period) =>
      sources.map((source) => {
        const dates = occurrencesInPeriod(source, period);
        return { ...source, dates, expectedCents: dates.length * source.amountCents };
      }),
    [sources]
  );

  const getExpectedIncomeCents = useCallback(
    (period) =>
      sources.reduce((sum, source) => sum + expectedCentsInPeriod(source, period), 0),
    [sources]
  );

  // Validated here rather than in the form: this is the boundary every caller
  // crosses, and a source with no cadence or no anchor would silently expect
  // nothing, for every month, forever.
  const addIncomeSource = useCallback(
    ({ name, amount, amountCents, cadence, anchorDate, endDate = null }) => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Give the income source a name." };

      const cents = amountCents ?? toCents(amount);
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      if (!CADENCES[cadence]) return { ok: false, error: "Choose how often it is paid." };
      if (!isValidISODate(anchorDate)) {
        return { ok: false, error: "Enter the date of a payment, so the schedule has a starting point." };
      }

      // Empty is the common case — most income has no known end.
      const end = endDate ? endDate : null;
      if (end != null && !isValidISODate(end)) {
        return { ok: false, error: "Enter a valid end date, or leave it blank." };
      }
      if (end != null && end < anchorDate) {
        return { ok: false, error: "The end date cannot fall before the first payment." };
      }

      const id = uuidV4();
      setSources((prevSources) => [
        ...prevSources,
        { id, name: trimmed, amountCents: cents, cadence, anchorDate, endDate: end },
      ]);
      return { ok: true, id };
    },
    [setSources]
  );

  /**
   * No cascade, in either direction. Nothing links a source to the income
   * records it predicted — a paycheque that arrives is logged on its own, and
   * matching the two would mean inventing a correspondence the user never
   * stated. Deleting a source only changes what the plan expected.
   */
  const deleteIncomeSource = useCallback(
    ({ id }) => setSources((prevSources) => prevSources.filter((source) => source.id !== id)),
    [setSources]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      sources,
      getPeriodSources,
      getExpectedIncomeCents,
      addIncomeSource,
      deleteIncomeSource,
    }),
    [sources, getPeriodSources, getExpectedIncomeCents, addIncomeSource, deleteIncomeSource]
  );

  return <IncomePlanContext.Provider value={value}>{children}</IncomePlanContext.Provider>;
};
