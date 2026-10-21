export default function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:mb-6 sm:gap-y-4">
      <div className="min-w-0">
        <h1 className="text-balance font-sans text-2xl font-semibold tracking-tight text-chalk sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl font-sans text-sm leading-relaxed text-chalk-soft">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
