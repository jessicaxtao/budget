import React, { useContext } from "react";
import useLocalStorage from "../hooks/useLocalStorage";

/**
 * Scaffolding for retirement planning.
 *
 * Assumptions live in their own store on purpose: the plan may be *seeded* from
 * real budget and net worth figures, but editing it must never write back to
 * the books. Anything the user has not touched stays `null` so the projection
 * can fall back to the real number; `resetAssumptions` returns to that state.
 *
 * Storage only — seeding and the projection math are not implemented yet.
 */
const RetirementContext = React.createContext();

export const DEFAULT_ASSUMPTIONS = {
  currentAge: null,
  retirementAge: null,
  lifeExpectancy: null,
  // null means "use the real figure from the budget / net worth pages".
  currentPortfolioValue: null,
  annualContribution: null,
  annualRetirementSpending: null,
  expectedReturnRate: null,
  inflationRate: null,
  withdrawalRate: null,
};

export function useRetirement() {
  return useContext(RetirementContext);
}

export const RetirementProvider = ({ children }) => {
  const [assumptions, setAssumptions] = useLocalStorage("retirementAssumptions", DEFAULT_ASSUMPTIONS);

  function updateAssumptions(changes) {
    setAssumptions((prevAssumptions) => ({ ...prevAssumptions, ...changes }));
  }

  function resetAssumptions() {
    setAssumptions(DEFAULT_ASSUMPTIONS);
  }

  return (
    <RetirementContext.Provider value={{ assumptions, updateAssumptions, resetAssumptions }}>
      {children}
    </RetirementContext.Provider>
  );
};
