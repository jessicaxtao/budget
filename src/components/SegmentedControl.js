/**
 * A row of mutually exclusive choices about what is on screen — which span a
 * change is measured over, how far back a chart reaches.
 *
 * A control for *views*, not for values. Nothing here writes to a store, which
 * is why it is buttons rather than the radios `SourceChoice` uses: those answer a
 * question the plan keeps an answer to, and the answer not chosen has to stay
 * visible beside it. Here the options are short, exclusive, and worth one click
 * each — a select would hide four of five behind a menu for no gain, and the
 * whole point of the control is to make comparing them cheap.
 *
 * `aria-pressed` rather than a radiogroup, because that is what these are: a
 * strip of toggles where one is down. It also keeps every option in the tab
 * order, which a roving-tabindex radiogroup would not, and at five options that
 * is the faster keyboard path rather than the slower one.
 *
 * Hairlines are drawn as a left border on every option but the first, so the
 * strip reads as one control and the segments do not stand a pixel apart.
 */
export default function SegmentedControl({ label, options, value, onChange, className = "" }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex border border-edge ${className}`}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 font-mono text-label uppercase tracking-wide transition-colors ${
              index > 0 ? "border-l border-edge" : ""
            } ${
              selected
                ? // The palette's active-tab colour, as on the section nav — one
                  // answer to "this is the one you are looking at" across the app.
                  "bg-sulfur font-medium text-ledger"
                : "text-chalk-soft hover:bg-panel-raised hover:text-chalk"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
