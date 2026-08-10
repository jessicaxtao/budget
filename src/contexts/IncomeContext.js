import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { isValidISODate, toCents, todayISO, toPeriod } from "../utils";

const IncomeContext = React.createContext();

export function useIncome() {
  return useContext(IncomeContext);
}

function migrateIncome(stored) {
  const income = Array.isArray(stored) ? stored : [];
  return income.map((entry) =>
    "amount" in entry
      ? {
          id: entry.id ?? uuidV4(),
          description: entry.description,
          amountCents: toCents(entry.amount) ?? 0,
          // Unknown for records logged before dates existed; left null rather
          // than backfilled with today's date, which would invent history.
          date: entry.date ?? null,
        }
      : entry
  );
}

export const IncomeProvider = ({ children }) => {
  const [income, setIncome] = useLocalStorage("income", [], migrateIncome);

  const totalIncomeCents = useMemo(
    () => income.reduce((sum, entry) => sum + entry.amountCents, 0),
    [income]
  );

  const getPeriodIncome = useCallback(
    (period) => income.filter((entry) => toPeriod(entry.date) === period),
    [income]
  );

  // Validated here rather than in the form: this is the boundary every caller
  // crosses, and NaN would otherwise reach storage, where JSON.stringify
  // silently records it as null.
  const addIncome = useCallback(
    ({ description, amount, amountCents, date = todayISO() }) => {
      const cents = amountCents ?? toCents(amount);
      if (cents == null || cents < 0) {
        return { ok: false, error: "Enter an amount of zero or more." };
      }
      if (!isValidISODate(date)) {
        return { ok: false, error: "Enter a valid date." };
      }

      setIncome((prevIncome) => [
        ...prevIncome,
        { id: uuidV4(), description: description.trim(), amountCents: cents, date },
      ]);
      return { ok: true };
    },
    [setIncome]
  );

  const deleteIncome = useCallback(
    ({ id }) => setIncome((prevIncome) => prevIncome.filter((entry) => entry.id !== id)),
    [setIncome]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({ income, totalIncomeCents, getPeriodIncome, addIncome, deleteIncome }),
    [income, totalIncomeCents, getPeriodIncome, addIncome, deleteIncome]
  );

  return <IncomeContext.Provider value={value}>{children}</IncomeContext.Provider>;
};
