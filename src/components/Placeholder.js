/**
 * Marks a section of the app that has been scaffolded but not implemented.
 * `items` lists the capabilities the finished section is meant to cover.
 */
export default function Placeholder({ title, items = [] }) {
  return (
    <section className="border border-dashed border-edge bg-panel/60 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="border border-sulfur/50 px-2 py-0.5 font-mono text-label uppercase text-sulfur">
          Not built
        </span>
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">{title}</h2>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 font-sans text-row text-chalk-soft">
            <span className="mt-2 h-px w-2.5 shrink-0 bg-edge" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
