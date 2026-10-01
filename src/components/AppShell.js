import { NavLink } from "react-router-dom";
import { navigation } from "../navigation";
import useTheme, { THEMES } from "../hooks/useTheme";
import Elder from "./Elder";

// Sun and moon for the switch: the icon is the mode the app is in now, and the
// label plus `aria-pressed` say the same thing in words.
function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7z" fill="currentColor" />
    </svg>
  );
}

/**
 * The canopy: the header band, the same deep green in both modes, with the
 * Elder beside the name and the light/dark switch at the far end.
 *
 * The switch is a toggle button (`aria-pressed` on "Dark mode") rather than a
 * two-option strip, because there are only two states and one of them is
 * always the answer to "is it on".
 */
export default function AppShell({ children }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === THEMES.DARK;

  return (
    <div className="min-h-screen bg-ledger">
      <header className="bg-canopy">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-on-canopy-soft">
                <Elder className="h-9 w-10" />
              </span>
              <span className="font-display text-2xl text-on-canopy">Household Books</span>
              <span className="font-sans text-label font-bold uppercase text-on-canopy-soft">
                Personal budget
              </span>
            </div>
            <button
              type="button"
              aria-pressed={dark}
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 rounded-full border border-on-canopy-soft/40 px-3.5 py-2 font-sans text-sm font-medium text-on-canopy transition-colors hover:border-on-canopy-soft hover:bg-on-canopy/10"
            >
              {dark ? <MoonIcon /> : <SunIcon />}
              Dark mode
            </button>
          </div>
          <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-7">
            {navigation.map(({ path, label, family }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2 border-b-[3px] pb-2.5 pt-1 font-sans text-sm transition-colors ${
                    isActive
                      ? "border-coin font-bold text-on-canopy"
                      : "border-transparent font-medium text-on-canopy-soft hover:border-on-canopy-soft/40 hover:text-on-canopy"
                  }`
                }
              >
                <span className={`h-1.5 w-1.5 rounded-full ${family}`} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-9">{children}</main>
    </div>
  );
}
