/**
 * Finding a payee by what somebody has typed so far, as arithmetic over strings.
 *
 * A pure module with no design opinion in it — no colour, no layout, no wording,
 * no ARIA — the way `src/paySchedule.js` and `src/chartAxis.js` are. What stays
 * in `PayeeField` is what the *control* means: when the list opens, what the
 * keyboard does, how a match is drawn. What is here is only which payees match
 * and in what order, which is the half worth testing as a function.
 *
 * **Matching folds punctuation; identity does not.** `normalizePayeeName` in
 * `PayeesContext` is the payee's identity and the only thing the clash check
 * reads — it lowercases and collapses whitespace and stops there, so "Costco "
 * and "costco" are one payee while "AT&T" and "ATT" are allowed to be two. That
 * is the right answer for identity and the wrong one for searching: somebody
 * typing "att" is looking for AT&T, and somebody typing "joes" is looking for
 * Joe's Pizza. So matching has a normaliser of its own, and it is deliberately
 * more forgiving than the one that decides what a duplicate is.
 *
 * Two forms of a name, because one cannot answer both questions:
 *
 *   "AT&T Wireless"  ->  key "attwireless"      words ["at", "t", "wireless"]
 *   "Wal-Mart"       ->  key "walmart"          words ["wal", "mart"]
 *   "Joe's Pizza"    ->  key "joespizza"        words ["joe", "s", "pizza"]
 *
 * The key is what "does this contain what was typed" is asked of, because
 * dropping the separators outright is what lets "walmart" find "Wal-Mart" and
 * "joes" find "Joe's". The words exist only to rank a match that starts a word
 * above one that lands in the middle of a syllable — "pizza" should find Joe's
 * Pizza ahead of a payee called "Pizzazz Salon" only insofar as it begins a word
 * there, and the key alone cannot tell the difference.
 */

/**
 * A name as matching reads it: lowercase, and everything that is not a letter or
 * a digit taken out — spaces included.
 *
 * Exported because the hosts need it for one further question the ranking cannot
 * answer for them: whether what was typed is *already* a payee, which is what
 * decides between taking an existing record and creating a new one.
 */
export function searchKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** The same name as its words, for the word-boundary rank above. */
function searchWords(name) {
  return String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Lower sorts first. Written out rather than inlined as numbers so the order the
// list comes back in is readable as the order it is meant to be read in.
const RANK = { EXACT: 0, PREFIX: 1, WORD: 2, SUBSTRING: 3 };

/** How well one payee answers `query`, or null for one that does not. */
function rankOf(payee, query) {
  const key = searchKey(payee.name);
  if (!key.includes(query)) return null;
  if (key === query) return RANK.EXACT;
  if (key.startsWith(query)) return RANK.PREFIX;
  if (searchWords(payee.name).some((word) => word.startsWith(query))) return RANK.WORD;
  return RANK.SUBSTRING;
}

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The payees `query` might mean, best first.
 *
 * Returns `{ matches, moreCount }` rather than a bare list: the control has to
 * be able to say what it is *not* showing, and a household with sixty payees
 * typing "a" would otherwise get a silently truncated list with no sign it was
 * truncated. `moreCount` is how many further payees matched beyond the cap.
 *
 * **An empty query is not "no matches" — it is "anything".** The list opens on
 * whatever order it was handed (see `orderPayeesByUse`), because a field that
 * showed nothing until the first keystroke would hide the fact that there is a
 * list at all, and the payee somebody wants is usually one of the last few they
 * used.
 */
export function matchPayees(payees, query, { limit = 8 } = {}) {
  const all = Array.isArray(payees) ? payees : [];
  const key = searchKey(query);

  if (!key) {
    return { matches: all.slice(0, limit), moreCount: Math.max(0, all.length - limit) };
  }

  const ranked = [];
  for (const payee of all) {
    const rank = rankOf(payee, key);
    if (rank != null) ranked.push({ payee, rank });
  }

  ranked.sort((a, b) => a.rank - b.rank || byName(a.payee, b.payee));

  return {
    matches: ranked.slice(0, limit).map((entry) => entry.payee),
    moreCount: Math.max(0, ranked.length - limit),
  };
}

/**
 * The payee list in the order a field should offer it before anything is typed:
 * most recently transacted with first, then the ones never used, by name.
 *
 * Recency comes off the ledger rather than off a `lastUsedAt` field on the payee,
 * and that is deliberate — a stored timestamp would be a second copy of
 * something the transactions already say, and the day the two disagreed there
 * would be no way to tell which was true. It is the same reason a donation record
 * carries no amount and a period is derived rather than stored.
 *
 * Undated records sort last among the used ones: they are real transactions with
 * nothing to place them by, so they are evidence that a payee has been used and
 * no evidence at all about when.
 */
export function orderPayeesByUse(payees, transactions) {
  const latest = new Map();
  for (const transaction of transactions ?? []) {
    if (!transaction?.payeeId) continue;
    const at = transaction.date ?? "";
    const known = latest.get(transaction.payeeId);
    if (known == null || at > known) latest.set(transaction.payeeId, at);
  }

  const used = [];
  const unused = [];
  for (const payee of payees ?? []) {
    if (latest.has(payee.id)) used.push(payee);
    else unused.push(payee);
  }

  used.sort((a, b) => latest.get(b.id).localeCompare(latest.get(a.id)) || byName(a, b));
  unused.sort(byName);

  return [...used, ...unused];
}
