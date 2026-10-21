import { useRef, useState } from "react";
import useChartWidth from "../hooks/useChartWidth";
import { axisLabels, axisTicks, chartFrame, labelBudget, lineRuns } from "../chartAxis";
import {
  formatCents,
  formatCompactCents,
  formatPeriod,
  formatPeriodShort,
  periodLTE,
} from "../utils";

/**
 * Income, spending, and net traced as three lines over the report window.
 *
 * All three are shown as their natural magnitudes on one scale, so the visual
 * gap between the income and spending lines *is* the net — a reader can see
 * whether the household came out ahead without reading the net line at all, and
 * when the spending line crosses above income the net dips below zero. The bar
 * chart on the same section answers "how much came in and went out each month";
 * this one answers "which way were things trending, and by how much".
 *
 * Coverage breaks the lines the same way the bar chart uses it: a month before
 * the first record or past today carries no data, and a line through it would
 * assert a reading nobody took.
 */

const VIEW = { width: 760, height: 300 };
const PAD = { top: 18, right: 54, bottom: 34, left: 66 };
const PLOT = {
  top: PAD.top,
  bottom: VIEW.height - PAD.bottom,
};
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

const LINES = [
  {
    key: "income",
    label: "Income",
    swatch: "bg-verdant",
    fill: "fill-verdant",
    stroke: "stroke-verdant",
    get: (e) => e.incomeCents,
  },
  {
    key: "spending",
    label: "Spending",
    swatch: "bg-vermilion",
    fill: "fill-vermilion",
    stroke: "stroke-vermilion",
    get: (e) => e.netSpentCents,
  },
  {
    key: "net",
    label: "Net",
    swatch: null,
    fill: "fill-chalk",
    stroke: "stroke-chalk",
    get: (e) => e.netCents,
  },
];

function scaleFor(series) {
  let high = 0;
  let low = 0;
  for (const entry of series) {
    // Income and spending are always ≥ 0; net can be negative.
    high = Math.max(high, entry.incomeCents, entry.netSpentCents);
    low = Math.min(low, entry.netCents);
  }
  const { min, max, ticks } = axisTicks(low, high);
  const y = (cents) => PLOT.bottom - ((cents - min) / (max - min)) * PLOT_HEIGHT;
  return { y, ticks };
}

function describe(entry) {
  return `${formatPeriod(entry.period)}: income ${formatCents(entry.incomeCents)}, spending ${formatCents(entry.netSpentCents)}, net ${formatCents(entry.netCents)}`;
}

function Readout({ entry }) {
  return (
    <div className="pointer-events-none w-max max-w-[18rem] rounded-lg border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">
        {formatPeriod(entry.period)}
      </div>
      <div
        className={`mt-0.5 font-sans text-base font-semibold tabular-nums ${
          entry.netCents < 0 ? "text-vermilion" : "text-chalk"
        }`}
      >
        {formatCents(entry.netCents)} net
      </div>
      <dl className="mt-1.5 space-y-0.5 border-t border-edge pt-1.5">
        {LINES.filter((l) => l.key !== "net" && l.get(entry) !== 0).map((line) => (
          <div key={line.key} className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 ${line.swatch}`} aria-hidden="true" />
            <dt className="font-sans text-row text-chalk-soft">{line.label}</dt>
            <dd className="ml-auto pl-4 font-mono text-row tabular-nums text-chalk">
              {formatCents(line.get(entry))}
            </dd>
          </div>
        ))}
        {entry.refundCents > 0 && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="h-2 w-2 shrink-0" aria-hidden="true" />
            <dt className="font-sans text-row text-chalk-soft">
              after {formatCents(entry.refundCents)} refunded
            </dt>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function CashflowLineChart({
  series,
  coverageStartPeriod = null,
  coverageEndPeriod = null,
}) {
  const box = useRef(null);
  const { view, plot, plotWidth } = chartFrame({
    width: useChartWidth(box),
    height: VIEW.height,
    pad: PAD,
  });
  const [active, setActive] = useState(null);
  const targets = useRef([]);

  const { y, ticks } = scaleFor(series);
  const slot = plotWidth / series.length;
  const centreOf = (index) => plot.left + slot * (index + 0.5);
  const lastIndex = series.length - 1;

  const covered = (period) =>
    (coverageStartPeriod == null || periodLTE(coverageStartPeriod, period)) &&
    (coverageEndPeriod == null || periodLTE(period, coverageEndPeriod));

  const linePaths = LINES.map((line) =>
    lineRuns(
      series.map((e) => (covered(e.period) ? line.get(e) : null)),
      { x: centreOf, y }
    )
  );

  const baseline = y(0);
  const labels = axisLabels(series.map((e) => e.period), labelBudget(plotWidth));
  const activeEntry = active != null && active <= lastIndex ? series[active] : null;
  const activeIndex = activeEntry ? active : null;

  function handleKeyDown(event, index) {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: lastIndex - index }[
      event.key
    ];
    if (move == null) return;
    event.preventDefault();
    targets.current[Math.max(0, Math.min(lastIndex, index + move))]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3">
        {LINES.map((line) => (
          <span key={line.key} className="flex items-center gap-1.5">
            {line.swatch ? (
              <span className={`h-2 w-2 shrink-0 ${line.swatch}`} aria-hidden="true" />
            ) : (
              <span className="h-0.5 w-4 shrink-0 bg-chalk" aria-hidden="true" />
            )}
            <span className="font-mono text-label uppercase text-chalk-soft">{line.label}</span>
          </span>
        ))}
      </div>

      <div className="px-2 pb-2 pt-1">
        <div ref={box} className="relative">
          {activeEntry && (
            <div
              className="absolute top-0 z-10"
              style={{
                left: `${(centreOf(activeIndex) / view.width) * 100}%`,
                transform: `translateX(${
                  activeIndex > series.length * 0.65
                    ? "-100%"
                    : activeIndex < series.length * 0.35
                      ? "0"
                      : "-50%"
                })`,
              }}
            >
              <Readout entry={activeEntry} />
            </div>
          )}

          <svg
            viewBox={`0 0 ${view.width} ${view.height}`}
            className="w-full"
            role="group"
            aria-label="Income and spending trends by month"
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

            <line
              x1={plot.left}
              x2={plot.right}
              y1={baseline}
              y2={baseline}
              className="stroke-chalk-soft"
              strokeWidth={1}
            />

            {linePaths.map((runs, li) =>
              runs.map((points, ri) => (
                <polyline
                  key={`${LINES[li].key}-${ri}`}
                  points={points}
                  fill="none"
                  className={LINES[li].stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            )}

            {activeEntry &&
              LINES.map((line) => {
                if (!covered(activeEntry.period)) return null;
                return (
                  <circle
                    key={line.key}
                    cx={centreOf(activeIndex)}
                    cy={y(line.get(activeEntry))}
                    r={3.5}
                    className={`${line.fill} stroke-panel`}
                    strokeWidth={2}
                  />
                );
              })}

            {labels.map((label) => (
              <text
                key={label.period}
                x={centreOf(label.index)}
                y={plot.bottom + 16}
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

            {series.map((entry, index) => (
              <rect
                key={entry.period}
                ref={(node) => {
                  targets.current[index] = node;
                }}
                x={plot.left + slot * index}
                y={plot.top}
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
    </div>
  );
}
