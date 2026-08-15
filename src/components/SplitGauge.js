import { apportion } from "../utils";

const TICKS = 24;

/**
 * How one whole divides between a few named parts.
 *
 * Drawn in the same discrete ticks as `TallyGauge`, at the same size, so the two
 * read as one instrument in two modes rather than as two different charts: that
 * one measures a figure against a limit, this one measures a figure against
 * itself. The ticks are apportioned by largest remainder rather than rounded
 * one by one, so they always total 24 — a meter with a gap in the middle would
 * look like missing data rather than rounding.
 *
 * Purely a picture: every segment it draws is also printed as words and figures
 * beside it, so it carries one summarising label and nothing else.
 *
 * Nothing to divide draws nothing at all — as with `TallyGauge`, **callers must
 * suppress it rather than pass all-zero weights**, or the row collapses to a
 * blank strip that reads as a broken meter instead of an empty plan.
 */
export default function SplitGauge({ segments, label }) {
  const ticks = apportion(
    segments.map((segment) => segment.weight),
    TICKS
  );

  return (
    <div className="flex gap-[3px]" role="img" aria-label={label}>
      {segments.flatMap((segment, index) =>
        Array.from({ length: ticks[index] }, (_, tick) => (
          <span key={`${segment.key}-${tick}`} className={`h-3 w-[3px] ${segment.tone}`} />
        ))
      )}
    </div>
  );
}
