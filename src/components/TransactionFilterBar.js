import { useMemo, useRef, useState } from "react";
import Button from "./Button";
import Chip, { chipBase, chipOff, toggleId } from "./Chip";
import SegmentedControl from "./SegmentedControl";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { toSections } from "../planLayout";
import { formatTag } from "../tags";
import { EMPTY_FILTER, FILTER_SPANS, isFilterActive, sameFilter } from "../transactionFilter";
import { amountAtRest, amountEditing, toCents } from "../utils";

/**
 * Which rows of the register are on screen, and the searches the household keeps.
 *
 * **One row is always on show and the rest folds away**, because the question
 * asked ninety times out of a hundred is "where is the Costco one" and the
 * answer to it is a text box. Six facets drawn permanently above sixty rows would
 * be a form the page has to be scrolled past; behind one disclosure they are
 * there when they are wanted, with a count on the button so a filter left in
 * force can never be invisible.
 *
 * **The window is in that first row, beside the search.** It is the one facet
 * that changes what the figures under the register *mean* — the footing totals a
 * month, the undated band sits under a month, and the to-be-assigned bar above
 * is read at a month — so "all time" has to be as visible as the thing it
 * widens. It reads through `SegmentedControl` for exactly the reason that control
 * exists: it is a choice about what is on screen and nothing it does reaches a
 * store.
 *
 * **Nothing here commits to a store except a saved filter.** The facets are view
 * state held by the page, which is why this is a controlled component in a file
 * of uncontrolled forms: the register has to re-read itself on the keystroke, so
 * there is no submit to wait for and nothing to re-seed. The two money fields are
 * the exception that proves it — a figure edited in place commits on **blur**,
 * the app's rule, since a half-typed "1" on the way to "12" is a real figure and
 * would otherwise narrow the register to nothing for a moment.
 *
 * **A saved filter is applied by one click and nothing about it is implicit.**
 * The chip for the one in force is pressed; change anything and the chip lets go
 * and an Update button appears beside it, so a search that has been edited since
 * it was applied cannot be mistaken for the saved one. See `SavedFiltersContext`
 * for what is stored.
 */

const KIND_CHIPS = [
  { kind: TRANSACTION_KINDS.INFLOW, label: "In" },
  { kind: TRANSACTION_KINDS.OUTFLOW, label: "Out" },
  { kind: TRANSACTION_KINDS.TRANSFER, label: "Transfer" },
];

const SPAN_OPTIONS = [
  { value: FILTER_SPANS.MONTH, label: "This month" },
  { value: FILTER_SPANS.ALL, label: "All time" },
];

const legend = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

// The search box and the two money fields. Chalk on the panel, a hairline that
// turns azure under the caret — `Field`'s own treatment at the size of a toolbar
// rather than of a form.
const boxInput =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1 font-sans text-row text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

/**
 * A figure typed into one end of the amount range.
 *
 * `null` for a blank, which is what "no bound" is, and `undefined` for junk —
 * the two have to be told apart here, unlike in a store, because a blank is a
 * real answer that removes the bound while "12 apples" is a cell to put back.
 */
const readBound = (value) => {
  const raw = value.trim();
  if (raw === "") return null;
  return toCents(raw) ?? undefined;
};

