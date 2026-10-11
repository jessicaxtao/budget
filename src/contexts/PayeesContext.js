import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { TRANSACTION_KINDS, useTransactions } from "./TransactionsContext";
import { describeDefaultSplitProblem } from "../payeeDefaults";

/**
 * Who the money went to, as a record rather than as a string typed again on
 * every row.
 *
 * The ledger has always had a free-text `description`, and the entry form has
 * always labelled it "Paid to" — so a payee is what it already held, in the one
 * shape that cannot be corrected, counted or reasoned about. Three things follow
 * from that and all three are the reason this store exists: a shop's name could
 * only be fixed one row at a time, two spellings of one shop were two unrelated
 * strings with nothing to merge them with, and nothing could be known *about* a
 * payee, so the category a shop is always filed under had to be picked by hand
 * every single time.
 *
 * A record is:
 *
 *   payee { id, name, defaultBudgetId, defaultSplit, defaultAccountId, defaultKind }
 *
 * The transaction names it by **id**, which is the whole point: a rename is one
 * write to one record and every row that names it says the new name, because no
 * row was ever holding the name in the first place.
 *
 * **`defaultBudgetId` is a default and nothing more.** It decides what the *next*
 * transaction to this payee starts on; it never restates one already recorded.
 * That is the rule a recipient's `deductible` flag keeps in `DonationsContext`
 * and a group's bucket keeps in `BudgetsContext`, and it is kept here for the
 * same reason — correcting where a shop is usually filed in March must not move
 * money that was filed in February. It is nullable, and `null` is the ordinary
 * case: most payees are not always filed the same way, and a store that insisted
 * otherwise would be guessing on most of the list.
 *
 * **The default is not checked against the live categories, and deleting a
 * category does not cascade into it.** A default naming a category that has since
 * gone is *inert but kept* — the rule a switched-away-from `toAccountId` follows,
 * and a split record's own `budgetId`. Checking it would mean reading
 * `BudgetsContext` from here, and this provider sits *above* it. It is resolved
 * where it is read instead: `AddTransactionModal` already asks whether a seeded
 * category is one it knows, and `PayeeList` gives a stored-but-unknown value an
 * option of its own rather than showing the first category and appearing to have
 * refiled the payee by being looked at.
 *
 * **This provider sits inside `TransactionsProvider`**, which is the cascade rule
 * `AccountsProvider` already follows: a store whose delete has to reach into the
 * ledger sits *inside* it, so it can call across. Deleting a payee detaches its
 * transactions and merging two repoints them, and both of those are the ledger's
 * writes to make. Nothing deletes *into* this store, so nothing else moves.
 *
 * **The three other defaults are the same kind of answer** — what the entry form
 * opens on when this payee is named, never a restatement of a row:
 *
 *   - `defaultSplit` — null, or how a receipt here is usually divided, as shares
 *     (`src/payeeDefaults.js`): "Costco is 70% groceries, 30% household". Where
 *     it is set it is what the form opens on, ahead of `defaultBudgetId`, which
 *     is **kept** beneath it rather than cleared — taking the split off brings
 *     the single category back, the "both answers kept" rule.
 *   - `defaultAccountId` — null, or the account money to this payee usually goes
 *     through. Inert but kept, exactly like the category: a deleted or off-budget
 *     account is passed over where it is read.
 *   - `defaultKind` — null, or the direction the form turns to. `null` is money
 *     out, the ordinary case; an employer is the payee worth saying "money in"
 *     for.
 *
 * None of them is ever filled in by the app on its own. They are written from
 * this panel, or from the entry form's "next time" boxes, which the person ticks.
 */
const PayeesContext = React.createContext();

export function usePayees() {
  return useContext(PayeesContext);
}

/**
 * A payee's **identity**: trimmed, inner whitespace collapsed, lowercased.
 *
 * The only thing the clash check reads, so "Costco " and "costco" are one payee
 * and the list cannot hold two records the app would call by one name.
 *
 * Deliberately *less* forgiving than `searchKey` in `src/payeeSearch.js`, which
 * also drops punctuation so that typing "att" finds "AT&T". Folding punctuation
 * into identity as well would refuse to let "ATT" and "AT&T" both exist, and
 * they may genuinely be two different payees — searching wants to be generous
 * about what somebody might have meant, and identity has to be exact about what
 * is already there.
 */
export function normalizePayeeName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** A name as it is stored: trimmed and collapsed, but as the user capitalised it. */
function cleanName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

const NAME_ERROR = "Give the payee a name.";

const PAYEE_KINDS = [TRANSACTION_KINDS.INFLOW, TRANSACTION_KINDS.OUTFLOW];

