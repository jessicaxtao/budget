import {
  clearScope,
  getStorageScope,
  GUEST_SCOPE,
  hasStoredBooks,
  isDesktop,
  localScope,
  LEGACY_KEYS,
  PENDING_SYNC_KEY,
  readKey,
  removeKey,
  resetStorageBackend,
  replaceScope,
  restoreScope,
  scopedKey,
  setStorageScope,
  snapshotScope,
  STORE_KEYS,
  writeKey,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
});

afterEach(() => {
  setStorageScope(null);
  // Any case that staged a desktop bridge has to put the web backend back, or
  // every test after it reads a Map instead of localStorage.
  delete window.__hbDesktop;
  resetStorageBackend();
});

describe("scoping", () => {
  // The unscoped case is not a fallback, it is the app's other supported mode:
  // an unconfigured build, a signed-out session, and every store test in the
  // suite all read and write bare keys.
  test("an unscoped key is the bare key", () => {
    expect(scopedKey("budgets")).toBe("budgets");
  });

  test("a scoped key carries the user", () => {
    setStorageScope("user-1");
    expect(scopedKey("budgets")).toBe("hb:user-1:budgets");
  });

  test("two accounts on one browser cannot read each other's books", () => {
    setStorageScope("user-1");
    writeKey("budgets", [{ id: "mine" }]);

    setStorageScope("user-2");
    expect(readKey("budgets")).toBeUndefined();

    writeKey("budgets", [{ id: "theirs" }]);
    setStorageScope("user-1");
    expect(readKey("budgets")).toEqual([{ id: "mine" }]);
  });

  test("a scoped account cannot read the browser's own unscoped books", () => {
    writeKey("budgets", [{ id: "local" }]);
    setStorageScope("user-1");
    expect(readKey("budgets")).toBeUndefined();
  });
});

describe("reading", () => {
  // Distinct from a stored null, which is what lets an import tell "never
  // written" from "written as nothing" and so avoid planting empty documents
  // over real ones.
  test("an absent key reads as undefined, not null", () => {
    expect(readKey("budgets")).toBeUndefined();
  });

  test("a corrupt document is dropped so the failure does not repeat", () => {
    localStorage.setItem("budgets", "{not json");
    expect(readKey("budgets")).toBeUndefined();
    expect(localStorage.getItem("budgets")).toBeNull();
  });

  test("a throwing localStorage does not throw out of readKey", () => {
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });
    expect(readKey("budgets")).toBeUndefined();
    spy.mockRestore();
  });

  test("a throwing localStorage reports a failed write rather than throwing", () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(writeKey("budgets", [])).toBe(false);
    spy.mockRestore();
  });
});

describe("hasStoredBooks", () => {
  test("an untouched browser has none", () => {
    expect(hasStoredBooks(null)).toBe(false);
  });

  // Every store writes its empty default on first render whether or not the
  // user has done anything, so counting `[]` would report a freshly-opened
  // browser as having books to import.
  test("empty documents are not books", () => {
    for (const key of STORE_KEYS) writeKey(key, []);
    expect(hasStoredBooks(null)).toBe(false);
  });

  test("a non-empty document is", () => {
    writeKey("budgets", [{ id: "b1" }]);
    expect(hasStoredBooks(null)).toBe(true);
  });

  // A browser that never ran the current build has its ledger only in the old
  // keys; missing them would carry up an empty account.
  test("a legacy-only ledger counts", () => {
    writeKey("expenses", [{ id: "e1", amount: 12 }]);
    expect(hasStoredBooks(null)).toBe(true);
  });

  test("it asks the scope it was given, not the one in force", () => {
    setStorageScope("user-1");
    writeKey("budgets", [{ id: "b1" }]);

    expect(hasStoredBooks("user-1")).toBe(true);
    expect(hasStoredBooks(null)).toBe(false);
    expect(hasStoredBooks("user-2")).toBe(false);
  });

  test("the scope in force is restored afterwards", () => {
    setStorageScope("user-1");
    hasStoredBooks(null);
    expect(getStorageScope()).toBe("user-1");
  });
});

