export default function Field({ label, inputRef, ...props }) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">{label}</span>
      <input
        ref={inputRef}
        className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
        {...props}
      />
    </label>
  );
}

/**
 * The same field, with a `<select>` in place of the input.
 *
 * Opaque where `Field` is transparent: a transparent select paints its option
 * list against the page behind it in some browsers, which on this palette means
 * chalk text on nothing.
 *
 * Note what it does *not* take: a value. Every form in this app is uncontrolled
 * and re-seeded through its ref when it opens, because `defaultValue` on a
 * modal that never unmounts only ever applies once. Passing a value here would
 * work on the first open and silently stop.
 */
export function SelectField({ label, selectRef, children, ...props }) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">{label}</span>
      <select
        ref={selectRef}
        className="w-full border-0 border-b-2 border-edge bg-panel px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors focus:border-azure"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