/**
 * The default fields named in `fields`, cleaned, or an error. Undefined fields
 * are left out, so `updatePayee` changes only what it was given; "" is what an
 * unpicked select is worth in the DOM and is read as no default.
 */
function readDefaults(fields) {
  const changes = {};
  if (fields.defaultBudgetId !== undefined) changes.defaultBudgetId = fields.defaultBudgetId || null;
  if (fields.defaultAccountId !== undefined) {
    changes.defaultAccountId = fields.defaultAccountId || null;
  }
  if (fields.defaultKind !== undefined) {
    const kind = fields.defaultKind || null;
    if (kind != null && !PAYEE_KINDS.includes(kind)) {
      return { error: "A payee opens as money in or money out." };
    }
    changes.defaultKind = kind;
  }
  if (fields.defaultSplit !== undefined) {
    const split = fields.defaultSplit ?? null;
    const problem = describeDefaultSplitProblem(split);
    if (problem) return { error: problem };
    changes.defaultSplit = split && split.map(({ budgetId, shareBps }) => ({ budgetId, shareBps }));
  }
  return { changes };
}

/** Whether a default field moved — by value, since a split is a list. */
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Keyed on field presence rather than a version counter, so it is
// self-describing and safe to re-run.
function migratePayees(stored) {
  const payees = Array.isArray(stored) ? stored : [];
  return payees
    .filter((payee) => payee && payee.name != null)
    .map((payee) => ({
      id: payee.id ?? uuidV4(),
      name: payee.name,
      // Null is the ordinary state, not a gap waiting to be filled: most payees
      // are not always filed under one category.
      defaultBudgetId: payee.defaultBudgetId ?? null,
      // Stamped by presence, purely additive: nothing is guessed from the ledger
      // about where a payee is usually paid from or how it is usually divided.
      defaultSplit: payee.defaultSplit ?? null,
      defaultAccountId: payee.defaultAccountId ?? null,
      defaultKind: payee.defaultKind ?? null,
    }));
}

