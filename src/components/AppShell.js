import { NavLink } from "react-router-dom";
import { navigation } from "../navigation";

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-ledger">
      <header className="bg-ledger">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-6">
            <span className="font-sans text-xl font-bold tracking-tight text-chalk">Household Books</span>
            <span className="font-mono text-label uppercase text-chalk-soft">Personal budget</span>
          </div>
          <nav aria-label="Sections" className="mt-5 flex flex-wrap gap-x-7">
            {navigation.map(({ path, label, accent }) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `border-b-[3px] pb-2.5 font-sans text-sm font-medium transition-colors ${
                    isActive
                      ? `${accent.border} ${accent.text}`
                      : "border-transparent text-chalk-soft hover:border-edge hover:text-chalk"
                  }`
                }
              >
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
