import { isSplit, TRANSACTION_KINDS } from "./contexts/TransactionsContext";
import { searchKey } from "./payeeSearch";
import { hasTag, tagKey } from "./tags";
import { amountEditing, toPeriod } from "./utils";

/**
 * Which rows of the ledger are on screen, as arithmetic over records.
 *
 * A pure module with no design opinion in it — no colour, no layout, no wording,
 * no ARIA — the way `src/payeeSearch.js` and `src/chartAxis.js` are.
 * `TransactionFilterBar` owns what the control *looks* like and what each facet
 * is called; what is here is only which rows answer a filter, which is the half
 * worth testing as a function and the half two things have to agree about: the
 * register, and a saved filter read back out of storage months later.
 *
 * **A filter is a plain JSON object, and that is the whole reason it can be
 * saved.** Nothing in it is a function, a RegExp or an id to be resolved at
 * build time, so the thing the page holds in state and the thing
 * `SavedFiltersContext` writes to storage are the same object, and `readFilter`
 * below is both the normaliser for one typed into the bar and the migration for
 * one read off disk. A filter made of predicates would need a second,
 * serialisable description of itself, and the two would drift.
 *
 * **Every facet is a narrowing, and an empty facet is "anything".** That is what
 * makes the empty filter the register's existing behaviour rather than a special
 * case the page has to branch on: no text, no kinds, no categories, no accounts,
 * no tags, no bounds, and the month on screen. Within one facet the entries are
 * **any of** — three categories ticked means rows in any of the three — and
 * across facets they are **all of**, because that is what a reader means by
 * adding a second condition. Tags are the one exception and go the other way:
 * see `tags` below.
 */

/**
 * How far back the register reaches.
 *
 * Two answers and deliberately not a date range. The register's anchor is the
 * month on screen — that is what its footing totals, what its undated band sits
 * under, and what the to-be-assigned bar above it is read at — so the only
 * window a *search* needs beyond it is "all of it", which is what finding a
 * receipt from the spring actually asks for. A custom from/to window is the
 * reports page's control and lives there with the rest of the figures that are
 * read over a span rather than at a month.
 */
export const FILTER_SPANS = { MONTH: "month", ALL: "all" };

const SPAN_VALUES = Object.values(FILTER_SPANS);
const KIND_VALUES = Object.values(TRANSACTION_KINDS);

/**
 * No filter at all: the month on screen, every row in it.
 *
 * Frozen, because it is the page's initial state and a default that could be
 * mutated by whoever held it would be a filter that remembered the last thing
 * typed into the bar.
 */
export const EMPTY_FILTER = Object.freeze({
  text: "",
  span: FILTER_SPANS.MONTH,
  kinds: Object.freeze([]),
  // **`null` in either list is a real answer**, not an absence: it means the rows
  // that name no category (income into the pool) and the rows that name no
  // account (the legacy ones, and anything cut loose by a deleted account). A
  // sentinel string would have to be a string no uuid could be, and null already
  // is exactly what those records hold.
  budgetIds: Object.freeze([]),
  accountIds: Object.freeze([]),
  tags: Object.freeze([]),
  minCents: null,
  maxCents: null,
});

const readList = (value, keep) =>
  Array.isArray(value) ? [...new Set(value.filter(keep))] : [];

const readAmount = (value) =>
  Number.isInteger(value) && value >= 0 ? value : null;

/**
 * A filter as this module holds them, whatever shape it arrived in.
 *
 * One function for two jobs on purpose. It normalises what the bar hands over —
 * so the page never holds a half-filter with a missing key — and it is the
 * migration `SavedFiltersContext` runs over a stored one, keyed on nothing but
 * the values it finds, which is what makes it safe to re-run and safe against a
 * filter saved by a build that had a facet this one does not.
 *
 * An unreadable facet becomes the empty one rather than refusing the whole
 * filter: a saved search is a convenience, and dropping the condition nobody can
 * read shows *more* rows than were asked for rather than fewer. Nothing here can
 * change a figure in the books.
 */
export function readFilter(stored) {
  const filter = stored && typeof stored === "object" ? stored : {};
  return {
    text: typeof filter.text === "string" ? filter.text.trim() : "",
    span: SPAN_VALUES.includes(filter.span) ? filter.span : FILTER_SPANS.MONTH,
    kinds: readList(filter.kinds, (kind) => KIND_VALUES.includes(kind)),
    budgetIds: readList(filter.budgetIds, (id) => id === null || typeof id === "string"),
    accountIds: readList(filter.accountIds, (id) => id === null || typeof id === "string"),
    // Folded on the way in, because a tag's identity is its folded form and a
    // filter holding both "#Holiday" and "#holiday" would be asking for rows
    // carrying one tag twice.
    tags: readList(
      Array.isArray(filter.tags) ? filter.tags.map(tagKey) : null,
      (tag) => typeof tag === "string" && tag !== ""
    ),
    minCents: readAmount(filter.minCents),
    maxCents: readAmount(filter.maxCents),
  };
}

/** Whether anything is in force — which is what decides if "Clear" has a job. */
export function isFilterActive(filter) {
  return activeFilterCount(filter) > 0;
}

/**
 * How many conditions are in force, for a control that has to say so without
 * drawing all of them.
 *
 * The span counts as one. It is the condition a reader is most likely to forget
 * they set and the one that most changes what they are looking at — a register
 * showing every month it has ever held, under a month stepper that is no longer
 * deciding anything, has to say that somewhere.
 */
