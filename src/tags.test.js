import {
  hasTag,
  isTag,
  ledgerTags,
  parseTags,
  readTag,
  withTag,
  withoutTag,
} from "./tags";

/**
 * Tags as the arithmetic over strings they are — the pure-function shape, since
 * what is worth pinning here is where a `#` is a tag and where it is
 * punctuation, which React would only be in the way of. That they are
 * *searchable* is `transactionFilter.test.js`', and that a selection can be
 * tagged in one write is `dataModel.test.js`'.
 */

describe("where a # is a tag", () => {
  test("a word after a # at the start of a word, and nothing else", () => {
    expect(parseTags("dinner #holiday with the Shaws")).toEqual(["holiday"]);
    expect(parseTags("#holiday")).toEqual(["holiday"]);
    expect(parseTags("two #a #b")).toEqual(["a", "b"]);
  });

  test("a # in the middle of a word is punctuation", () => {
    // The two cases that forced the word boundary: a language and a URL
    // fragment, both of which would otherwise file a row under a tag nobody
    // typed.
    expect(parseTags("learning C# this year")).toEqual([]);
    expect(parseTags("see https://example.test/page#receipts")).toEqual([]);
  });

  test("a bare # is not an empty tag", () => {
    expect(parseTags("# ")).toEqual([]);
    expect(parseTags("#-")).toEqual([]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });

  test("punctuation inside the word is kept, because a tag is chosen not remembered", () => {
    // Deliberately unlike `searchKey`, which folds punctuation away so that
    // "att" finds AT&T. Two tags a household could reasonably keep apart must
    // not be merged by the fold.
    expect(parseTags("#eating-out")).toEqual(["eating-out"]);
    expect(parseTags("#tax_2026")).toEqual(["tax_2026"]);
    expect(hasTag("#eating-out", "eatingout")).toBe(false);
  });

  test("trailing punctuation is not part of the tag", () => {
    expect(parseTags("paid #holiday, finally")).toEqual(["holiday"]);
    expect(parseTags("#holiday.")).toEqual(["holiday"]);
  });

  test("case folds, and the first spelling is the one shown", () => {
    expect(parseTags("#Holiday and #holiday again")).toEqual(["Holiday"]);
    expect(hasTag("#Holiday", "holiday")).toBe(true);
    expect(hasTag("#holiday", "#Holiday")).toBe(true);
  });
});

describe("writing a tag into a note", () => {
  test("appended to the end, since the note is what is being filed", () => {
    expect(withTag("dinner with the Shaws", "holiday")).toBe("dinner with the Shaws #holiday");
    expect(withTag("", "holiday")).toBe("#holiday");
    // A record with no note at all is the same case as one with an empty note:
    // the tag is the whole of what it now says.
    expect(withTag(null, "holiday")).toBe("#holiday");
    expect(withTag("dinner", "")).toBe("dinner");
  });

  test("a note that already says it is left exactly as it was", () => {
    // What makes tagging a mixed selection safe to do twice: the rows that
    // already read that way are not writes at all.
    expect(withTag("#holiday dinner", "holiday")).toBe("#holiday dinner");
    expect(withTag("#Holiday dinner", "holiday")).toBe("#Holiday dinner");
  });

  test("a typed # is taken either way", () => {
    expect(withTag("dinner", "#holiday")).toBe("dinner #holiday");
    expect(readTag(" #holiday ")).toBe("holiday");
  });

  test("removing takes the whitespace that joined it, and leaves nothing behind", () => {
    expect(withoutTag("dinner #holiday with the Shaws", "holiday")).toBe(
      "dinner with the Shaws"
    );
    expect(withoutTag("#holiday", "holiday")).toBe("");
    expect(withoutTag("#Holiday twice #holiday", "holiday")).toBe("twice");
  });

  test("a note without the tag is not touched at all", () => {
    // Not even tidied: in a bulk untag this is every row that was not tagged,
    // and collapsing their whitespace would be a write nobody asked for.
    expect(withoutTag("dinner  with   the Shaws", "holiday")).toBe("dinner  with   the Shaws");
  });

  test("what can be written as a tag at all", () => {
    expect(isTag("holiday")).toBe(true);
    expect(isTag("#holiday")).toBe(true);
    expect(isTag("eating-out")).toBe(true);
    expect(isTag("two words")).toBe(false);
    expect(isTag("#")).toBe(false);
    expect(isTag("")).toBe(false);
  });
});

test("the ledger's tags are counted, commonest first", () => {
  const tags = ledgerTags([
    { description: "a #holiday" },
    { description: "b #Holiday #gift" },
    { description: "c #gift" },
    { description: "d #holiday" },
    { description: "e" },
    { description: null },
  ]);

  // Counted by the folded tag and shown in the spelling first seen; ties go
  // alphabetically so the order is stable rather than a fact about which row
  // was logged first.
  expect(tags).toEqual([
    { tag: "holiday", count: 3 },
    { tag: "gift", count: 2 },
  ]);
});
