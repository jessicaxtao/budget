const TICKS = 24;

/**
 * A spent-against-limit meter drawn as discrete ticks rather than a continuous
 * bar, so a category reads as "19 of 24 marks used" at a glance. Colour tracks
 * how close the category is to its limit: comfortable, close, over.
 */
export default function TallyGauge({ amount, max }) {
  const ratio = max > 0 ? amount / max : 0;
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-vermilion" : ratio >= 0.8 ? "bg-sulfur" : "bg-verdant";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-valuenow={Math.round(amount)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {Array.from({ length: TICKS }, (_, i) => (
        <span key={i} className={`h-3 w-[3px] ${i < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}