export function activeFilterCount(filter) {
  const active = readFilter(filter);
  return (
    (active.text ? 1 : 0) +
    (active.span === FILTER_SPANS.MONTH ? 0 : 1) +
    (active.kinds.length ? 1 : 0) +
    (active.budgetIds.length ? 1 : 0) +
    (active.accountIds.length ? 1 : 0) +
    active.tags.length +
    (active.minCents != null ? 1 : 0) +
    (active.maxCents != null ? 1 : 0)
  );
}

/** Two filters that say the same thing, however they were written. */
export function sameFilter(a, b) {
  const key = (filter) => {
    const read = readFilter(filter);
    return JSON.stringify({
      ...read,
      kinds: [...read.kinds].sort(),
      // `null` sorts with the strings only if it is compared as one.
      budgetIds: [...read.budgetIds].map(String).sort(),
      accountIds: [...read.accountIds].map(String).sort(),
      tags: [...read.tags].sort(),
    });
  };
  return key(a) === key(b);
}

/**
 * The text a row can be found by, folded.
 *
 * Three things, because they are the three a household says out loud about a
 * row: who it was with, what the note says, and how much it was. The **amount**
 * is in there because "find the ninety-eight dollar one" is how a statement is
 * reconciled, and it is folded through the same key as the words — so "98.40",
 * "$98.40" and "9840" all find it, and nothing has to decide whether what was
 * typed was a figure or a word before searching.
 *
 * `searchKey` is `payeeSearch`'s own folding, reused rather than reimplemented:
 * a query that finds "Wal-Mart" in the entry form has to find its rows here, and
 * two foldings would be two answers to one question. It drops the `#` with the
 * rest of the punctuation, which costs nothing — a typed "#holiday" still finds
 * the rows whose note carries it, and the tag facet is what asks the question
 * precisely.
 *
 * The category and the account are deliberately **not** in it. Each has a facet
 * of its own that answers exactly, and folding their names into the same text
 * box would mean a search for "fuel" quietly returning every row in a category
 * called Fuel alongside the one whose note mentions it — a wider answer than
 * what was asked, with nothing on screen to say which rule matched.
 */
function haystack(transaction, payeeById) {
  const payee = payeeById?.get(transaction.payeeId)?.name ?? "";
  return searchKey(`${payee} ${transaction.description ?? ""} ${amountEditing(transaction.amountCents)}`);
}

/**
 * Whether one row answers `filter`.
 *
 * `context` carries what a record cannot answer about itself: `payeeById` for
 * the name behind `payeeId`, and `period` for the month the span is measured
 * against. Both are the caller's, so this stays a function of its arguments.
 *
 * Checked cheapest first — a span or a kind is a comparison, the text is a fold
 * of three fields — because this runs once per row of the whole ledger on every
 * keystroke in the search box.
 */
export function matchesFilter(transaction, filter, { payeeById, period } = {}) {
  const {
    text,
    span,
    kinds,
    budgetIds,
    accountIds,
    tags,
    minCents,
    maxCents,
  } = readFilter(filter);

  // **The month is a bound on dated rows only.** An undated record belongs to no
  // month, so a register that dropped it from every one of them would put money
  // on the books with nowhere to correct it — the same rule the undated band
  // below the register already keeps.
  if (span === FILTER_SPANS.MONTH) {
    const at = toPeriod(transaction.date);
    if (at != null && at !== period) return false;
  }

  if (kinds.length && !kinds.includes(transaction.kind)) return false;

  if (minCents != null && transaction.amountCents < minCents) return false;
  if (maxCents != null && transaction.amountCents > maxCents) return false;

  if (accountIds.length) {
    // Either end, which is `getAccountTransactions`' own rule: a transfer *into*
    // an account is as much that account's business as one out of it. The far end
    // is only consulted where there is one — `toAccountId` is null on every
    // record that is not a transfer, and a filter asking for the detached rows
    // would otherwise match all of them.
    const from = transaction.accountId ?? null;
    const to = transaction.toAccountId ?? null;
    if (!accountIds.includes(from) && !(to != null && accountIds.includes(to))) return false;
  }

  if (budgetIds.length) {
    // A divided receipt is in every category it names, and one part is enough:
    // the row is a movement of money that touched that envelope, which is the
    // same reading `getBudgetTransactions` takes.
    const filed = isSplit(transaction)
      ? transaction.splits.some((part) => budgetIds.includes(part.budgetId ?? null))
      : budgetIds.includes(transaction.budgetId ?? null);
    if (!filed) return false;
  }

  // **Tags are the one facet that is "all of" rather than "any of".** A second
  // tag on a search is somebody narrowing — "the holiday spending that was also
  // a gift" — and a tag list that widened would make the second click undo the
  // first.
  if (tags.length && !tags.every((tag) => hasTag(transaction.description, tag))) return false;

  if (text) {
    const query = searchKey(text);
    if (query && !haystack(transaction, payeeById).includes(query)) return false;
  }

  return true;
}

/** The rows of `transactions` that answer `filter`, in the order handed over. */
export function filterTransactions(transactions, filter, context) {
  const read = readFilter(filter);
  return (transactions ?? []).filter((transaction) => matchesFilter(transaction, read, context));
}
