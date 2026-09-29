import { useMemo, useState } from "react";
import BooksSummary from "./BooksSummary";
import Button from "./Button";
import { useAuth } from "../contexts/AuthContext";
import { useSync } from "../contexts/SyncContext";
import { deviceLabel, isDesktop } from "../desktop";
import {
  hasStoredBooks,
  readKey,
  restoreScope,
  snapshotScope,
  STORE_KEYS,
  writeKey,
} from "../storage";

/** Where the "I already decided" flag lives. Scoped, and never synced. */
const DECISION_KEY = "importDecision";

/**
 * The one-time offer to carry this browser's books up into the account.
 *
 * The app kept one household's books in one browser for its whole life, so the
 * person doing this migration already *has* a ledger — years of it — sitting in
 * unscoped local storage. Signing up and finding an empty dashboard would be
 * the wrong answer, and telling them to re-type it would be a worse one.
 *
 * **It is offered on exactly one condition, and both halves matter**: this
 * browser holds books, *and* the account is still empty. The second is what
 * makes the operation safe — there is nothing to overwrite, so the worst case
 * is an account that gains data it did not need rather than one that loses data
 * it had. It is never offered on a second device, never after the account has
 * anything in it, and never twice, because the decision is remembered per
 * browser per account.
 *
 * Legacy keys travel too. A browser that has not run the current build has its
 * ledger only in `expenses` and `income`, and the folds in `TransactionsContext`
 * run on the way *out* of storage — so carrying only the current keys would
 * carry up an empty account and leave the real ledger behind.
 */
export default function ImportBooksGate({ children }) {
  const { userId } = useAuth();
  const { remote, push, flush } = useSync();

  const [decided, setDecided] = useState(() => (remote ? Boolean(readKey(DECISION_KEY)) : true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Computed once, before any store has mounted and written its empty default
  // into the cache. Deferred by a render and this would read every account as
  // already having books.
  const offer = useMemo(() => {
    if (!remote || decided) return null;
    if (hasStoredBooks(userId)) return null;

    const snapshot = snapshotScope(null);
    if (!hasStoredBooks(null)) return null;
    return snapshot;
  }, [remote, decided, userId]);

  if (!offer) return children;

  function remember() {
    writeKey(DECISION_KEY, { at: new Date().toISOString() });
    setDecided(true);
  }

  async function handleImport() {
    setBusy(true);
    setError(null);

    // Local first, so the books are in place the moment the app renders even if
    // the network is slow — the push below is what makes them durable, and the
    // queue survives a failure and retries.
    restoreScope(userId, offer);
    for (const key of STORE_KEYS) {
      if (offer[key] !== undefined) push(key, offer[key]);
    }

    try {
      await flush();
      remember();
    } catch (e) {
      setError("Could not finish the import. Your books are untouched — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger px-6 py-12">
      <div className="w-full max-w-lg border border-edge bg-panel p-7">
        <h1 className="font-sans text-lg font-bold tracking-tight text-chalk">
          Bring this {deviceLabel()}'s books with you?
        </h1>
        <p className="mb-6 mt-2 font-sans text-sm leading-relaxed text-chalk-soft">
          Your account is empty, and this {deviceLabel()} still holds the books it kept before there
          were accounts. Import them and they move to the server, where any{" "}
          {isDesktop() ? "device" : "browser"} you sign in from can reach them.
        </p>

        <BooksSummary snapshot={offer} />

        {error && (
          <p role="alert" className="mt-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}

        <div className="mt-7 flex flex-wrap gap-2">
          <Button variant="primary" type="button" onClick={handleImport} disabled={busy}>
            {busy ? "Importing…" : "Import them"}
          </Button>
          <Button variant="outline" type="button" onClick={remember} disabled={busy}>
            Start fresh
          </Button>
        </div>

        <p className="mt-5 font-sans text-row leading-relaxed text-chalk-soft">
          Either way the copy {isDesktop() ? "on this computer" : "in this browser"} is left exactly
          where it is. Nothing is deleted.
        </p>
      </div>
    </div>
  );
}
