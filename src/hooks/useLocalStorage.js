import { useEffect, useRef, useState } from "react";

function resolve(defaultValue) {
  return typeof defaultValue === "function" ? defaultValue() : defaultValue;
}

/**
 * Reads one key, surviving everything localStorage can throw at us.
 *
 * This matters more than it looks: every store is built on this hook and all
 * five providers wrap the entire app, so anything that throws here white-screens
 * the whole application — and keeps doing it on every reload, because nothing
 * would clear the value that caused it.
 */
function read(key, defaultValue, migrate) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage disabled outright. The app still runs for this session; it just
    // cannot persist.
    return resolve(defaultValue);
  }

  if (raw == null) return resolve(defaultValue);

  try {
    const parsed = JSON.parse(raw);
    return migrate ? migrate(parsed) : parsed;
  } catch {
    // Corrupt or unmigratable. Drop the key so the next write re-seeds it and
    // the app self-heals instead of failing identically forever.
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing further we can do */
    }
    return resolve(defaultValue);
  }
}

/**
 * useState, persisted to localStorage under `key`.
 *
 * `migrate`, when given, is applied to values actually read back from storage —
 * never to `defaultValue` — which is where older record shapes get upgraded.
 */
export default function useLocalStorage(key, defaultValue, migrate) {
  // Held in a ref so callers can keep passing inline literals without
  // re-subscribing the storage listener on every render.
  const latest = useRef({ defaultValue, migrate });
  latest.current = { defaultValue, migrate };

  const [value, setValue] = useState(() => read(key, defaultValue, migrate));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded, or storage disabled. A failed persist must not take
      // down the render.
    }
  }, [key, value]);

  // `storage` fires only in *other* tabs, never the one that wrote — which is
  // what makes this safe. Without it, two open tabs hold independent copies and,
  // because every write replaces the whole array, the last to save silently
  // destroys what the other logged.
  useEffect(() => {
    function handleStorage(e) {
      if (e.key !== key) return;
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

  return [value, setValue];
}
