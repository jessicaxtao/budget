# Desktop app conversion

Not started — this is a design note for a future project, capturing a decision made in conversation so it doesn't have to be re-derived.

## The goal

Not just "wrap the web app in a native shell" — the model is **Obsidian**: a vault folder on the user's disk is the actual source of truth, and the app is a live view over it. Not a database that happens to export a backup. The user should be able to open `transactions.csv` in a text editor or Excel and see (and edit) their real data.

## Shell: Tauri, not Electron

The app has no backend, no auth, single user — nothing server-side to port. Tauri over Electron: much smaller binary (system webview instead of bundled Chromium), better filesystem-access story for the vault model below. Electron is more turnkey but ships a full Chromium per app for no benefit here.

## Storage: one CSV per store, in a user-chosen vault folder

Mirrors Obsidian remembering which vault folder to open. Proposed file-per-store split, matching the eight providers in `src/contexts/AppProviders.js`:

- `transactions.csv`
- `budgets.csv`, `groups.csv`
- `assignments.csv`
- `accounts.csv`, `balances.csv`
- `donationRecipients.csv`, `donations.csv`, `donationGoals.csv`
- singleton records (`paySchedule`, `retirementPlan`) — one small YAML/markdown-frontmatter file each, since they're a single record rather than a table

**Decided tradeoff:** CSV-per-store over one bundled markdown/JSON vault file. CSV is diffable, editable independently in Excel/a text editor, and the data is already tabular (money in cents, dates as `YYYY-MM-DD`) — it round-trips cleanly. The cost is more files instead of Obsidian's one-note-per-file feel; accepted because per-table editability matters more here than a single-file aesthetic.

## The real effort: async storage, not the shell

Every one of the eight context providers currently reads `useLocalStorage` **synchronously** on mount (`useState`-shaped, per `.claude/CLAUDE.md`). Files are async. The fix that keeps the rest of the app untouched:

1. At startup, before the provider tree mounts, read the whole vault and parse every file into memory (show a brief loading state for this step).
2. Mount `AppProviders` with that already-parsed state — everything downstream keeps behaving exactly as it does today: synchronous reads, in-memory mutation.
3. Writes fire off to disk in the background (debounced per file), replacing `useLocalStorage`'s `localStorage.setItem`.

This means the money/date/envelope logic, the six cross-store hooks, and every component are **not** touched — only the persistence backend of the `useLocalStorage`-shaped hook changes, plus a new async bootstrap step ahead of it.

**Estimate:** realistically 1–2 weeks of focused work, not a quick wrapper — the bulk of it is writing CSV serialize/deserialize per store and the vault bootstrap, not the Tauri shell itself.

## Open questions (not yet decided)

- Whether to watch the vault folder for external edits (user edits a CSV by hand while the app is open) and hot-reload — true Obsidian behavior, but can be a phase 2 rather than required for v1.
- Exact singleton-record file format (YAML frontmatter vs. small JSON) for `paySchedule` / `retirementPlan`.
- Where the "which vault is open" pointer itself lives (Tauri app-data dir, analogous to Obsidian's own app-level config).
