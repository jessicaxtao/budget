# The desktop app

The build where **local mode is actually true**: the household's books are a file on their own machine and reach no server at all. The other half of the same story — the account, the one server table and the gates in front of it — is in `.claude/ACCOUNTS.md`, and the local model the shell is the only build to carry is in `.claude/ASSISTANT.md`.

The Obsidian-style vault plan at the foot of this file is **what was not built**. It is kept because the decision against it is worth not re-deriving, not because it describes anything on disk.

## The desktop shell

Accounts answered "how do two devices share one household's books". The desktop build answers the question underneath it, which the web build cannot: **a household that wants their ledger on their own machine and nowhere else.** A browser cannot honour that promise — `localStorage` is cleared by anything that clears a cache, it does not survive the machine, and "on this computer" in a tab is a much smaller claim than the same words beside a file on disk. So the shell is not a wrapper around the web app for convenience; it is the build where local mode is actually true, and every line in `electron/` is either the machinery that makes it true or the machinery that keeps it true when somebody does sign in.

**Five files, and one rule each.** `electron/main.js` is the process and the promise; `electron/books.js` is the file; `electron/assist.js` is the local model; `electron/receipts.js` is the receipt files beside the books; `electron/preload.js` is the entire surface the page can reach. The renderer stays sandboxed with no Node integration, so the bridge is a snapshot plus four verbs on the books, two on the model and three on receipts (put, open in the system viewer, remove — each about one id the page minted, a uuid checked in main, never a path), and deliberately nothing general — no "read a file", no "run a command".

- **The app is served over `app://`, registered as standard *and* secure**, never `file://`. A standard scheme gets a real origin, so the History API works (`BrowserRouter` and every deep link keep working untouched) and `localStorage` and a normal CSP behave exactly as they do on https; under `file://` all three break at once. A path with no extension is a route and falls back to `index.html`, which is the same single-page rewrite the web deploy relies on — and it is why `homepage` stays unset in `package.json`, since setting it to `"./"` would have broken deep links on the web to fix them here.
- **Egress is an allow-list, not a deny-list**, plus Chromium's own background networking switched off by name. The requirement is "zero requests", and a deny-list can only block what somebody thought of. What is allowed is the app's own origin and — only when the build has one — the account server. **Development is "pointed at a dev server", not "not packaged"**: keyed off `ELECTRON_START_URL` rather than `app.isPackaged`, because every relaxation (`unsafe-eval`, localhost in the filter) exists for CRA's dev server, and `electron .` against `build/` should exercise exactly the path a packaged app takes.
- **The policy is one policy written in three languages** — `vercel.json` for the web deploy, `contentSecurityPolicy()` for the shell, and the egress filter beside it. Nothing can share a string between a JSON file Vercel reads at deploy time and JavaScript Electron reads at run time, so **changing one means changing the others**.
- **The one host it may open is resolved at build time, by `electron/writeShellConfig.js`, and never from `process.env`.** CRA inlines `REACT_APP_SUPABASE_URL` into the bundle; nothing puts it into the environment of the Electron process spawned beside the dev server, and a packaged app launched from a dock has no developer shell behind it at all. Read from the environment it was `null` in every real run — the filter cancelled every request to the account server and sign-in failed with the form saying nothing. The generator reads the same `.env` files CRA does, in CRA's own order, and writes `electron/shell-config.json` (gitignored, shipped inside the package). It **always writes, including a `null`**: a stale file would let the shell open a host the bundle beside it knows nothing about, which is the one failure an allow-list exists to prevent.
- **The window's cold-start colour is a fourth copy of the palette, hard-coded.** `groundColor()` in `main.js` opens the `BrowserWindow` on `ledger`'s value for the mode, because the main process cannot read a CSS variable — so the two `--c-ledger` figures in `index.css` have a copy there, and `index.html`'s `theme-color` is a third (the header's green rather than the page's ground). It reads `nativeTheme`, not the stored choice: the preference lives in the renderer's `localStorage`, which does not exist until there is a renderer, and this figure is needed to build one. Somebody who pins a mode *against* their OS therefore gets one frame of the other ground — closing that would mean main keeping a second copy of a fact the renderer owns, which is the worse trade.
- **One window and one instance.** Two processes over one file is last-writer-wins with no warning and no trace; the cross-tab `storage` event was the guard against that shape of loss one process narrower, and nothing plays that role here.