describe("moving books between scopes", () => {
  test("a snapshot carries the current keys and the legacy ones", () => {
    writeKey("budgets", [{ id: "b1" }]);
    writeKey("expenses", [{ id: "e1" }]);

    const snapshot = snapshotScope(null);
    expect(snapshot.budgets).toEqual([{ id: "b1" }]);
    expect(snapshot.expenses).toEqual([{ id: "e1" }]);
  });

  test("keys with nothing stored are absent from a snapshot", () => {
    writeKey("budgets", [{ id: "b1" }]);
    const snapshot = snapshotScope(null);
    expect("transactions" in snapshot).toBe(false);
  });

  // The import, end to end: what this browser held before accounts existed
  // becomes what the account holds, and the browser's own copy is untouched.
  test("restoring a snapshot into an account leaves the source alone", () => {
    writeKey("budgets", [{ id: "b1" }]);
    writeKey("expenses", [{ id: "e1" }]);

    restoreScope("user-1", snapshotScope(null));

    setStorageScope("user-1");
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
    expect(readKey("expenses")).toEqual([{ id: "e1" }]);

    setStorageScope(null);
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
  });
});

describe("replaceScope", () => {
  /**
   * The difference from `restoreScope`, and the difference between a restore and
   * a merge: a household that had savings goals and restores a backup taken
   * before it had any must not keep them, or the books are neither the file's nor
   * their own.
   */
  test("a key the snapshot does not name is emptied", () => {
    writeKey("transactions", [{ id: "t1" }]);
    writeKey("savingsGoals", [{ id: "g1" }]);

    replaceScope(null, { transactions: [{ id: "t9" }] });

    expect(readKey("transactions")).toEqual([{ id: "t9" }]);
    expect(readKey("savingsGoals")).toBeUndefined();
  });

  test("restoreScope leaves that same key alone, which is why both exist", () => {
    writeKey("savingsGoals", [{ id: "g1" }]);
    restoreScope(null, { transactions: [{ id: "t9" }] });
    expect(readKey("savingsGoals")).toEqual([{ id: "g1" }]);
  });

  // It runs unscoped, which `clearScope` refuses to do — and unscoped is the
  // case a local household restores in.
  test("it works unscoped, and leaves another scope's books alone", () => {
    setStorageScope("user-1");
    writeKey("transactions", [{ id: "theirs" }]);
    setStorageScope(null);
    writeKey("transactions", [{ id: "ours" }]);

    replaceScope(null, { transactions: [{ id: "restored" }] });

    expect(readKey("transactions")).toEqual([{ id: "restored" }]);
    setStorageScope("user-1");
    expect(readKey("transactions")).toEqual([{ id: "theirs" }]);
  });

  // Neither is a document, and one of them records a choice already made.
  test("it keeps the outbox and the import decision", () => {
    writeKey(PENDING_SYNC_KEY, { budgets: [] });
    writeKey("importDecision", { at: "2026-01-01" });

    replaceScope(null, { transactions: [{ id: "t9" }] });

    expect(readKey(PENDING_SYNC_KEY)).toEqual({ budgets: [] });
    expect(readKey("importDecision")).toEqual({ at: "2026-01-01" });
  });
});

