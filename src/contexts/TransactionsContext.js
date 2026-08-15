import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useLocalStorage from "../hooks/useLocalStorage";
import { useDonations } from "./DonationsContext";
import { isValidISODate, toCents, todayISO } from "../utils";

/**
 * Every movement of money, in one ledger.
 *
 * Income and expenses used to be two stores — `income` in a context of its own
 * and `expenses` inside BudgetsContext — which meant two forms, two lists, and
 * two record shapes describing the same event: money moved, on a date, through
 * an account. They are one store now, discriminated by `kind`.
 *
 * A record is:
 *
 *   { id, kind, date, description, amountCents, accountId, budgetId }
 *
 * `amountCents` is a non-negative magnitude and `kind` carries the direction,
 * rather than a signed amount. Money that moves in two directions through one
 * signed field invites every sign bug there is; the direction is a field of its
 * own, and the amount is always the size of the movement.
 *
 * **An outflow must name a category. An inflow may.** An inflow with no category
 * is income — it lands in the pool as money to assign. An inflow *with* one is a
 * refund against that category: the friend paying back their half of dinner, the
 * returned jacket, the reimbursed fare. It never reaches the pool, because that
 * money was already assigned once when it went out; it goes back where it came
 * from, and the category's activity for the month is the net of the two. Spend
 * $100 on food and be paid back $60 and food shows $40 of activity, which is what
 * the household actually spent on food.
 *
 * **Every new record names an account.** Refused at this boundary rather than in
 * the form, because this is the edge every caller crosses, and money has to come
 * from somewhere for an account balance to mean anything. `accountId: null` and
 * the Uncategorized sentinel still *read* fine: legacy records have no account,
 * and deleting a category hands its transactions to Uncategorized. What cannot
 * happen is writing a new one that way.
 *
 * **A record can be corrected in place.** `updateTransaction` takes a patch of
 * whatever fields moved and checks the rules those fields could break, so the
 * register can commit one cell at a time and a row folded in from the old
 * stores — no date, no account — can still have its description fixed without
 * being asked to invent the rest. See `RULES` and `firstBroken`.
 */
const TransactionsContext = React.createContext();

export const TRANSACTION_KINDS = { INFLOW: "inflow", OUTFLOW: "outflow" };

const KIND_VALUES = Object.values(TRANSACTION_KINDS);

export function useTransactions() {
  return useContext(TransactionsContext);
}

const isOutflow = (transaction) => transaction.kind === TRANSACTION_KINDS.OUTFLOW;
const isInflow = (transaction) => transaction.kind === TRANSACTION_KINDS.INFLOW;

/** One legacy record — from either old key — in the shape this store holds. */
function fromLegacy(record, kind) {
  if (!record) return null;
  // Both old stores went through a cents migration of their own, so a stored
  // value may be at either schema.
  const cents = "amount" in record ? toCents(record.amount) ?? 0 : record.amountCents ?? 0;

  return {
    id: record.id ?? uuidV4(),
    kind,
    description: record.description ?? "",
    amountCents: cents,
    // Genuinely unknown for records logged before dates existed. Left null
    // rather than backfilled with today's date, which would invent history.
    date: record.date ?? null,
    // Nothing recorded which account the money moved through, and there is no
    // way to work it out after the fact. Undated is to dates what this is to
    // accounts: an honest gap rather than a guess.
    accountId: null,
    // The old income store had no category to record, so a folded inflow is
    // income rather than a refund — which is what it was when it was logged.
    budgetId: record.budgetId ?? null,
  };
}

/**
 * The two old keys, folded into one ledger.
 *
 * Runs in the lazy default *only* — the `transactions` key existing means this
 * has already happened, and re-running it could only duplicate the ledger. The
 * old keys are left in storage rather than deleted: a migration that destroys
 * the only copy of the user's data has no way to undo itself, and leaving them
 * means clearing `transactions` re-seeds from them instead of losing everything.
 *
 * Guarded end to end. A failure here must cost nothing worse than starting
 * empty, and it must never take the render down — every provider wraps the whole
 * app.
 */
