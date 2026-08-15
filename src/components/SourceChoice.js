/**
 * Which of two answers is in force, for a question that legitimately has two.
 *
 * The retirement plan asks this twice — where the starting balance comes from,
 * and how the spending target is arrived at — and in both cases the answer not
 * chosen is kept rather than cleared, so the control has to read as a switch
 * between two live answers rather than as a mode that discards one.
 *
 * Radios rather than a select: there are two options, they are short, and each
 * one governs a different control below it, which a collapsed select would hide.
 */
export default function SourceChoice({ name, legend, value, options, onChange }) {
  return (
    <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="h-3.5 w-3.5 shrink-0 accent-azure"
          />
          <span
            className={`font-sans text-row ${value === option.value ? "text-chalk" : "text-chalk-soft"}`}
          >
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