describe("clearScope", () => {
  // The reason the cache is namespaced at all: the books have to leave the
  // browser with the session, or the next person to open the app reads the last
  // one's ledger out of the cache before any gate can stop them.
  test("sign-out takes the account's books out of the browser", () => {
    restoreScope("user-1", { budgets: [{ id: "b1" }], transactions: [{ id: "t1" }] });
    clearScope("user-1");

    setStorageScope("user-1");
    expect(readKey("budgets")).toBeUndefined();
    expect(readKey("transactions")).toBeUndefined();
  });

  test("it never touches the browser's own unscoped books", () => {
    writeKey("budgets", [{ id: "local" }]);
    restoreScope("user-1", { budgets: [{ id: "theirs" }] });

    clearScope("user-1");
    expect(readKey("budgets")).toEqual([{ id: "local" }]);
  });

  test("it refuses to run unscoped, which would wipe the local books", () => {
    writeKey("budgets", [{ id: "local" }]);
    clearScope(null);
    expect(readKey("budgets")).toEqual([{ id: "local" }]);
  });

  /**
   * The outbox is not one of the books, which is why it is absent from
   * STORE_KEYS — but it holds a *copy* of them, so leaving it behind defeats the
   * whole point of clearing the scope. And what it holds is the most recent
   * edits, which is the worst slice to leave in a browser someone else opens.
   *
   * Pinned here rather than left to the reader of `clearScope`, because the way
   * this regresses is silent: the books look gone, and only devtools disagrees.
   */
  test("sign-out takes the unsent queue too, not just the books", () => {
    setStorageScope("user-1");
    writeKey(PENDING_SYNC_KEY, {
      transactions: [{ id: "t2", amountCents: 999999, description: "Unsent salary" }],
    });
    setStorageScope(null);

    clearScope("user-1");

    setStorageScope("user-1");
    expect(readKey(PENDING_SYNC_KEY)).toBeUndefined();
  });

  // Not content, and dropping it would re-offer the import to someone who
  // already answered "start fresh" on an account that is still empty.
  test("it keeps the import decision, which holds no book content", () => {
    setStorageScope("user-1");
    writeKey("importDecision", { at: "2026-09-26T00:00:00.000Z" });
    setStorageScope(null);

    clearScope("user-1");

    setStorageScope("user-1");
    expect(readKey("importDecision")).toEqual({ at: "2026-09-26T00:00:00.000Z" });
  });
});

describe("the key list", () => {
  /**
   * Adding a store means adding its key to STORE_KEYS, or it lives in this
   * browser and never reaches the server — a store that silently fails to
   * persist, which is the one failure this list exists to prevent.
   *
   * Read off the contexts rather than restated here, because a hand-kept copy
   * of a list is exactly as easy to forget as the list itself. This is the only
   * test in the suite that reads source: nothing else can catch a store added
   * without a key, since the app works perfectly until the user opens it
   * somewhere else.
   */
  test("every key a store writes is listed", () => {
    const fs = require("fs");
    const path = require("path");

    const dir = path.join(__dirname, "contexts");
    const used = new Set();

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const [, key] of source.matchAll(/useSyncedState\(\s*"([^"]+)"/g)) {
        used.add(key);
      }
    }

    expect(used.size).toBeGreaterThan(0);
    expect([...used].sort()).toEqual([...new Set(STORE_KEYS)].sort());
  });

  test("no key is both current and legacy", () => {
    expect(STORE_KEYS.filter((key) => LEGACY_KEYS.includes(key))).toEqual([]);
  });

  /**
   * Every store persists on mount and `SyncContext` has already written the same
   * fourteen documents from the server's copy, so without this a signed-in load
   * writes all of them twice — a redundant `setItem` other tabs re-parse on the
   * web, and a redundant trip to the disk in the desktop shell.
   */
  test("writing what is already stored is not a write", () => {
    writeKey("budgets", [{ id: "b1" }]);

    const setItem = jest.spyOn(Storage.prototype, "setItem");
    expect(writeKey("budgets", [{ id: "b1" }])).toBe(true);
    expect(setItem).not.toHaveBeenCalled();

    expect(writeKey("budgets", [{ id: "b2" }])).toBe(true);
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
  });

  test("an unreadable cache is a reason to write, not a reason to stop", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });

    expect(writeKey("budgets", [{ id: "b1" }])).toBe(true);
    getItem.mockRestore();
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
  });

  test("removeKey clears the scoped entry", () => {
    setStorageScope("user-1");
    writeKey("budgets", [{ id: "b1" }]);
    removeKey("budgets");
    expect(readKey("budgets")).toBeUndefined();
  });
});


/**
 * The desktop shell's file, staged as a bridge.
 *
 * The real one is `electron/preload.js` handing the parsed file across before
 * the bundle evaluates. What matters to this module is only the shape of it, so
 * the fake is the shape and a record of what was asked of it — which is how the
 * write path can be checked without a disk.
 */
function stageDesktop(snapshot = {}) {
  const writes = [];
  const removes = [];
  window.__hbDesktop = {
    snapshot,
    write: (key, value) => writes.push([key, value]),
    remove: (key) => removes.push(key),
  };
  resetStorageBackend();
  return { writes, removes };
}