export function foldLegacyLedger() {
  const folded = [];

  for (const [key, kind] of [
    ["expenses", TRANSACTION_KINDS.OUTFLOW],
    ["income", TRANSACTION_KINDS.INFLOW],
  ]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;

      const records = JSON.parse(raw);
      if (!Array.isArray(records)) continue;

      for (const record of records) {
        const transaction = fromLegacy(record, kind);
        if (transaction) folded.push(transaction);
      }
    } catch {
      // Unreadable key. The other one may still be fine.
    }
  }

  return folded;
}

/**
 * The ledger as it stands in storage, without a React tree.
 *
 * Exists for the day-one assignment seed, which runs in AssignmentsContext's
 * lazy default and so cannot read this provider — see AssignmentsContext. It
 * prefers the current key and falls back to the legacy ones, because provider
 * *initialisers* all run before any provider's persist effect has written
 * anything: on the very first load after the merge, `transactions` is still
 * absent from storage while this store already holds the folded ledger.
 */
export function readStoredLedger() {
  try {
    const raw = localStorage.getItem("transactions");
    if (raw != null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return migrateTransactions(parsed);
    }
  } catch {
    // Fall through to the legacy keys, which may still be readable.
  }
  return foldLegacyLedger();
}

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run. Anything without a recognised kind is
// treated as an outflow: the overwhelming majority of any ledger is spending,
// and a record dropped here would be money vanishing from the books.
function migrateTransactions(stored) {
  const transactions = Array.isArray(stored) ? stored : [];

  return transactions
    .filter((transaction) => transaction && typeof transaction === "object")
    .map((transaction) => {
      const kind = KIND_VALUES.includes(transaction.kind)
        ? transaction.kind
        : TRANSACTION_KINDS.OUTFLOW;

      return {
        id: transaction.id ?? uuidV4(),
        kind,
        description: transaction.description ?? "",
        amountCents:
          "amount" in transaction
            ? toCents(transaction.amount) ?? 0
            : transaction.amountCents ?? 0,
        date: transaction.date ?? null,
        accountId: transaction.accountId ?? null,
        // Carried on both kinds. On an outflow it is the category the money came
        // from; on an inflow it is the category the money went back to, which is
        // a refund. An inflow without one is income.
        budgetId: transaction.budgetId ?? null,
      };
    });
}

/**
 * Every rule a stored record has to satisfy, in the order the user meets them
 * while filling a row in.
 *
 * Written out as data rather than a run of `if`s because two callers check the
 * same rules against different amounts of the record. `addTransaction` builds a
 * whole one and checks all of it. `updateTransaction` changes a field or two of
 * a record that already exists, and checks only the rules those fields could
 * break — which is why each rule names the fields it is about.
 *
 * The last one is the only cross-field rule there is: an outflow names a
 * category. Either side of it moving can break it, so it lists both.
 */
const RULES = [
  {
    fields: ["kind"],
    holds: (t) => KIND_VALUES.includes(t.kind),
    error: "Choose whether money came in or went out.",
  },
  {
    fields: ["amountCents"],
    holds: (t) => t.amountCents != null && t.amountCents >= 0,
    error: "Enter an amount of zero or more.",
  },
  {
    fields: ["date"],
    holds: (t) => isValidISODate(t.date),
    error: "Enter a valid date.",
  },
  {
    fields: ["accountId"],
    holds: (t) => Boolean(t.accountId),
    error: "Choose the account this moved through.",
  },
  {
    fields: ["kind", "budgetId"],
    holds: (t) => t.kind !== TRANSACTION_KINDS.OUTFLOW || Boolean(t.budgetId),
    error: "Choose a category for this expense.",
  },
];

