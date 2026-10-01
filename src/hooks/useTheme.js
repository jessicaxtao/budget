import { useEffect, useState } from "react";
import useLocalStorage from "./useLocalStorage";

export const THEMES = { LIGHT: "light", DARK: "dark" };

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

/**
 * Light or dark, and the switch between them.
 *
 * A preference about the screen, not a fact about the books, so it is a hook
 * rather than a store in AppProviders: nothing else reads it, and nothing in
 * the maths may. The stored value is `null` until the user picks one, and while
 * it is `null` the system's own setting decides — and keeps deciding, so a
 * laptop that turns dark at sunset takes the app with it. Picking a mode pins it.
 *
 * The mode lands on <html> as `data-theme`, which is what every colour token in
 * index.css keys off. public/index.html makes the same decision before React
 * loads; the two read the same key the same way, so they cannot disagree.
 */
export default function useTheme() {
  const [stored, setStored] = useLocalStorage("theme", null, readStored);
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

  const theme = readStored(stored) ?? system;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return {
    theme,
    toggleTheme: () => setStored(theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK),
  };
}