export const PayeesProvider = ({ children }) => {
  const [payees, setPayees] = useSyncedState("payees", [], migratePayees);
  const { detachPayeeTransactions, repointPayeeTransactions } = useTransactions();

  /** Every payee by id, for the consumers that only need a name. */
  const payeeById = useMemo(() => new Map(payees.map((payee) => [payee.id, payee])), [payees]);

  /**
   * The payee `name` already names, or null. By identity, not by search — this
   * is what "does this one already exist" means, and it is the question both the
   * clash check and the forms' create-or-take decision are asking.
   */
  const findPayeeByName = useCallback(
    (name) => {
      const key = normalizePayeeName(name);
      if (!key) return null;
      return payees.find((payee) => normalizePayeeName(payee.name) === key) ?? null;
    },
    [payees]
  );

  /**
   * Add a payee. Returns a result rather than throwing, like every mutator here:
   * the caller decides what to tell the user, and a form that closes on a
   * duplicate is the one option that cannot be right.
   */
  const addPayee = useCallback(
    ({ name, ...defaults }) => {
      const trimmed = cleanName(name);
      if (!trimmed) return { ok: false, error: NAME_ERROR };
      const read = readDefaults(defaults);
      if (read.error) return { ok: false, error: read.error };

      const key = normalizePayeeName(trimmed);
      if (payees.some((payee) => normalizePayeeName(payee.name) === key)) {
        return { ok: false, error: `A payee named “${trimmed}” already exists.` };
      }

      const id = uuidV4();
      setPayees((previous) => [
        ...previous,
        {
          id,
          name: trimmed,
          defaultBudgetId: null,
          defaultSplit: null,
          defaultAccountId: null,
          defaultKind: null,
          ...read.changes,
        },
      ]);
      return { ok: true, id };
    },
    [payees, setPayees]
  );

  /**
   * Rename a payee, or restate what a new transaction to it starts on. Undefined
   * fields are left alone; a default given as null takes it off.
   *
   * Refuses an id it cannot find rather than letting a `map` that matches nothing
   * report the write as landed — `updateSavingsGoal`'s rule, for its reason:
   * `useSyncedState` syncs a delete from another tab or another device, and the
   * panel can be open on a row the store no longer has.
   */
  const updatePayee = useCallback(
    ({ id, name, ...defaults }) => {
      const existing = payees.find((payee) => payee.id === id);
      if (!existing) return { ok: false, error: "That payee no longer exists." };

      const changes = {};

      if (name !== undefined) {
        const trimmed = cleanName(name);
        if (!trimmed) return { ok: false, error: NAME_ERROR };
        const key = normalizePayeeName(trimmed);
        const clash = payees.some(
          (payee) => payee.id !== id && normalizePayeeName(payee.name) === key
        );
        if (clash) {
          return {
            ok: false,
            error: `A payee named “${trimmed}” already exists. Merge them instead.`,
          };
        }
        changes.name = trimmed;
      }

      const read = readDefaults(defaults);
      if (read.error) return { ok: false, error: read.error };
      Object.assign(changes, read.changes);

      // Nothing actually moved. Writing anyway would re-render every consumer for
      // a cell the user only tabbed through.
      const moved = Object.keys(changes).some((field) => !sameValue(changes[field], existing[field]));
      if (!moved) return { ok: true, id };

      setPayees((previous) =>
        previous.map((payee) => (payee.id === id ? { ...payee, ...changes } : payee))
      );
      return { ok: true, id };
    },
    [payees, setPayees]
  );

  /**
   * Remove a payee, keeping every transaction that named it.
   *
   * The same rule as removing an organisation or an account: the money moved, and
   * what is lost is only the record of who it went to. `detachPayeeTransactions`
   * leaves those rows with `payeeId: null`, which is a state the register can
   * show and the user can correct — deleting the money instead would rewrite
   * every envelope balance because somebody tidied a list.
   */
  const deletePayee = useCallback(
    ({ id }) => {
      setPayees((previous) => previous.filter((payee) => payee.id !== id));
      detachPayeeTransactions({ payeeId: id });
      return { ok: true };
    },
    [setPayees, detachPayeeTransactions]
  );

  /**
   * Fold one or more payees into another: every transaction that named them names
   * the survivor instead, and the merged records are gone.
   *
   * This is the operation the entity exists for. Two spellings of one shop are
   * the ordinary state of any payee list that has been typed into for a year, and
   * without this the only way to unify them is to retype every row.
   *
   * **The whole batch is validated before anything is written**, the rule
   * `setPeriodAssignments` and `setPeriodBalances` both keep: a merge that
   * repointed four payees and then refused the fifth would leave the list in a
   * state the user never asked for and cannot see from here.
   *
   * **The ledger is written first.** Two stores mean this cannot be one atomic
   * write — the same residual `AddDonationModal` has — so the order is chosen for
   * which half is survivable alone: rows pointing at a payee that still exists is
   * a merge that did not happen, while payees deleted out from under their rows
   * would be rows pointing at nothing.
   *
   * **The survivor adopts a default only where it has none of its own.** Merging
   * must not lose the only answer either side had, and must not overwrite an
   * answer the survivor already gave. Where a receipt is filed — the category and
   * the split — is **one** answer, adopted together: a survivor filed under one
   * category that took a source's split would be refiled by the merge.
   */
  const mergePayees = useCallback(
    ({ fromIds, intoId }) => {
      const target = payees.find((payee) => payee.id === intoId);
      if (!target) return { ok: false, error: "That payee no longer exists." };

      const sources = Array.isArray(fromIds) ? fromIds : [fromIds];
      if (sources.length === 0) return { ok: false, error: "Choose which payees to merge in." };
      if (sources.includes(intoId)) {
        return { ok: false, error: "A payee cannot be merged into itself." };
      }

      const merged = sources.map((id) => payees.find((payee) => payee.id === id));
      if (merged.some((payee) => !payee)) {
        return { ok: false, error: "One of those payees no longer exists." };
      }

      repointPayeeTransactions({ fromPayeeIds: sources, toPayeeId: intoId });

      const files = (payee) => payee.defaultBudgetId != null || payee.defaultSplit != null;
      const filing = files(target) ? target : merged.find(files) ?? target;
      const adopted = {
        defaultBudgetId: filing.defaultBudgetId ?? null,
        defaultSplit: filing.defaultSplit ?? null,
        defaultAccountId:
          target.defaultAccountId ??
          merged.find((payee) => payee.defaultAccountId)?.defaultAccountId ??
          null,
        defaultKind:
          target.defaultKind ?? merged.find((payee) => payee.defaultKind)?.defaultKind ?? null,
      };

      setPayees((previous) =>
        previous
          .filter((payee) => !sources.includes(payee.id))
          .map((payee) => (payee.id === intoId ? { ...payee, ...adopted } : payee))
      );
      return { ok: true, id: intoId };
    },
    [payees, setPayees, repointPayeeTransactions]
  );

  // Memoised so a change in any other store does not re-render every consumer of
  // this one.
  const value = useMemo(
    () => ({
      payees,
      payeeById,
      findPayeeByName,
      addPayee,
      updatePayee,
      deletePayee,
      mergePayees,
    }),
    [payees, payeeById, findPayeeByName, addPayee, updatePayee, deletePayee, mergePayees]
  );

  return <PayeesContext.Provider value={value}>{children}</PayeesContext.Provider>;
};
