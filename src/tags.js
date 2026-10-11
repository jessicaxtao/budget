/**
 * Tags, as a household already writes them: a word with a `#` in front of it,
 * inside the note on a row.
 *
 * A pure module with no design opinion in it — no colour, no layout, no ARIA —
 * the way `src/payeeSearch.js` and `src/chartAxis.js` are.
 *
 * **A tag is not a field.** It is a reading of `description`, derived every time
 * it is asked for, exactly as a period is derived from a date and a gift's year
 * from its transaction. A `tags: []` array beside the note would be a second copy
 * of something the note already says, and the day the two disagreed there would
 * be no way to tell which was true — so "#holiday" typed into a note *is* the
 * tag, and deleting the word is what removes it. It also means every note ever
 * written already carries whatever tags it happens to contain, with no migration
 * and nothing to backfill.
 *
 * What that costs is that tagging is text editing, which is why `withTag` and
 * `withoutTag` are here: the bulk bar has to be able to tag forty rows without
 * the user retyping forty notes, and "append a word unless it is already there"
 * is the sort of string arithmetic that must have exactly one implementation.
 *
 * **Folding is case and nothing else**, which is where this parts company with
 * `searchKey` in `payeeSearch.js`. That one drops every character that is not a
 * letter or a digit, so "AT&T" and "ATT" find each other — the right answer for
 * a name somebody half-remembers. A tag is chosen rather than remembered, and its
 * punctuation is load-bearing: "#eating-out" and "#eatingout" are two tags a
 * household could reasonably keep apart, and a fold that merged them would
 * silently file one under the other.
 */

/**
 * `#` at the start of a word, then the tag itself.
 *
 * The boundary is the point. Without it "C#" is a tag called "" and
 * "https://x/#top" is a tag called "top", so a `#` is only a tag where a word
 * could begin — the start of the note or after whitespace. The first character
 * after it has to be a letter or a digit, so a bare "#" and a stray "#-" are
 * punctuation rather than an empty tag; after that a hyphen or an underscore is
 * part of the word, which is how "#eating-out" stays one tag.
 */
const TAG = /(^|\s)#([a-z0-9][a-z0-9_-]*)/gi;

/** A tag as it is compared: lowercase, and nothing else. See the note above. */
export const tagKey = (tag) => String(tag ?? "").toLowerCase();

/**
 * Whether `value` is something that could be written as a tag at all — the
 * word, with or without the `#` somebody typed in front of it.
 *
 * Exported because `withTag` cannot refuse on its own behalf: it returns text,
 * not a result, so a two-word "tag" would be appended as "#a b" and read back
 * as the tag "a". The caller asks this first and refuses with a message, which
 * is the `{ ok, error }` rule applied one level up.
 */
export const isTag = (value) => /^#?[a-z0-9][a-z0-9_-]*$/i.test(String(value ?? "").trim());

/** A typed tag without the `#` it may have been written with. */
export const readTag = (value) => String(value ?? "").trim().replace(/^#/, "");

/** A tag as it is shown — with the `#` back on, since that is what was typed. */
export const formatTag = (tag) => `#${tag}`;

/**
 * The tags written in one piece of text, as they were written, in the order
 * they appear and each one once.
 *
 * Kept in the case they were typed in rather than folded, because the tag list a
 * household sees should read the way they write: somebody who types "#Holiday"
 * is shown "#Holiday". Two spellings of one tag collapse to the first seen, on
 * the same rule that decides they are one tag at all.
 */
export function parseTags(text) {
  if (typeof text !== "string" || !text.includes("#")) return [];

  const found = [];
  const seen = new Set();
  for (const [, , tag] of text.matchAll(TAG)) {
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(tag);
  }
  return found;
}

/** Whether `text` carries `tag`, folded — written with or without its `#`. */
export function hasTag(text, tag) {
  const key = tagKey(readTag(tag));
  return parseTags(text).some((written) => tagKey(written) === key);
}

/**
 * `text` with `tag` on it: unchanged where it is already there, and appended
 * where it is not.
 *
 * Appended rather than prepended, because the note is a remark and the tags are
 * marks on the end of it — and because a note that reads "#holiday dinner with
 * the Shaws" puts the filing in front of the thing being filed.
 */
export function withTag(text, tag) {
  const written = readTag(tag);
  if (!written || hasTag(text, written)) return typeof text === "string" ? text : "";
  const note = typeof text === "string" ? text.trim() : "";
  return note ? `${note} ${formatTag(written)}` : formatTag(written);
}

/**
 * `text` with `tag` taken off it, however many times it was written and
 * whichever case it was written in.
 *
 * The whitespace that joined it goes too, or removing the tag in the middle of a
 * note would leave a double space behind — and removing the only word in a note
 * leaves the note empty, which is what an empty note has always meant.
 *
 * A note that does not carry the tag comes back **untouched**, rather than
 * tidied: collapsing its whitespace would be a write the user did not ask for,
 * and in a bulk action it would be a write on every row that was not tagged.
 */
export function withoutTag(text, tag) {
  if (typeof text !== "string" || !text) return "";
  const key = tagKey(readTag(tag));
  if (!hasTag(text, key)) return text;
  return text
    .replace(TAG, (match, lead, written) => (tagKey(written) === key ? "" : match))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every tag the ledger carries, with how many rows carry it — commonest first,
 * then alphabetically.
 *
 * What a tag picker offers. Count first because a household's three working tags
 * and its one typo are not equally worth a click, and alphabetically after that
 * so the order is stable rather than dependent on which row was logged first.
 */
export function ledgerTags(transactions) {
  const counts = new Map();
  for (const transaction of transactions ?? []) {
    for (const tag of parseTags(transaction?.description)) {
      const key = tagKey(tag);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}