**`electron/books.js` holds the books in the main process, and the placement is load-bearing twice.** The renderer needs a **synchronous** read at start-up — five things read storage before the first paint, the four store initialisers plus `isGuestMode()` above every gate — and `sendSync` can only be answered by a process that already has the data, which is why `load()` runs before the window is created. And **the debounce has to survive the renderer**: a timer in the page cannot be flushed from `before-quit`, because by then the page is gone. So the renderer posts every write across immediately and the coalescing happens in main, where the quit handlers can reach it. `books:readAll` is answered by `ipcMain.on` setting `event.returnValue` — **never `ipcMain.handle`**, which returns a promise that `sendSync` reads as `undefined`, and the app would boot silently with empty books.

Four durability rules, all of them because in local mode this file is the only copy of the books anywhere:

- **Temp file, then rename.** A rename within a directory is atomic, so a crash or a pulled plug leaves either the old file or the new one and never half of either.
- **A trailing debounce (300ms) *and* a cap counted from the first dirty write (2000ms).** Without the cap the trailing timer is starved indefinitely — tabbing across a row of the register commits a cell every couple of hundred milliseconds and nothing ever reaches the disk. Deliberately not `SyncContext`'s 700ms, which is tuned for a network round trip.
- **The backup is the file as it was found at launch, taken lazily at the first write, once.** Temp-and-rename already makes a torn write impossible, so a copy from three hundred milliseconds ago protects against nothing; what a person wants back is "the books as of last time I opened the app", and for that the copy has to be old.
- **A file that will not parse is moved aside, never overwritten.** Starting empty and saving over it would destroy the only copy at the exact moment something had already gone wrong with it. A failed write keeps the books dirty, so the next write or the next quit tries again.

The documents are stored **parsed** and re-serialised per read at the renderer's end, which is the split that lets the same file be both a drop-in `Storage` and something a person can open in a text editor.

**`src/desktop.js` is the only module that knows the bridge's shape**, the discipline `storage.js` keeps for the shape of a key, and **every function in it is safe to call in a browser** — `isDesktop` is false, there is no path, and the rest are no-ops that report they did nothing, which is what keeps callers free of `if (isDesktop())` around every use. `deviceLabel()` is the one place the app decides whether to call the machine a computer or a browser; where the two readings differ by more than the noun ("safe *on* this computer" against "safe *in* this browser") the caller writes both sentences out. In `storage.js` the medium is one seam lower, in `webBackend` / `desktopBackend` — the same three methods `localStorage` has, over strings. **The desktop backend reads from memory, never from disk**, seeded from the preload's snapshot, which is the whole reason that seam can exist at all.

**Local mode is unscoped in the shell and `GUEST_SCOPE` in a browser**, and the asymmetry is the point: there the bare keys *are* the household's real books, since the file belongs to one machine and there is nobody to collide with, while in a browser the unscoped documents are *this browser's* pre-account books and a stranger trying the app out on a shared machine must not type into them. `AUTH_STATUS.GUEST` is a fact about the **person** (offered an account, declined for now, so the app owes them a way back) where `LOCAL_ONLY` is a fact about the **build** (nothing configured, so there was never an account to decline). `stopSyncing` is the counterpart to `signOut` and not a variant of it: signing out is destructive on purpose, because on a shared browser the books must leave with the session, but on a machine somebody owns that answers "I would rather my ledger were not on a server" by deleting the ledger.

**`src/booksFile.js` is the books as a file and back**, one serialiser for the export, the archive before a restore, and the archive before "stop syncing" — a second one would eventually disagree about the envelope, and the file that matters least on the day it is written is the one that matters most a year later. `schema` is in the envelope from the first version rather than added when first needed, because by then every file in the wild lacks it. Parsing is **liberal about the wrapper, strict about the contents** (a bare flat map is accepted; an unknown key is refused rather than dropped, since silently importing the part we understood would leave the user believing they had restored everything) — and `electron/books.js` asks the same question the same way on the way in, so the two readers cannot disagree about one file. `offerFile` is the one door: a save dialog in the shell, a download in a browser, and **cancelling is reported apart from failing**, because dismissing a dialog is an answer and it has to stop the operation it was protecting.
### Packaging

`electron-builder`, configured in package.json's `build` block. Four things there are not obvious and each one cost a broken package to find:

