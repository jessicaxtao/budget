import { useRef, useState } from "react";
import { axisLabels, axisTicks, barWidthFor, columnPath, radiusFor } from "../chartAxis";
import { formatCents, formatCompactCents, formatPeriod, formatPeriodShort } from "../utils";

/**
 * One category, month by month — the drill-in's own chart, and the one place
 * on the report a single category's history is drawn rather than folded into a
 * total.
 *
 * One series, not two: `CashflowChart` needs income and spending side by side
 * because the household earns and spends through different accounts of the
 * ledger, but a category only ever spends and is refunded into, and those two
 * are already netted into `netCents` on the row `useSpendingReport` builds. So
 * a month is one column, drawn on the side its own sign puts it — `vermilion`
 * above the baseline for a month that cost the category money, `verdant` below
 * it for the rare month a refund outweighed the spend, the same rule
 * `stackPaths` uses for the cashflow chart, just with nothing left to stack.
 *
 * The keyboard and pointer contract mirrors `CashflowChart`'s: one tab stop
 * moved with the arrow keys rather than one hit area per month, because a
 * ten-year "all" window is still a hundred and twenty of them.
 */

const VIEW = { width: 760, height: 220 };
const PAD = { top: 16, right: 16, bottom: 34, left: 66 };
const PLOT = {
  left: PAD.left,
  right: VIEW.width - PAD.right,
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_WIDTH = PLOT.right - PLOT.left;
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

function scaleFor(monthly) {
  let high = 0;
  let low = 0;
  for (const entry of monthly) {
    high = Math.max(high, entry.netCents);
    low = Math.min(low, entry.netCents);
  }
  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

/** The month and its figure, said in words for a screen reader. */
function describe(entry) {
  const parts = [`${formatPeriod(entry.period)}: ${formatCents(entry.netCents)}`];
  if (entry.refundCents > 0) parts.push(`${formatCents(entry.refundCents)} of it refunded`);
  return parts.join(", ");
}

function Readout({ entry }) {
  return (
    <div className="pointer-events-none w-max max-w-[16rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div
        className={`mt-0.5 font-sans text-base font-semibold tabular-nums ${
          entry.netCents < 0 ? "text-verdant" : "text-chalk"
        }`}
      >
        {formatCents(entry.netCents)}
      </div>
      {entry.refundCents > 0 && (
        <div className="mt-1 font-sans text-row text-chalk-soft">
          {formatCents(entry.spentCents)} spent, {formatCents(entry.refundCents)} back
        </div>
      )}
    </div>
  );
}

export default function CategoryHistoryChart({ monthly }) {
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  const { y, ticks } = scaleFor(monthly);
  const slot = PLOT_WIDTH / monthly.length;
  const barWidth = barWidthFor(slot, monthly.length);
  const radius = radiusFor(barWidth);
  const centreOf = (index) => PLOT.left + slot * (index + 0.5);

  const baseline = y(0);
  const lastIndex = monthly.length - 1;
  const labels = axisLabels(monthly.map((entry) => entry.period));

  const activeEntry = active != null && active <= lastIndex ? monthly[active] : null;
  const activeIndex = activeEntry ? active : null;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[event.key];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div className="overflow-x-auto px-2 pb-2 pt-3">
      <div className="relative min-w-[600px]">
        {activeEntry && (
          <div
            className="absolute top-0 z-10"
            style={{
              left: `${(centreOf(activeIndex) / VIEW.width) * 100}%`,
              transform: `translateX(${
                activeIndex > monthly.length * 0.65
                  ? "-100%"
                  : activeIndex < monthly.length * 0.35
                    ? "0"
                    : "-50%"
              })`,
            }}
          >
            <Readout entry={activeEntry} />
          </div>
        )}

        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="w-full"
          role="group"
          aria-label="Spending by month for this category"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT.left}
                x2={PLOT.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-edge"
                strokeWidth={1}
              />
              <text
                x={PLOT.left - 10}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-chalk-soft font-mono text-label tracking-normal tabular-nums"
              >
                {formatCompactCents(tick)}
              </text>
            </g>
          ))}

          <line
            x1={PLOT.left}
            x2={PLOT.right}
            y1={baseline}
            y2={baseline}
            className="stroke-chalk-soft"
            strokeWidth={1}
          />

          {monthly.map((entry, index) => {
            const path = columnPath({
              x: centreOf(index) - barWidth / 2,
              width: barWidth,
              from: baseline,
              to: y(entry.netCents),
              radius,
            });
            return (
              path && (
                <path
                  key={entry.period}
                  d={path}
                  className={entry.netCents < 0 ? "fill-verdant" : "fill-vermilion"}
                />
              )
            );
          })}

          {activeIndex != null && (
            <line
              x1={centreOf(activeIndex)}
              x2={centreOf(activeIndex)}
              y1={PLOT.top}
              y2={PLOT.bottom}
              className="stroke-chalk-soft"
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          )}

          {labels.map((label) => (
            <text
              key={label.period}
              x={centreOf(label.index)}
              y={PLOT.bottom + 16}
              textAnchor="middle"
              className="fill-chalk-soft font-mono text-label tracking-normal"
            >
              {formatPeriodShort(label.period)}
              {label.year && (
                <tspan x={centreOf(label.index)} dy={13} className="fill-chalk-soft">
                  {label.year}
                </tspan>
              )}
            </text>
          ))}

          {monthly.map((entry, index) => (
            <rect
              key={entry.period}
              ref={(node) => {
                targets.current[index] = node;
              }}
              x={PLOT.left + slot * index}
              y={PLOT.top}
              width={slot}
              height={PLOT_HEIGHT}
              fill="transparent"
              tabIndex={index === (activeIndex ?? lastIndex) ? 0 : -1}
              role="img"
              aria-label={describe(entry)}
              className="cursor-pointer outline-none focus-visible:fill-chalk/5"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