/**
 * The first rule `record` breaks, as a result the caller can surface.
 *
 * `touched` is the set of fields being written; leave it out to check the whole
 * record. **An update checks only what it changes**, which is what lets a
 * legacy row be corrected at all: records folded in from the old stores have no
 * date and no account, and refusing to fix a typo on one until the user invents
 * a date for it would be a worse ledger, not a stricter one. What an update
 * still cannot do is *open* one of those gaps — clearing a date or an account
 * touches that field, so the rule runs and refuses.
 */
function firstBroken(record, touched) {
  for (const rule of RULES) {
    if (touched && !rule.fields.some((field) => touched.has(field))) continue;
    if (!rule.holds(record)) return { ok: false, error: rule.error };
  }
  return { ok: true };
}

export const TransactionsProvider = ({ children }) => {
  const [transactions, setTransactions] = useLocalStorage(
    "transactions",
    foldLegacyLedger,
    migrateTransactions
  );
  const { removeDonation } = useDonations();

  const outflows = useMemo(() => transactions.filter(isOutflow), [transactions]);
  const inflows = useMemo(() => transactions.filter(isInflow), [transactions]);

  // One pass instead of a full scan per category per render. Both kinds, since
  // a refund is part of what the category did this month — a list of a
  // category's spending that omits the money that came back would not add up to
  // the activity shown against it.
  const byBudget = useMemo(() => {
    const grouped = new Map();
    for (const transaction of transactions) {
      if (transaction.budgetId == null) continue;
      const bucket = grouped.get(transaction.budgetId);
      if (bucket) bucket.push(transaction);
      else grouped.set(transaction.budgetId, [transaction]);
    }
    return grouped;
  }, [transactions]);

  const getBudgetTransactions = useCallback(
    (budgetId) => byBudget.get(budgetId) ?? [],
    [byBudget]
  );

  const getAccountTransactions = useCallback(
    (accountId) => transactions.filter((transaction) => transaction.accountId === accountId),
    [transactions]
  );

  /**
   * Log one movement of money. Returns a result rather than throwing or
   * silently dropping the input: the caller has to decide what to tell the
   * user, and closing a modal as though a rejected record had been saved is the
   * one option that cannot be right.
   */
  const addTransaction = useCallback(
    ({ kind, description, amount, amountCents, date = todayISO(), accountId, budgetId }) => {
      const id = uuidV4();
      const transaction = {
        id,
        kind,
        description: (description ?? "").trim(),
        amountCents: amountCents ?? toCents(amount),
        date,
        accountId: accountId || null,
        // "" is what an unpicked select is worth in the DOM, and null is what
        // "no category" is worth here. The two must not be confused, or an
        // inflow would be a refund against a category with no name.
        budgetId: budgetId || null,
      };

      // Every rule, because every field is being written. The one that keeps
      // the ledger finishable in one sitting is the last: an outflow names its
      // category now, not later. An inflow is under no such rule — having no
      // category is what makes it income rather than a refund, so an empty
      // choice there is an answer and not an omission.
      const result = firstBroken(transaction);
      if (!result.ok) return result;

      setTransactions((prevTransactions) => [...prevTransactions, transaction]);
      return { ok: true, id };
    },
    [setTransactions]
  );

  /**
   * Correct a record already in the ledger, a field or two at a time.
   *
   * A patch rather than a whole record: the register edits one cell at a time,
   * and a mutator that took the full row would have every cell resubmitting the
   * five fields it did not touch. Only the fields present in the patch are
   * written, and only the rules those fields could break are checked — see
   * `firstBroken`.
   *
   * `amount` (dollars, as typed) and `amountCents` are both accepted, as on
   * `addTransaction`. The direction is an ordinary field here: filing a
   * paycheque as an expense is a mistake worth being able to undo without
   * deleting the row and losing everything else typed on it.
   */
  const updateTransaction = useCallback(
    (patch) => {
      const current = transactions.find((transaction) => transaction.id === patch?.id);
      // Two cells committing at once — a blur that lands on a Remove button —
      // can reach here after the row is gone. Say so rather than writing a
      // deleted record back into the ledger.
      if (!current) return { ok: false, error: "That transaction is no longer in the ledger." };

      const changes = {};
      if ("kind" in patch) changes.kind = patch.kind;
      if ("description" in patch) changes.description = (patch.description ?? "").trim();
      if ("amountCents" in patch) changes.amountCents = patch.amountCents;
      else if ("amount" in patch) changes.amountCents = toCents(patch.amount);
      if ("date" in patch) changes.date = patch.date;
      // Normalised at this boundary exactly as on the way in, so a cleared
      // select reads the same whichever mutator it went through.
      if ("accountId" in patch) changes.accountId = patch.accountId || null;
      if ("budgetId" in patch) changes.budgetId = patch.budgetId || null;

      const next = { ...current, ...changes };
      const result = firstBroken(next, new Set(Object.keys(changes)));
      if (!result.ok) return result;

      // Nothing actually moved. Writing anyway would re-render every consumer
      // of the ledger, and in a grid whose cells commit on blur, tabbing across
      // one row would do that once per column.
      const moved = Object.keys(changes).some((field) => changes[field] !== current[field]);
      if (!moved) return { ok: true, id: current.id };

      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) => (transaction.id === current.id ? next : transaction))
      );
      return { ok: true, id: current.id };
    },
    [transactions, setTransactions]
  );

  /**
   * Take one record off the ledger, and with it anything said *about* that
   * record elsewhere.
   *
   * A donation is the only such statement so far: it holds no money of its own,
   * only which organisation an outflow went to and how much of it is deductible,
   * so once the outflow is gone there is nothing left for it to describe. That
   * is a cascade rather than a detach, unlike an account's transactions — those
   * are the money, and the money still moved.
   */
  const deleteTransaction = useCallback(
    ({ id }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.filter((transaction) => transaction.id !== id)
      );
      removeDonation({ transactionId: id });
    },
    [setTransactions, removeDonation]
  );

  /**
   * Move everything filed under one category onto another, in one commit.
   *
   * Used when a category is deleted. Spend outlives the category it was filed
   * under — it is what actually happened — so it is reassigned rather than
   * dropped, and its funding follows it (see `reassignBudgetAssignments`).
   *
   * Refunds move with the spend they offset, which is why this is not filtered
   * to outflows. Leaving a refund pointing at a deleted category would strand it
   * against an id nothing renders while the spend it cancels moved on, and the
   * category it landed on would read as $100 spent on a dinner that cost $40.
   */
  const reassignBudgetTransactions = useCallback(
    ({ fromBudgetId, toBudgetId }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) =>
          transaction.budgetId === fromBudgetId
            ? { ...transaction, budgetId: toBudgetId }
            : transaction
        )
      );
    },
    [setTransactions]
  );

  /**
   * Cut every transaction loose from a deleted account, keeping the ledger.
   *
   * The money moved, and the budget it moved through is unchanged — only the
   * record of *where* it sat is gone. Deleting the transactions instead would
   * rewrite every envelope balance because the user tidied up their account
   * list. What is lost is the account's own running balance, which had nowhere
   * left to be shown anyway.
   */
  const detachAccountTransactions = useCallback(
    ({ accountId }) => {
      setTransactions((prevTransactions) =>
        prevTransactions.map((transaction) =>
          transaction.accountId === accountId ? { ...transaction, accountId: null } : transaction
        )
      );
    },
    [setTransactions]
  );

  // Memoised so a change in any other store does not re-render every consumer
  // of this one.
  const value = useMemo(
    () => ({
      transactions,
      inflows,
      outflows,
      getBudgetTransactions,
      getAccountTransactions,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      reassignBudgetTransactions,
      detachAccountTransactions,
    }),
    [
      transactions,
      inflows,
      outflows,
      getBudgetTransactions,
      getAccountTransactions,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      reassignBudgetTransactions,
      detachAccountTransactions,
    ]
  );

  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>;
};
