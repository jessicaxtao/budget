import { useState } from "react";
import { bucketTone } from "../bucketTones";
import { BUCKET_SERIES } from "../hooks/useSpendingReport";
import { formatCents } from "../utils";

/**
 * Spending breakdown by category over the report window, as a donut chart.
 *
 * Each slice is one category, sized by net spending, colored by bucket so the
 * proportions across Essentials / Fun / Savings / Retirement are still readable
 * as a shape. The legend groups categories by bucket, showing amount and share
 * for each. Categories with zero or negative net spending (bucket refunded more
 * than it spent) are excluded.
 *
 * The Sankey on the same section traces the full flow from payer to category;
 * this answers the proportion question faster, at the cost of the "who paid it"
 * context the Sankey carries.
 */

const CX = 100;
const CY = 100;
const OUTER_R = 82;
const INNER_R = 50;
const GAP = 0.018; // radians of gap between slices

function r1(v) {
  return Math.round(v * 10) / 10;
}

function arcPath(startAngle, sweepAngle) {
  if (sweepAngle >= 2 * Math.PI * 0.999) {
    const mid = startAngle + Math.PI;
    return (
      arcPath(startAngle, Math.PI - 0.001) + " " + arcPath(mid, Math.PI - 0.001)
    );
  }
  const endAngle = startAngle + sweepAngle;
  const large = sweepAngle > Math.PI ? 1 : 0;
  const ox1 = CX + OUTER_R * Math.cos(startAngle);
  const oy1 = CY + OUTER_R * Math.sin(startAngle);
  const ox2 = CX + OUTER_R * Math.cos(endAngle);
  const oy2 = CY + OUTER_R * Math.sin(endAngle);
  const ix1 = CX + INNER_R * Math.cos(endAngle);
  const iy1 = CY + INNER_R * Math.sin(endAngle);
  const ix2 = CX + INNER_R * Math.cos(startAngle);
  const iy2 = CY + INNER_R * Math.sin(startAngle);
  return [
    `M${r1(ox1)},${r1(oy1)}`,
    `A${OUTER_R},${OUTER_R} 0 ${large},1 ${r1(ox2)},${r1(oy2)}`,
    `L${r1(ix1)},${r1(iy1)}`,
    `A${INNER_R},${INNER_R} 0 ${large},0 ${r1(ix2)},${r1(iy2)}`,
    "Z",
  ].join(" ");
}

export default function SpendingDonutChart({ report }) {
  const [activeKey, setActiveKey] = useState(null);

  // Categories with positive net spending, in the ranked order the report uses.
  const slices = report.rows
    .filter((row) => row.netSpentCents > 0)
    .map((row) => ({
      key: row.budgetId,
      label: row.name,
      bucket: row.bucket,
      groupName: row.groupName,
      tone: bucketTone(row.bucket),
      totalCents: row.netSpentCents,
    }));

  const totalCents = slices.reduce((sum, s) => sum + s.totalCents, 0);

  if (totalCents === 0) {
    return (
      <p className="px-4 py-5 font-sans text-row text-chalk-soft">
        No spending in this window, so there is nothing to draw.
      </p>
    );
  }

  const gapCount = slices.length > 1 ? slices.length : 0;
  const availableAngle = 2 * Math.PI - gapCount * GAP;

  let angle = -Math.PI / 2 + (gapCount > 0 ? GAP / 2 : 0);
  const arcs = slices.map((slice) => {
    const sweep = (slice.totalCents / totalCents) * availableAngle;
    const d = arcPath(angle, sweep);
    const arc = { ...slice, d };
    angle += sweep + GAP;
    return arc;
  });

  // Group slices by bucket for the legend, preserving bucket order.
  const bucketOrder = BUCKET_SERIES.map((b) => b.bucket);
  const byBucket = new Map(bucketOrder.map((b) => [b, []]));
  const unfiled = [];
  for (const arc of arcs) {
    if (arc.bucket != null && byBucket.has(arc.bucket)) {
      byBucket.get(arc.bucket).push(arc);
    } else {
      unfiled.push(arc);
    }
  }

  // Legend sections: each bucket that has at least one slice, then unfiled.
  const legendSections = [
    ...BUCKET_SERIES.filter((b) => (byBucket.get(b.bucket) ?? []).length > 0).map((b) => ({
      key: b.key,
      label: b.label,
      tone: bucketTone(b.bucket),
      rows: byBucket.get(b.bucket),
    })),
    ...(unfiled.length > 0
      ? [{ key: "unfiled", label: "No category", tone: bucketTone(null), rows: unfiled }]
      : []),
  ];

  return (
    <div className="flex flex-col items-start gap-6 px-4 py-4 sm:flex-row">
      {/* Donut */}
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 200 200"
          className="h-64 w-64"
          role="group"
          aria-label="Spending by category"
        >
          {arcs.map((arc) => (
            <path
              key={arc.key}
              d={arc.d}
              className={arc.tone.fill}
              style={{
                fillOpacity: activeKey == null ? 0.85 : arc.key === activeKey ? 1 : 0.15,
                transition: "fill-opacity 120ms",
                cursor: "pointer",
              }}
              role="img"
              aria-label={`${arc.label}: ${formatCents(arc.totalCents)}, ${Math.round((arc.totalCents / totalCents) * 100)}%`}
              tabIndex={0}
              onMouseEnter={() => setActiveKey(arc.key)}
              onMouseLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(arc.key)}
              onBlur={() => setActiveKey(null)}
            />
          ))}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-sm font-medium tabular-nums text-chalk">
            {formatCents(totalCents)}
          </span>
          <span className="font-mono text-label uppercase text-chalk-soft">spent</span>
        </div>
      </div>

      {/* Legend grouped by bucket */}
      <div className="min-w-0 flex-1 space-y-3">
        {legendSections.map((section) => (
          <div key={section.key}>
            {/* Bucket heading */}
            <div className="mb-1 flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 ${section.tone.swatch}`} aria-hidden="true" />
              <span className="font-mono text-label uppercase text-chalk-soft">
                {section.label}
              </span>
            </div>
            {/* Category rows in this bucket */}
            <dl className="space-y-0.5">
              {section.rows.map((arc) => {
                const pct = Math.round((arc.totalCents / totalCents) * 100);
                const dimmed = activeKey != null && activeKey !== arc.key;
                return (
                  <div
                    key={arc.key}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 transition-opacity ${
                      activeKey === arc.key ? "bg-panel-raised" : ""
                    } ${dimmed ? "opacity-30" : ""}`}
                    onMouseEnter={() => setActiveKey(arc.key)}
                    onMouseLeave={() => setActiveKey(null)}
                  >
                    <dt className="min-w-0 truncate font-sans text-row text-chalk">
                      {arc.label}
                    </dt>
                    <dd className="ml-auto shrink-0 pl-3 font-mono text-row tabular-nums text-chalk">
                      {formatCents(arc.totalCents)}
                    </dd>
                    <span className="w-8 shrink-0 text-right font-mono text-label tabular-nums text-chalk-soft">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
