import React, { useContext } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { toCents } from "../utils";

/**
 * Scaffolding for the net worth report.
 *
 * `accounts` is the list of things owned and owed; `balances` is a hand-entered
 * balance for one account in one period ("YYYY-MM"), which is what makes the
 * net-worth-over-time chart possible.
 *
 * Storage and CRUD only — totals, allocation, and period-over-period change are
 * not implemented yet.
 */
const AccountsContext = React.createContext();

export const ACCOUNT_TYPES = { ASSET: "asset", LIABILITY: "liability" };

export const ASSET_CLASSES = ["Cash", "Stocks", "Bonds", "Real estate", "Alternatives", "Other"];

export function useAccounts() {
  return useContext(AccountsContext);
}

// Balances follow the same rule as every other figure in the app: integer
// cents, never floating-point dollars.
function migrateBalances(stored) {
  const balances = Array.isArray(stored) ? stored : [];
  return balances.map((balance) =>
    "amount" in balance
      ? {
          id: balance.id ?? uuidV4(),
          accountId: balance.accountId,
          period: balance.period,
          amountCents: toCents(balance.amount) ?? 0,
        }
      : balance
  );
}

export const AccountsProvider = ({ children }) => {
  const [accounts, setAccounts] = useLocalStorage("accounts", []);
  const [balances, setBalances] = useLocalStorage("accountBalances", [], migrateBalances);

  function addAccount({ name, type = ACCOUNT_TYPES.ASSET, assetClass = "Other", institution = "" }) {
    setAccounts((prevAccounts) => [...prevAccounts, { id: uuidV4(), name, type, assetClass, institution }]);
  }

  function updateAccount({ id, ...fields }) {
    setAccounts((prevAccounts) =>
      prevAccounts.map((account) => (account.id === id ? { ...account, ...fields } : account))
    );
  }

  // Deleting an account drops its balance history with it — there is nothing
  // meaningful to reassign them to.
  function deleteAccount({ id }) {
    setBalances((prevBalances) => prevBalances.filter((balance) => balance.accountId !== id));
    setAccounts((prevAccounts) => prevAccounts.filter((account) => account.id !== id));
  }

  function getAccountBalances(accountId) {
    return balances.filter((balance) => balance.accountId === accountId);
  }

  function getPeriodBalances(period) {
    return balances.filter((balance) => balance.period === period);
  }

  // Upsert: one balance per (accountId, period). A liability's balance is
  // negative, so this validates only that the figure is a real number.
  function setBalance({ accountId, period, amount, amountCents }) {
    const cents = amountCents ?? toCents(amount);
    if (cents == null) {
      return { ok: false, error: "Enter a balance as a number." };
    }

    setBalances((prevBalances) => {
      const existing = prevBalances.find(
        (balance) => balance.accountId === accountId && balance.period === period
      );
      if (existing) {
        return prevBalances.map((balance) =>
          balance.id === existing.id ? { ...balance, amountCents: cents } : balance
        );
      }
      return [...prevBalances, { id: uuidV4(), accountId, period, amountCents: cents }];
    });

    return { ok: true };
  }

  function deleteBalance({ id }) {
    setBalances((prevBalances) => prevBalances.filter((balance) => balance.id !== id));
  }

  return (
    <AccountsContext.Provider
      value={{
        accounts,
        balances,
        addAccount,
        updateAccount,
        deleteAccount,
        getAccountBalances,
        getPeriodBalances,
        setBalance,
        deleteBalance,
      }}
    >
      {children}
    </AccountsContext.Provider>
  );
};
