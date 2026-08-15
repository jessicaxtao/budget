import Button from "./Button";

/**
 * Move a page between calendar years.
 *
 * The year's twin of `PeriodStepper`, and a separate control rather than a mode
 * on that one: a month stepper walking twelve steps to reach last year's giving
 * would be the wrong instrument for a figure that is only ever read a year at a
 * time. Which page gets which is decided by what its subject is filed under, and
 * a deduction is filed under a year.
 *
 * Stepping goes through the number rather than through string arithmetic, and
 * anything that is not four digits is left alone rather than stepped into
 * nonsense.
 */
export default function YearStepper({ year, onChange }) {
  const stepped = (delta) => {
    const value = Number(year);
    return Number.isFinite(value) ? String(value + delta) : year;
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous year"
        onClick={() => onChange(stepped(-1))}
      >
        &lsaquo;
      </Button>
      {/* Fixed width so the controls beside it do not shift as the digits
          change, matching the month stepper. */}
      <span className="min-w-[4rem] text-center font-mono text-row text-chalk">{year}</span>
      <Button
        variant="outline"
        size="sm"
        aria-label="Next year"
        onClick={() => onChange(stepped(1))}
      >
        &rsaquo;
      </Button>
    </div>
  );
}
