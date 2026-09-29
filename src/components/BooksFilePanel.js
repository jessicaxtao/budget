import { useRef, useState } from "react";
import BooksSummary from "./BooksSummary";
import Button from "./Button";
import { useSync } from "../contexts/SyncContext";
import { booksFilename, offerFile, parseBooks, serializeBooks } from "../booksFile";
import { booksPath, isDesktop, revealBooksFile } from "../desktop";
import {
  getStorageScope,
  hasStoredBooks,
  replaceScope,
  snapshotScope,
  STORE_KEYS,
} from "../storage";

/**
 * The books as a file you own: one out, one in.
 *
 * **Signed in, this is a convenience. Signed out, it is the only copy.** The
 * account's rows in Postgres are a durable record with a server behind them;
 * a household running locally has a browser, or a file on one computer, and
 * nothing else. Clearing site data, a dead laptop or a mistyped restore all cost
 * them everything, so an export is not a nice-to-have here — it is the whole of
 * the safety net, which is why this ships before the desktop build that needs it
 * rather than after.
 *
 * Closed by default and at the foot of the page, for `BalanceHistoryPanel`'s
 * reason: it is read twice a year, and a page somebody came to in order to
 * rename a category should not lead with the button that can replace their
 * ledger.
 *
 * ---
 *
 * **Restore is the most dangerous control in the app, and three things make it
 * safe rather than one confirmation dialog:**
 *
 *   1. **It counts both sides before it commits.** `BooksSummary` is the same
 *      component the one-time import uses, so "412 transactions" against "6"
 *      lets the user notice they picked last year's file and stop. A dialog
 *      saying "this cannot be undone" carries none of that information.
 *   2. **It writes the current books out first**, before it overwrites
 *      anything — a save dialog in the shell, a download in a browser. Not a
 *      hidden archive the user would have to be told about, and **declining it
 *      stops the restore**, because the copy is the thing that made replacing
 *      the books safe in the first place.
 *   3. **It replaces rather than merges.** `replaceScope`, not `restoreScope`:
 *      a store the file does not mention is emptied, or the household ends up
 *      with books that are neither the file's nor their own.
 */
