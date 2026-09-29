import { useEffect, useRef, useState } from "react";
import { readKey, scopedKey, writeKey } from "../storage";
import { useSync } from "../contexts/SyncContext";

function resolve(defaultValue) {
  return typeof defaultValue === "function" ? defaultValue() : defaultValue;
}

/**
 * One store's value, in this browser and on the server.
 *
 * **This is `useLocalStorage` with a second destination, and the signature is
 * unchanged on purpose.** Every store in the app is built on it, all ten
 * providers wrap the whole tree, and each one carries a `migrate` that upgrades
 * older record shapes on the way in. Keeping `(key, defaultValue, migrate)`
 * exactly as it was is what let the move to Postgres happen without touching a
 * single migration, a single `{ ok, error }` mutator, or the invariant
 * tripwires that check the envelope maths.
 *
 * **The read is synchronous, and it has to be.** Three provider initialisers
 * read storage directly to build their lazy defaults — `foldLegacyLedger`
 * folding the old `income`/`expenses` keys, `readStoredLedger` behind the
 * day-one assignment seed, `legacyPlannedCentsById` behind the budgets fold —
 * and they run before the first paint, where no promise has resolved yet. So
 * local storage stays, demoted from source of truth to a **cache with a
 * synchronous read**; `SyncProvider` fills it from the account's own documents
 * and gates the render on that, so what these initialisers find is already the
 * right household's books.
 *
 * Three things can move a value, and each has to be handled differently:
 *
 *   - **This tab.** `setValue`, as ever. Writes the cache immediately and
 *     queues the document for the server.
 *   - **Another tab, same browser.** The `storage` event, kept from the
 *     original hook — it is instant and free, and two tabs are still the
 *     commonest way to lose a write.
 *   - **Another device.** The realtime subscription, via `subscribeRemote`.
 *     Same failure the `storage` event guards against, one device wider.
 *
 * With no `SyncProvider` above it the hook is exactly the old one: cache reads,
 * cache writes, cross-tab events, no network. That is a supported mode — an
 * unconfigured build, a signed-out session, and every existing test run.
 */
export default function useSyncedState(key, defaultValue, migrate) {
  // `useSync` returns undefined when no provider is mounted, which is the
  // local-only case rather than a mistake.
  const { push, subscribeRemote } = useSync() ?? {};

  // Held in a ref so callers can keep passing inline literals without
  // re-subscribing on every render.
  const latest = useRef({ defaultValue, migrate });
  latest.current = { defaultValue, migrate };

  const [value, setValue] = useState(() => {
    const stored = readKey(key);
    if (stored === undefined) return resolve(defaultValue);
    try {
      return migrate ? migrate(stored) : stored;
    } catch {
      // Unmigratable. Start from the default rather than failing identically on
      // every reload — the raw document is still on the server, untouched.
      return resolve(defaultValue);
    }
  });

  // Cache first, then the wire. `push` is a no-op when the value matches what
  // the server last sent, so a reload costs no writes even though this fires on
  // mount for all fourteen stores.
  useEffect(() => {
    writeKey(key, value);
    push?.(key, value);
  }, [key, value, push]);

  // Another tab on this device. Fires only in tabs that did *not* write, which
  // is what makes it safe to apply directly.
  useEffect(() => {
    const watched = scopedKey(key);

    function handleStorage(e) {
      if (e.key !== watched) return;
      // sessionStorage writes raise the same event; ignore those. Synthetic
      // events in tests often omit storageArea, so only reject a positive
      // mismatch.
      if (e.storageArea && e.storageArea !== localStorage) return;

      const { defaultValue, migrate } = latest.current;

      if (e.newValue == null) {
        setValue(resolve(defaultValue));
        return;
      }

      try {
        const parsed = JSON.parse(e.newValue);
        setValue(migrate ? migrate(parsed) : parsed);
      } catch {
        // Another tab wrote something unreadable; keep what we have.
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  // Another device. The cache has already been written by SyncProvider by the
  // time this runs; what is left is to move the store that reads it.
  useEffect(() => {
    if (!subscribeRemote) return undefined;

    return subscribeRemote(key, (incoming) => {
      const { defaultValue, migrate } = latest.current;

      if (incoming === undefined) {
        setValue(resolve(defaultValue));
        return;
      }

      try {
        setValue(migrate ? migrate(incoming) : incoming);
      } catch {
        // A document this build cannot read — a newer schema from a device
        // running a later version. Keep what we have rather than blanking the
        // store; the server's copy is unharmed.
      }
    });
  }, [key, subscribeRemote]);

  return [value, setValue];
}
