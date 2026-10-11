import React, { useCallback, useContext, useMemo } from "react";
import { v4 as uuidV4 } from "uuid";
import useSyncedState from "../hooks/useSyncedState";
import { readFilter, sameFilter } from "../transactionFilter";

/**
 * Searches of the register the household keeps: a name, and the filter it
 * stands for.
 *
 * A record is `{ id, name, filter }`, and the filter is exactly the object
 * `src/transactionFilter.js` describes — the same one the bar holds in state.
 * That is the whole reason a saved filter can exist: every facet is plain JSON,
 * so what is stored is the question itself rather than a description of it, and
 * `readFilter` is both the normaliser for one being saved and the migration for
 * one read back. See that module's note on why nothing in a filter is a
 * function.
 *
 * **It holds no money.** Nothing derived from the books reads this store — not
 * an envelope, not a balance, not a report — so saving a filter moves no figure
 * anywhere. It is the same standing as `Scenarios`: a store of intentions, read
 * by one page.
 *
 * **It names other stores' records and never reads them back.** A filter carries
 * category ids, account ids and tags; a category since deleted contributes
 * nothing when the filter is applied and is **inert but kept**, the rule every
 * cross-store reference here follows. Nothing cascades in: a household that
 * deletes the Fuel category keeps its "fuel this year" search, which starts
 * matching again the moment they make the category afresh — and clearing the
 * dead id out would quietly turn a narrow search into a wide one.
 *
 * Names are unique by their trimmed, case-folded form, for `Scenarios`' reason:
 * two searches called "Costco" are a list nobody can choose from. There is no cap
 * — a saved filter costs a chip in a wrapping row rather than a colour nobody
 * measured.
 */
const SavedFiltersContext = React.createContext();

export function useSavedFilters() {
  return useContext(SavedFiltersContext);
}

const normalise = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();

function migrateSavedFilters(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (saved) =>
        saved &&
        typeof saved.id === "string" &&
        typeof saved.name === "string" &&
        saved.name.trim() !== ""
    )
    .map((saved) => ({
      id: saved.id,
      name: saved.name,
      // Through `readFilter` rather than stored raw, so a filter written by a
      // build with a facet this one does not have still reads as a filter — it
      // simply stops narrowing by the facet nobody here understands.
      filter: readFilter(saved.filter),
    }));
}

export const SavedFiltersProvider = ({ children }) => {
  const [savedFilters, setSavedFilters] = useSyncedState(
    "savedFilters",
    [],
    migrateSavedFilters
  );

  const clash = useCallback(
    (name, exceptId) =>
      savedFilters.some(
        (saved) => saved.id !== exceptId && normalise(saved.name) === normalise(name)
      ),
    [savedFilters]
  );

  /** Keep the filter now in force under a name. */
  const saveFilter = useCallback(
    ({ name, filter }) => {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) return { ok: false, error: "Give the filter a name." };
      if (clash(trimmed)) {
        return { ok: false, error: `There is already a filter called "${trimmed}".` };
      }
      const read = readFilter(filter);
      // A filter that narrows nothing would be a saved search that shows the
      // month as it already is — a chip that does nothing when it is clicked.
      if (sameFilter(read, {})) {
        return { ok: false, error: "There is nothing to save — set a search or a filter first." };
      }

      const id = uuidV4();
      setSavedFilters((previous) => [...previous, { id, name: trimmed, filter: read }]);
      return { ok: true, id };
    },
    [clash, setSavedFilters]
  );

  /** Restate what a saved filter stands for, keeping its name. */
  const updateSavedFilter = useCallback(
    ({ id, filter }) => {
      if (!savedFilters.some((saved) => saved.id === id)) {
        return { ok: false, error: "That filter is no longer saved." };
      }
      setSavedFilters((previous) =>
        previous.map((saved) => (saved.id === id ? { ...saved, filter: readFilter(filter) } : saved))
      );
      return { ok: true, id };
    },
    [savedFilters, setSavedFilters]
  );

  const renameSavedFilter = useCallback(
    ({ id, name }) => {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) return { ok: false, error: "Give the filter a name." };
      if (!savedFilters.some((saved) => saved.id === id)) {
        return { ok: false, error: "That filter is no longer saved." };
      }
      if (clash(trimmed, id)) {
        return { ok: false, error: `There is already a filter called "${trimmed}".` };
      }
      setSavedFilters((previous) =>
        previous.map((saved) => (saved.id === id ? { ...saved, name: trimmed } : saved))
      );
      return { ok: true, id };
    },
    [savedFilters, clash, setSavedFilters]
  );

  const deleteSavedFilter = useCallback(
    (id) => {
      setSavedFilters((previous) => previous.filter((saved) => saved.id !== id));
      return { ok: true };
    },
    [setSavedFilters]
  );

  const value = useMemo(
    () => ({ savedFilters, saveFilter, updateSavedFilter, renameSavedFilter, deleteSavedFilter }),
    [savedFilters, saveFilter, updateSavedFilter, renameSavedFilter, deleteSavedFilter]
  );

  return <SavedFiltersContext.Provider value={value}>{children}</SavedFiltersContext.Provider>;
};
