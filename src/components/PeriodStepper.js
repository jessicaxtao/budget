import Button from "./Button";
import { addMonths, formatPeriod } from "./../utils";

/**
 * Move a page between months. Rollover means a category's balance is the sum of
 * every month before this one, so being able to look back is what makes the
 * carried-in figure checkable rather than something the user has to trust.
 *
 * Stepping goes through addMonths rather than string arithmetic, which would
 * produce "2026-13" — and that sorts before "2027-01", so December plus one
 * would quietly read January as if it were still the future.
 */
export default function PeriodStepper({ period, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous month"
        onClick={() => onChange(addMonths(period, -1))}
      >
        &lsaquo;
      </Button>
      {/* Fixed width so the controls do not shuffle sideways between a short
          month name and a long one. */}
      <span className="min-w-[8.5rem] text-center font-mono text-row text-chalk">
        {formatPeriod(period)}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label="Next month"
        onClick={() => onChange(addMonths(period, 1))}
      >
        &rsaquo;
      </Button>
    </div>
  );
}
