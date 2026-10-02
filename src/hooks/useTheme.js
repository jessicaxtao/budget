import { useCallback, useEffect, useState } from "react";

export const THEMES = { LIGHT: "light", DARK: "dark" };

/**
 * Read bare, and deliberately so — this is the one key in the app that does
 * **not** go through `src/storage.js`.
 *
 * Everything in `STORE_KEYS` is a document of the household's books: namespaced
 * by user, pushed to the account server, cleared on sign-out, and carried in
 * and out by `booksFile.js`. The mode is none of those things. Putting it
 * through that seam would be wrong four times over — it would travel between
 * devices and fight over one household's two screens, it would be deleted from
 * the browser when somebody signed out, it would be written into the books file
 * in the desktop build, and `booksFile.js` refuses an unknown key rather than
 * dropping it, so an export carrying a `theme` would fail to import.
 *
 * So: bare key, no scope, survives a sign-out. `public/index.html` reads this
 * exact key the same way before the first paint.
 */
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia(DARK_QUERY).matches ? THEMES.DARK : THEMES.LIGHT;
  } catch {
    return THEMES.LIGHT;
  }
}

function readStored(value) {
  return value === THEMES.LIGHT || value === THEMES.DARK ? value : null;
}

function loadStored() {
  try {
    return readStored(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    // Unreadable, unparseable, or storage denied outright. All three mean the
    // same thing here — nobody has picked a mode — so the system decides.
    return null;
  }
}

function saveStored(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Storage disabled or full. The switch still works for this session; it
    // just will not be remembered, which is a better answer than throwing out
    // of a click handler.
  }
}

/**
 * Light or dark, and the switch between them.
 *
 * A preference about the screen, not a fact about the books, so it is a hook
 * rather than a store in AppProviders: nothing else reads it, and nothing in
 * the maths may. The stored value is `null` until the user picks one, and while
 * it is `null` the system's own setting decides — and keeps deciding, so a
 * laptop that turns dark at sunset takes the app with it. Picking a mode pins
 * it, and **following the system writes nothing**, which is what keeps that
 * live following alive: storing the current system answer would silently pin
 * it the first time the app was opened.
 *
 * The mode lands on <html> as `data-theme`, which is what every colour token in
 * index.css keys off. `public/index.html` makes the same decision before React
 * loads; the two read the same key the same way, so they cannot disagree.
 */
export default function useTheme() {
  const [stored, setStored] = useState(loadStored);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(DARK_QUERY);
    const handleChange = () => setSystem(media.matches ? THEMES.DARK : THEMES.LIGHT);
    // Safari before 14 only has the deprecated listener pair.
    if (media.addEventListener) media.addEventListener("change", handleChange);
    else if (media.addListener) media.addListener(handleChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", handleChange);
      else if (media.removeListener) media.removeListener(handleChange);
    };
  }, []);

  const theme = stored ?? system;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Flips whatever is on screen now, which is the system's answer until a mode
  // has been picked — so the first click on a dark-by-system laptop pins light,
  // not dark, and the switch never looks like it did nothing.
  const toggleTheme = useCallback(() => {
    const next = theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    saveStored(next);
    setStored(next);
  }, [theme]);

  return { theme, toggleTheme };
}