describe("where local mode lives", () => {
  /**
   * The two builds answer this differently, and the asymmetry is the design.
   * A browser is shared; a machine somebody installed the app on is not.
   */
  test("a browser keeps it apart from its own pre-account books", () => {
    expect(localScope()).toBe(GUEST_SCOPE);
  });

  test("the desktop shell is unscoped, because there the bare keys are the books", () => {
    stageDesktop();
    expect(localScope()).toBe(null);
  });

  test("the two cannot read each other", () => {
    setStorageScope(GUEST_SCOPE);
    writeKey("budgets", [{ id: "guest" }]);
    setStorageScope(null);
    expect(readKey("budgets")).toBeUndefined();
  });
});

describe("the desktop backend", () => {
  test("the shell is detected off the bridge, and is absent by default", () => {
    expect(isDesktop()).toBe(false);
    stageDesktop();
    expect(isDesktop()).toBe(true);
  });

  /**
   * The whole reason the seam is cut at this level. Four store initialisers read
   * storage synchronously to build their lazy defaults, before the first paint —
   * so a read that had to wait for a disk would mean rewriting all four.
   */
  test("the file is readable synchronously, with no promise anywhere", () => {
    stageDesktop({ budgets: [{ id: "b1" }] });
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
  });

  test("a key the file does not hold reads as absent, not as null", () => {
    stageDesktop({ budgets: [] });
    expect(readKey("transactions")).toBeUndefined();
  });

  test("a write reaches the bridge and is readable back at once", () => {
    const { writes } = stageDesktop();

    expect(writeKey("budgets", [{ id: "b1" }])).toBe(true);
    expect(readKey("budgets")).toEqual([{ id: "b1" }]);
    expect(writes).toEqual([["budgets", JSON.stringify([{ id: "b1" }])]]);
  });

  // localStorage is where the session lives and where the web build keeps
  // everything; a desktop read that fell through to it would mix the two.
  test("it does not read or write localStorage", () => {
    stageDesktop();
    localStorage.setItem("budgets", JSON.stringify([{ id: "fromTheBrowser" }]));

    expect(readKey("budgets")).toBeUndefined();

    writeKey("budgets", [{ id: "fromTheFile" }]);
    expect(JSON.parse(localStorage.getItem("budgets"))).toEqual([{ id: "fromTheBrowser" }]);
  });

  test("a remove reaches the bridge too", () => {
    const { removes } = stageDesktop({ budgets: [{ id: "b1" }] });

    removeKey("budgets");
    expect(readKey("budgets")).toBeUndefined();
    expect(removes).toEqual(["budgets"]);
  });

  // The cache holds strings rather than the parsed objects the file gave, so
  // two reads cannot hand back one object for a store to mutate in place.
  test("two reads of one key are not the same object", () => {
    stageDesktop({ budgets: [{ id: "b1" }] });
    expect(readKey("budgets")).not.toBe(readKey("budgets"));
  });

  test("a bridge that throws reports a failed write rather than throwing out", () => {
    stageDesktop();
    window.__hbDesktop.write = () => {
      throw new Error("disk full");
    };
    resetStorageBackend();

    expect(writeKey("budgets", [{ id: "b1" }])).toBe(false);
  });

  // Everything above the backend is written in terms of keys, so the scoping,
  // the snapshot pair and the sign-out clear are all unchanged by the medium.
  // This is the check that they really are.
  test("scoping, snapshots and clearScope work the same on a file", () => {
    stageDesktop();

    setStorageScope("user-1");
    writeKey("budgets", [{ id: "theirs" }]);
    setStorageScope(null);
    writeKey("budgets", [{ id: "ours" }]);

    expect(hasStoredBooks("user-1")).toBe(true);
    expect(snapshotScope("user-1")).toEqual({ budgets: [{ id: "theirs" }] });

    clearScope("user-1");
    expect(hasStoredBooks("user-1")).toBe(false);
    expect(readKey("budgets")).toEqual([{ id: "ours" }]);
  });
});