export default function TransactionFilterBar({
  filter,
  onChange,
  groups,
  budgets,
  accounts,
  tags,
  savedFilters,
  onSaveFilter,
  onUpdateSavedFilter,
  onDeleteSavedFilter,
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState(null);
  // Which saved filter was applied, as a hint rather than as a fact about the
  // filter: it is what lets Update know which record to overwrite once the
  // filter has been edited and no longer matches any of them.
  const [appliedId, setAppliedId] = useState(null);
  const nameRef = useRef(null);

  const sections = useMemo(
    () => toSections(groups, budgets).filter((section) => section.budgets.length > 0),
    [groups, budgets]
  );

  const active = isFilterActive(filter);
  // Only the folded-away facets are counted on the button: the text and the
  // window are drawn in the row above it, and a count of things already on
  // screen would read as something hidden.
  const foldedCount =
    filter.kinds.length +
    filter.budgetIds.length +
    filter.accountIds.length +
    filter.tags.length +
    (filter.minCents != null ? 1 : 0) +
    (filter.maxCents != null ? 1 : 0);

  const set = (changes) => onChange({ ...filter, ...changes });

  function clear() {
    setAppliedId(null);
    setNaming(false);
    setError(null);
    onChange(EMPTY_FILTER);
  }

  function apply(saved) {
    setError(null);
    setNaming(false);
    setAppliedId(saved.id);
    onChange(saved.filter);
  }

  function save(event) {
    event.preventDefault();
    const result = onSaveFilter(nameRef.current.value);
    // The contract every form here keeps: a refusal leaves the field on what was
    // typed with the reason beside it, and never closes as though it had landed.
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAppliedId(result.id);
    setNaming(false);
    setError(null);
  }

  const appliedTo = savedFilters.find((saved) => saved.id === appliedId) ?? null;
  const edited = appliedTo != null && !sameFilter(appliedTo.filter, filter);

  return (
    <section aria-label="Search and filter" className="mb-4 rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-3 py-2.5">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Search the register</span>
          <input
            type="search"
            value={filter.text}
            onChange={(event) => set({ text: event.target.value })}
            placeholder="Search payee, note, #tag or amount"
            className={boxInput}
          />
        </label>

        <SegmentedControl
          label="How far back the register reaches"
          options={SPAN_OPTIONS}
          value={filter.span}
          onChange={(span) => set({ span })}
        />

        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {foldedCount > 0 ? `Filters (${foldedCount})` : "Filters"}
        </Button>

        {active && (
          <Button variant="outline" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="border-t border-edge px-3 py-3">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <fieldset>
              <legend className={legend}>Direction</legend>
              <div className="flex flex-wrap gap-1.5">
                {KIND_CHIPS.map(({ kind, label }) => (
                  <Chip
                    key={kind}
                    label={label}
                    on={filter.kinds.includes(kind)}
                    onToggle={() => set({ kinds: toggleId(filter.kinds, kind) })}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className={legend}>Amount</legend>
              <div className="flex flex-wrap items-end gap-3">
                {[
                  ["At least", "minCents"],
                  ["At most", "maxCents"],
                ].map(([label, field]) => (
                  <div key={field} className="w-28">
                    <input
                      type="text"
                      inputMode="decimal"
                      // Keyed on the figure in force, so applying a saved filter
                      // re-seeds the box and typing in it does not.
                      key={filter[field] ?? "any"}
                      defaultValue={amountAtRest(filter[field])}
                      aria-label={label}
                      placeholder={label}
                      onFocus={(event) => {
                        event.target.value = amountEditing(filter[field]);
                        event.target.select();
                      }}
                      onBlur={(event) => {
                        const cents = readBound(event.target.value);
                        // Junk is an abandoned edit, not a bound of nothing: the
                        // box goes back to whatever is in force, exactly as a
                        // refused figure does on a register row.
                        if (cents === undefined) {
                          event.target.value = amountAtRest(filter[field]);
                          return;
                        }
                        event.target.value = amountAtRest(cents);
                        if (cents !== filter[field]) set({ [field]: cents });
                      }}
                      className={`${boxInput} text-right font-mono tabular-nums`}
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="sm:col-span-2">
              <legend className={legend}>Accounts</legend>
              <div className="flex flex-wrap gap-1.5">
                {accounts.map((account) => (
                  <Chip
                    key={account.id}
                    label={account.name}
                    on={filter.accountIds.includes(account.id)}
                    onToggle={() => set({ accountIds: toggleId(filter.accountIds, account.id) })}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="sm:col-span-2">
              <legend className={legend}>Categories</legend>
              {/* "No category" is a real answer and not an absence: it is income
                  into the pool, which is most of what a household looks for when
                  it looks for money coming in. */}
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <Chip
                  label="No category — income"
                  on={filter.budgetIds.includes(null)}
                  onToggle={() => set({ budgetIds: toggleId(filter.budgetIds, null) })}
                />
              </div>
              {sections.map((section) => (
                <div key={section.groupId} className="mb-1.5">
                  <div className="mb-1 font-mono text-label uppercase text-chalk-soft/70">
                    {section.name}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {section.budgets.map((budget) => (
                      <Chip
                        key={budget.id}
                        label={budget.name}
                        on={filter.budgetIds.includes(budget.id)}
                        onToggle={() => set({ budgetIds: toggleId(filter.budgetIds, budget.id) })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>

            {tags.length > 0 && (
              <fieldset className="sm:col-span-2">
                {/* Two tags narrow rather than widen — see `matchesFilter` — so
                    the legend says so where the clicking happens. */}
                <legend className={legend}>Tags — a second tag narrows further</legend>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(({ tag, count }) => (
                    <Chip
                      key={tag}
                      label={`${formatTag(tag)} · ${count}`}
                      title={`${count} ${count === 1 ? "entry carries" : "entries carry"} ${formatTag(tag)}`}
                      on={filter.tags.includes(tag)}
                      onToggle={() => set({ tags: toggleId(filter.tags, tag) })}
                    />
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </div>
      )}

      {(savedFilters.length > 0 || active) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-edge px-3 py-2">
          <span className="font-mono text-label uppercase text-chalk-soft">Saved</span>

          {savedFilters.map((saved) => (
            <Chip
              key={saved.id}
              label={saved.name}
              on={sameFilter(saved.filter, filter)}
              onToggle={() => apply(saved)}
              trailing={
                <button
                  type="button"
                  aria-label={`Forget the saved filter "${saved.name}"`}
                  onClick={() => {
                    if (appliedId === saved.id) setAppliedId(null);
                    onDeleteSavedFilter(saved.id);
                  }}
                  className={`${chipBase} ${chipOff} px-1.5 leading-none hover:text-vermilion`}
                >
                  &times;
                </button>
              }
            />
          ))}

          {savedFilters.length === 0 && (
            <span className="font-sans text-row text-chalk-soft">
              Nothing saved yet — name this search and it will be a click away.
            </span>
          )}

          {edited && (
            <Button variant="outline" size="sm" onClick={() => onUpdateSavedFilter(appliedTo.id)}>
              Update “{appliedTo.name}”
            </Button>
          )}

          {active &&
            (naming ? (
              <form onSubmit={save} className="flex flex-wrap items-end gap-2">
                <label className="w-44">
                  <span className="sr-only">Name for this search</span>
                  <input
                    type="text"
                    ref={nameRef}
                    autoFocus
                    aria-label="Name for this search"
                    placeholder="e.g. Costco this year"
                    className={boxInput}
                  />
                </label>
                <Button variant="primary" size="sm" type="submit">
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setNaming(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setNaming(true)}>
                Save this search
              </Button>
            ))}

          {error && (
            <p role="alert" className="font-sans text-row text-vermilion">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