- **`"extends": null` is required.** electron-builder auto-detects `react-scripts` in `dependencies` and applies its `react-cra` preset, which repoints `main` at `build/electron.js` — a file this layout does not have, so the package builds and then fails its own sanity check.
- **`directories.buildResources` must not be `build`**, which is its default and is CRA's output directory. It is `buildResources/`, which is also where the generated `icon.png` lives.
- **`files` excludes `node_modules` outright.** Every runtime dependency here is React and friends, which the static bundle in `build/` already contains, and `main.js` needs nothing but Electron's own built-ins. Including them is a hundred megabytes of installer that never gets loaded; the packaged `app.asar` is under six.
- **`productName` is top-level in package.json, not only inside `build`.** Electron's `app.getName()` prefers it, and `app.getPath("userData")` is built from that — so a name stated only to the packager would put the dev shell's books and the installed app's books in two different folders. **It follows that renaming the app moves the books**, which is what `LEGACY_APP_DIR` in `electron/books.js` is for: the app was "Household Books" before it was Canopy Budget, and on an already-installed copy that rename is indistinguishable on disk from a first run. `adoptLegacy` reads the sibling folder when this one holds no file — **read-only, so the old file stays as the copy from before the upgrade, and idempotent, so a session that changes nothing writes nothing.** It is deliberately skipped when the file here was found and quarantined as unreadable: something has already gone wrong with the books at that point, and standing an older copy in its place would hide it. Renaming again means another entry there, not an edit to that one. `appId` moved with the name too, so the next installer is a fresh install rather than an upgrade of the old one.


## Superseded: the Tauri vault plan

Written before the shell existed and **not what shipped** — the shell is Electron, and the books are one JSON document per store in a single file rather than a CSV per store. Kept for the reasoning, which is still the reasoning a second attempt would have to answer.

Not started — this is a design note for a future project, capturing a decision made in conversation so it doesn't have to be re-derived.

### The goal

Not just "wrap the web app in a native shell" — the model is **Obsidian**: a vault folder on the user's disk is the actual source of truth, and the app is a live view over it. Not a database that happens to export a backup. The user should be able to open `transactions.csv` in a text editor or Excel and see (and edit) their real data.

### Shell: Tauri, not Electron

The app has no backend, no auth, single user — nothing server-side to port. Tauri over Electron: much smaller binary (system webview instead of bundled Chromium), better filesystem-access story for the vault model below. Electron is more turnkey but ships a full Chromium per app for no benefit here.

### Storage: one CSV per store, in a user-chosen vault folder

Mirrors Obsidian remembering which vault folder to open. Proposed file-per-store split, matching the eight providers in `src/contexts/AppProviders.js`:

- `transactions.csv`
- `budgets.csv`, `groups.csv`
- `assignments.csv`
- `accounts.csv`, `balances.csv`
- `donationRecipients.csv`, `donations.csv`, `donationGoals.csv`
- singleton records (`paySchedule`, `retirementPlan`) — one small YAML/markdown-frontmatter file each, since they're a single record rather than a table

**Decided tradeoff:** CSV-per-store over one bundled markdown/JSON vault file. CSV is diffable, editable independently in Excel/a text editor, and the data is already tabular (money in cents, dates as `YYYY-MM-DD`) — it round-trips cleanly. The cost is more files instead of Obsidian's one-note-per-file feel; accepted because per-table editability matters more here than a single-file aesthetic.

### The real effort: async storage, not the shell

Every one of the eight context providers currently reads `useLocalStorage` **synchronously** on mount (`useState`-shaped, per `.claude/CLAUDE.md`). Files are async. The fix that keeps the rest of the app untouched:

1. At startup, before the provider tree mounts, read the whole vault and parse every file into memory (show a brief loading state for this step).
2. Mount `AppProviders` with that already-parsed state — everything downstream keeps behaving exactly as it does today: synchronous reads, in-memory mutation.
3. Writes fire off to disk in the background (debounced per file), replacing `useLocalStorage`'s `localStorage.setItem`.

This means the money/date/envelope logic, the six cross-store hooks, and every component are **not** touched — only the persistence backend of the `useLocalStorage`-shaped hook changes, plus a new async bootstrap step ahead of it.

**Estimate:** realistically 1–2 weeks of focused work, not a quick wrapper — the bulk of it is writing CSV serialize/deserialize per store and the vault bootstrap, not the Tauri shell itself.

### Open questions (not yet decided)

- Whether to watch the vault folder for external edits (user edits a CSV by hand while the app is open) and hot-reload — true Obsidian behavior, but can be a phase 2 rather than required for v1.
- Exact singleton-record file format (YAML frontmatter vs. small JSON) for `paySchedule` / `retirementPlan`.
- Where the "which vault is open" pointer itself lives (Tauri app-data dir, analogous to Obsidian's own app-level config).
