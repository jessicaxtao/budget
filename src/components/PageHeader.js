export default function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        {eyebrow ? (
          <div className="font-mono text-label uppercase text-chalk-soft">{eyebrow}</div>
        ) : null}
        <h1 className="mt-1.5 font-sans text-2xl font-bold tracking-tight text-chalk">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-chalk-soft">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
