import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import { ageLabeller, chartFrame } from "../chartAxis";
import { formatCents, formatCompactCents } from "../utils";

/**
 * The spread of outcomes a Monte Carlo batch or a historical backtest comes
 * to, drawn the way `RetirementChart` draws the single deterministic line —
 * same axis conventions, same hand-rolled SVG, because this app has no chart
 * library and a fan chart does not need one either.
 *
 * Two nested bands (p10–p90, the outer one; p25–p75, the inner) read as a
 * ribbon widening with age, the median a **solid** line through the middle
 * of it — "a trend line is solid, since it is data" (`UI.md`) — and the
 * deterministic single path overlaid thinner and softer, so a reader can see
 * exactly how much the flat-rate figure flatters or understates the spread
 * around it. The target stays the one dashed mark, as it is on
 * `RetirementChart` — a threshold, never a grid line.
 */

const VIEW = { width: 760, height: 300 };
const PAD = { top: 20, right: 58, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(rough) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rough) || 1));
  const normalised = Math.abs(rough) / magnitude;
  return (NICE_STEPS.find((step) => normalised <= step) ?? 10) * magnitude;
}

/** Zero-anchored, as `RetirementChart`'s — the question is always how close
 *  a path gets to the axis, so cropping the baseline would hide that. */
function scaleFor(rows, targetCents, deterministicSeries) {
  const high = Math.max(
    targetCents,
    1,
    ...rows.map((row) => row.p90),
    ...deterministicSeries.map((point) => point.balanceCents)
  );
  const step = niceStep(high / 4);
  const max = Math.ceil(high / step) * step;

  const ticks = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(Math.round(value));

  const y = (cents) => PLOT.bottom - (cents / max) * PLOT_HEIGHT;
  return { y, ticks };
}

/** The closed path of a band between two per-age figures — up one side,
 *  back down the other, the standard way to fill a ribbon. */
function ribbon(rows, xOf, y, lowKey, highKey) {
  if (rows.length === 0) return "";
  const up = rows.map((row, index) => `${index === 0 ? "M" : "L"}${xOf(index)},${y(row[lowKey])}`);
  const down = [...rows]
    .reverse()
    .map((row, offset) => `L${xOf(rows.length - 1 - offset)},${y(row[highKey])}`);
  return [...up, ...down, "Z"].join(" ");
}

function linePath(values, xOf, y) {
  return values.map((value, index) => `${index === 0 ? "M" : "L"}${xOf(index)},${y(value)}`).join(" ");
}

function Readout({ row, retirementAge }) {
  return (
    <div className="pointer-events-none w-max rounded-lg border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        Age {row.age} · {row.age < retirementAge ? "saving" : "retired"}
      </div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(row.p50)} median
      </div>
      <div className="mt-0.5 font-mono text-label tabular-nums text-chalk-soft">
        {formatCents(row.p10)} to {formatCents(row.p90)}
      </div>
    </div>
  );
}

export default function RetirementFanChart({
  percentilesByAge,
  deterministicSeries,
  targetCents,
  retirementAge,
  successRate,
}) {
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: VIEW.height,
    pad: PAD,
  });
  const [active, setActive] = useState(null);

  const rows = percentilesByAge;
  if (rows.length === 0) return null;

  const { y, ticks } = scaleFor(rows, targetCents, deterministicSeries);
  const slot = plotWidth / Math.max(1, rows.length - 1);
  const xOf = (index) => plot.left + slot * index;
  const lastIndex = rows.length - 1;
  const activeRow = active == null ? null : rows[active];

  const splitIndex = Math.max(0, rows.findIndex((row) => row.age >= retirementAge));
  const deterministicByAge = new Map(deterministicSeries.map((point) => [point.age, point.balanceCents]));
  const deterministicValues = rows.map((row) => deterministicByAge.get(row.age) ?? 0);

  const labelled = ageLabeller(rows.map((row) => row.age), plotWidth);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 shrink-0 bg-azure/25" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Middle 80%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 shrink-0 bg-azure/50" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Middle 50%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-azure" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">Median</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 shrink-0 bg-chalk-soft" aria-hidden="true" />
          <span className="font-mono text-label uppercase text-chalk-soft">As planned</span>
        </span>
        {successRate != null && (
          <span className="font-mono text-label uppercase text-chalk-soft">
            {Math.round(successRate * 100)}% kept the money from running out
          </span>
        )}
      </div>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activeRow && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(xOf(active) / view.width) * 100}%`,
                transform: `translateX(${
                  active > rows.length * 0.65 ? "-100%" : active < rows.length * 0.35 ? "0" : "-50%"
                })`,
              }}
            >
              <Readout row={activeRow} retirementAge={retirementAge} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label={`Range of outcomes by age, from ${rows[0].age} to ${rows[lastIndex].age}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={plot.left}
                  x2={plot.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-edge"
                  strokeWidth={1}
                />
                <text
                  x={plot.left - 10}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {formatCompactCents(tick)}
                </text>
              </g>
            ))}

            <path d={ribbon(rows, xOf, y, "p10", "p90")} className="fill-azure/15" />
            <path d={ribbon(rows, xOf, y, "p25", "p75")} className="fill-azure/30" />

            <line
              x1={plot.left}
              x2={plot.right}
              y1={y(targetCents)}
              y2={y(targetCents)}
              className="stroke-sulfur"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={plot.right + 6}
              y={y(targetCents)}
              dominantBaseline="middle"
              className="fill-sulfur font-mono text-label tracking-normal tabular-nums"
            >
              {formatCompactCents(targetCents)}
            </text>

            <line
              x1={xOf(splitIndex)}
              x2={xOf(splitIndex)}
              y1={plot.top}
              y2={plot.bottom}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />
            <text
              x={xOf(splitIndex) + 5}
              y={plot.top + 2}
              dominantBaseline="hanging"
              className="fill-chalk-soft font-mono text-label tracking-normal"
            >
              RETIRE AT {retirementAge}
            </text>

            {active != null && (
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={plot.top}
                y2={plot.bottom}
                className="stroke-chalk-soft"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            <path
              d={linePath(deterministicValues, xOf, y)}
              fill="none"
              className="stroke-chalk-soft"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            <path
              d={linePath(rows.map((row) => row.p50), xOf, y)}
              fill="none"
              className="stroke-azure"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {rows.map((row, index) =>
              labelled(row.age, index) ? (
                <text
                  key={row.age}
                  x={xOf(index)}
                  y={plot.bottom + 16}
                  textAnchor="middle"
                  className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
                >
                  {row.age}
                </text>
              ) : null
            )}

            {rows.map((row, index) => (
              <rect
                key={row.age}
                x={xOf(index) - slot / 2}
                y={plot.top}
                width={slot}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`Age ${row.age}: median ${formatCents(row.p50)}, ${formatCents(
                  row.p10
                )} to ${formatCents(row.p90)}`}
                className="cursor-pointer outline-none focus-visible:fill-chalk/5"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
