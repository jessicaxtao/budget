/**
 * The frame shared by every full-screen gate the app can show before the
 * books themselves — `AuthPage`'s sign-in/sign-up/reset forms and
 * `BooksKeyGate`'s set-up/unlock forms. Carries the app's only `<h1>`, as
 * every page does — the wordmark above it is the same one `AppShell` shows,
 * so arriving, signing in and unlocking the books do not look like three
 * different products.
 *
 * Shared rather than copied, because two gates with their own copies of the
 * same card is exactly the drift this app's doctrine warns about: a rule
 * stated twice eventually disagrees with itself, and a frame is no different
 * from a rule.
 */
export default function GateShell({ title, blurb, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ledger px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 font-sans text-xl font-bold tracking-tight text-chalk">
          Canopy Budget
        </div>

        <div className="border border-edge bg-panel p-7">
          <h1 className="font-sans text-lg font-bold tracking-tight text-chalk">{title}</h1>
          <p className="mb-7 mt-2 font-sans text-sm leading-relaxed text-chalk-soft">{blurb}</p>
          {children}
        </div>

        {/* Outside the card on purpose: what goes here is an alternative to the
            whole form above, not another control inside it. */}
        {footer}
      </div>
    </div>
  );
}

/** The error/notice pair every form on one of these gates needs. */
export function Message({ error, notice }) {
  if (error) {
    return (
      <p role="alert" className="mb-5 font-sans text-row text-vermilion">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="status" className="mb-5 font-sans text-row text-verdant">
        {notice}
      </p>
    );
  }
  return null;
}

/** A link in behaviour, a button in fact — it changes what is on screen. */
export function Switcher({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-sans text-row text-azure underline-offset-4 transition-colors hover:text-chalk hover:underline"
    >
      {children}
    </button>
  );
}
