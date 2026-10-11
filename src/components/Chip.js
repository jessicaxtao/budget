const chipBase = "border px-2 py-0.5 font-sans text-label tracking-wide transition-colors";
const chipOn = "border-azure bg-azure/20 font-medium text-chalk";
const chipOff = "border-edge text-chalk-soft hover:border-chalk-soft hover:text-chalk";

/**
 * One name, on or off — the app's toggle chip.
 *
 * `aria-pressed` is what makes it a toggle rather than a link, and it is the
 * whole reason this is a `<button>`: a chip carries **no form value**, so a form
 * holding chips has nothing for `FormData` to read and has to hold the answer in
 * state. That is the trade `SpendingMapFields` documents and the reason it is the
 * one controlled picker in the app.
 *
 * It lives in a file of its own because three screens now ask a question with
 * chips — which spending a card offer covers, which spending an earn rate covers,
 * and which categories, accounts and tags the register is filtered to — and the
 * look of "on" is a palette decision (`azure`, the figure and selection colour)
 * that must have exactly one definition.
 *
 * `title` is for a chip whose label is shortened on screen; `trailing` is for a
 * chip that carries a control of its own, which only the saved filters do — see
 * `TransactionFilterBar`.
 */
export default function Chip({ label, on, onToggle, title, trailing, ...props }) {
  const button = (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onToggle}
      className={`${chipBase} ${on ? chipOn : chipOff} ${trailing ? "border-r-0" : ""}`}
      {...props}
    >
      {label}
    </button>
  );

  // The two sit in one bordered strip, so a chip with a control on it reads as
  // one object rather than as two buttons that happen to be next to each other —
  // `SegmentedControl`'s hairline trick, at the size of a chip.
  return trailing ? <span className="inline-flex items-stretch">{button}{trailing}</span> : button;
}

/**
 * On or off in an id list — the one operation a chip performs, here rather than
 * in either caller so the two cannot disagree about what a toggle is.
 */
export function toggleId(list, id) {
  return list.includes(id) ? list.filter((other) => other !== id) : [...list, id];
}

/** The chip's own classes, for the few controls that sit in a row of chips. */
export { chipBase, chipOff, chipOn };