export default function BooksFilePanel() {
  // Optional, exactly as in `AppShell`: this panel renders in the page suites
  // and in an unconfigured build, where there is no sync layer above it.
  const { remote, push, dropRemote, flush } = useSync() ?? {};

  const fileRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const scope = getStorageScope();
  const hasBooks = hasStoredBooks(scope);

  async function handleExport() {
    setError(null);
    setDone(null);

    const result = await offerFile(booksFilename(), serializeBooks(snapshotScope(scope)));
    // Changing your mind is an answer, not a failure worth reporting.
    if (result.canceled) return;
    if (!result.ok) {
      setError(result.error ?? "Could not write the file.");
      return;
    }
    setDone(
      result.path
        ? `Exported to ${result.path}. Keep a copy somewhere other than this computer.`
        : "Exported. Keep the file somewhere other than this computer."
    );
  }

  async function handlePick(event) {
    const file = event.target.files?.[0];
    // The input is cleared either way, so picking the same file twice in a row
    // still fires a change event and still opens the confirmation.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setDone(null);
    setPending(null);

    let text;
    try {
      text = await file.text();
    } catch {
      setError("Could not read that file.");
      return;
    }

    const result = parseBooks(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending({ name: file.name, snapshot: result.snapshot });
  }

  async function handleReplace() {
    if (!pending) return;
    setBusy(true);
    setError(null);

    // The safety copy goes out before anything is overwritten, and only if there
    // is something to copy — a fresh browser would otherwise be handed a file
    // holding nothing, which reads as the export having failed.
    if (hasBooks) {
      const archived = await offerFile(
        booksFilename({ suffix: "before-restore" }),
        serializeBooks(snapshotScope(scope))
      );

      if (!archived.ok) {
        setBusy(false);
        // A cancelled archive stops the restore rather than proceeding without
        // it: the copy is the thing that makes replacing the books safe, so
        // going on would remove the only protection the user just declined.
        setError(
          archived.canceled
            ? "Nothing was replaced — the copy of your current books was not saved."
            : `Could not save a copy of your current books, so nothing was replaced. ${
                archived.error ?? ""
              }`.trim()
        );
        return;
      }
    }

    replaceScope(scope, pending.snapshot);

    // Signed in, the account has to be told both halves: the documents the file
    // named, and the ones it did not. Without the second the next hydrate would
    // bring the dropped stores straight back over the restore.
    if (remote) {
      const named = STORE_KEYS.filter((key) => pending.snapshot[key] !== undefined);
      const dropped = STORE_KEYS.filter((key) => pending.snapshot[key] === undefined);

      for (const key of named) push(key, pending.snapshot[key]);
      if (dropped.length > 0) dropRemote(dropped);

      const result = await flush();
      if (!result?.ok) {
        // The local copy is already replaced and the safety file is written, so
        // nothing is lost — but reloading now would hydrate the account's older
        // books back over the top, so the reload is what we refuse.
        setBusy(false);
        setError(
          `Your books were replaced on this device but could not be sent to your account: ${
            result?.error ?? "the server did not answer"
          }. Reload once you are back online.`
        );
        return;
      }
    }

    // Every store seeded its state at mount and nothing above them knows the
    // books changed underneath, so a reload is the honest way to show what was
    // restored — and it is what makes the migrations run over the new documents.
    window.location.reload();
  }

  return (
    <section className="border border-edge bg-panel">
      <details>
        <summary className="cursor-pointer px-4 py-3 marker:text-chalk-soft">
          <span className="font-sans text-base font-semibold tracking-tight text-chalk">
            Your books as a file
          </span>
          <span className="ml-3 font-mono text-label uppercase text-chalk-soft">
            Export · restore
          </span>
        </summary>

        <div className="border-t border-edge">
          <p className="px-4 py-3 font-sans text-row leading-relaxed text-chalk-soft">
            {remote
              ? "Your books are on your account, so this is a spare copy rather than the only one — useful before a big change, or to keep a record of a year you have closed."
              : isDesktop()
              ? "Your books are in a file on this computer and nowhere else. Nothing here is sent anywhere, and nothing else is keeping a copy, so an export is the only way back from a lost machine or a file that goes missing."
              : "Your books are in this browser and nowhere else. Nothing here is sent anywhere, and nothing else is keeping a copy, so an export is the only way back from a cleared browser or a lost machine."}
          </p>

          <div className="flex flex-wrap items-center gap-2 border-t border-edge px-4 py-3">
            <Button variant="primary" type="button" onClick={handleExport} disabled={!hasBooks}>
              Export to a file
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              Restore from a file…
            </Button>
            {!hasBooks && (
              <span className="font-sans text-row text-chalk-soft">
                Nothing to export yet.
              </span>
            )}
          </div>

          {/* **The promise is that the books are a file you own, so it has to be
              a file you can find.** Printed rather than described, because
              "somewhere in your application data" is not an answer anybody can
              act on — and with the path on screen, copying the books somewhere
              safe is something they can do without the app's help at all. */}
          {isDesktop() && booksPath() && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-edge px-4 py-3">
              <span className="shrink-0 font-mono text-label uppercase text-chalk-soft">
                Kept in
              </span>
              <code className="min-w-0 break-all font-mono text-row text-chalk">{booksPath()}</code>
              <Button variant="outline" size="sm" type="button" onClick={revealBooksFile}>
                Show me
              </Button>
            </div>
          )}

          {/* Hidden rather than styled: a file input cannot be restyled to match
              the rest of the app, and a button that opens it can. */}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handlePick}
            className="hidden"
            aria-label="Books file to restore"
          />

          {error && (
            <p
              role="alert"
              className="border-t border-edge px-4 py-3 font-sans text-row leading-relaxed text-vermilion"
            >
              {error}
            </p>
          )}

          {done && (
            <p
              role="status"
              className="border-t border-edge px-4 py-3 font-sans text-row text-chalk-soft"
            >
              {done}
            </p>
          )}

          {pending && (
            <div className="border-t border-edge px-4 py-4">
              <h3 className="font-sans text-sm font-semibold tracking-tight text-chalk">
                Replace your books with {pending.name}?
              </h3>
              <p className="mb-4 mt-1 font-sans text-row leading-relaxed text-chalk-soft">
                Check the two counts before you do. A copy of what you have now will be saved to
                your downloads first, and anything the file does not mention will be emptied.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <BooksSummary snapshot={snapshotScope(scope)} label="On this device now" />
                <BooksSummary snapshot={pending.snapshot} label="In that file" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="danger" type="button" onClick={handleReplace} disabled={busy}>
                  {busy ? "Replacing…" : "Replace my books"}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
