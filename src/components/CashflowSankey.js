import { useMemo, useRef, useState } from "react";
import { bucketTone } from "../bucketTones";
import { sankeyFlows, sankeyLayout } from "../cashflowSankey";
import useChartWidth from "../hooks/useChartWidth";
import { formatCents, formatCompactCents } from "../utils";

/**
 * Where the window's money came from and where it went, as one picture.
 *
 * The other two charts on the page are the time axis; this is the window
 * collapsed to a single flow: who paid the household, into one pool, out to the
 * plan's buckets, and on to the categories inside them. It answers the question
 * the ranking table answers — where did it go — with the one thing a table
 * cannot show, which is the *proportion* of the whole each answer is. A band's
 * width is its money, on one scale, end to end.
 *
 * **It conserves, by construction** (`src/cashflowSankey.js`): both ends add up
 * to the same figure, the pool passes on exactly what reached it, and what was
 * not spent ends in **Kept** rather than vanishing — or, in a window that cost
 * more than it earned, enters as **Spent beyond income**, so the gap is drawn
 * rather than hidden. A category refunded more than it spent enters on the left
 * as money that came back, the side its sign puts it.
 *
 * Colour carries kind, never identity: income is `verdant` as it is in the
 * register, the buckets wear `bucketTones`' four as every other view of the split
 * does, and every node is labelled with its name and figure, so nothing here is
 * read off a colour alone. The table twin under it carries every band as a row.
 */

const BASE_HEIGHT = 300;
const PAD = { top: 22, bottom: 10 };
// Width below which four columns of labels no longer fit, and the categories
// are left to the table under the chart.
const COMPACT_WIDTH = 560;
// The mono face at `text-label` is close to this wide per character.
const CHAR_WIDTH = 6.7;

/** Classes for a node and the bands leaving or reaching it, by kind. Whole
 *  class names only — see `bucketTones` for why. */
function toneOf(node) {
  switch (node.kind) {
    case "income":
      return { fill: "fill-verdant", swatch: "bg-verdant" };
    case "shortfall":
      return { fill: "fill-vermilion", swatch: "bg-vermilion" };
    case "refund":
      return { fill: "fill-chalk-soft", swatch: "bg-chalk-soft" };
    case "hub":
    case "kept":
      return { fill: "fill-chalk", swatch: "bg-chalk" };
    default:
      return bucketTone(node.bucket);
  }
}

/** The band takes the colour of the end that says what kind of money it is:
 *  where it came from on the way in, where it went on the way out. */
const bandTone = (band, byId) =>
  toneOf(band.source === "hub" ? byId.get(band.target) : byId.get(band.source));

function clip(text, chars) {
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
}

const share = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

function describe(node, graph) {
  return `${node.label}: ${formatCents(node.valueCents)}, ${share(
    node.valueCents,
    graph.totalCents
  )} of the money in`;
}

/** The focused node's figures and every band touching it. */
function Readout({ node, graph, byId }) {
  const into = graph.links.filter((band) => band.target === node.id);
  const outOf = graph.links.filter((band) => band.source === node.id);
  const rows = [
    ...into.map((band) => ({ key: `in-${band.source}`, word: "from", other: byId.get(band.source), band })),
    ...outOf.map((band) => ({ key: `out-${band.target}`, word: "to", other: byId.get(band.target), band })),
  ];
  // A node with a single band in and out says nothing a second time.
  const listed = rows.length > 1 ? rows : [];

  return (
    <div className="pointer-events-none w-max max-w-[20rem] border border-edge bg-ledger px-3 py-2 shadow-lg shadow-black/50">
      <div className="font-mono text-label uppercase text-chalk-soft">{node.label}</div>
      <div className="mt-0.5 font-sans text-base font-semibold tabular-nums text-chalk">
        {formatCents(node.valueCents)}
        <span className="ml-2 font-mono text-label font-normal text-chalk-soft">
          {share(node.valueCents, graph.totalCents)} of money in
        </span>
      </div>
      {listed.length > 0 && (
        <dl className="mt-1.5 space-y-0.5 border-t border-edge pt-1.5">
          {listed.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 ${toneOf(row.other).swatch}`} aria-hidden="true" />
              <dt className="font-sans text-row text-chalk-soft">
                {row.word} {row.other.label}
              </dt>
              <dd className="ml-auto pl-4 font-mono text-row tabular-nums text-chalk">
                {formatCents(row.band.valueCents)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function CashflowSankey({ report, payeeName }) {
  const box = useRef(null);
  const width = useChartWidth(box);
  const compact = width < COMPACT_WIDTH;
  const [activeId, setActiveId] = useState(null);
  const targets = useRef(new Map());

  const graph = useMemo(
    () => sankeyFlows(report, { payeeName, categories: !compact }),
    [report, payeeName, compact]
  );

  if (!graph) {
    return (
      <p className="px-4 py-5 font-sans text-row text-chalk-soft">
        No money came in or went out in this window, so there is nothing to draw.
      </p>
    );
  }

  const padLeft = compact ? 92 : 124;
  const padRight = compact ? 96 : 136;
  const busiest = Math.max(
    ...Array.from(
      { length: graph.columns },
      (_, column) => graph.nodes.filter((node) => node.column === column).length
    )
  );
  const plotHeight = Math.max(BASE_HEIGHT - PAD.top - PAD.bottom, busiest * 36);
  const height = plotHeight + PAD.top + PAD.bottom;
  const layout = sankeyLayout(graph, {
    left: padLeft,
    right: width - padRight,
    top: PAD.top,
    height: plotHeight,
  });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const lastColumn = graph.columns - 1;
  const leftChars = Math.floor((padLeft - 10) / CHAR_WIDTH);
  const rightChars = Math.floor((padRight - 10) / CHAR_WIDTH);
  const stride = (width - padRight - padLeft) / Math.max(1, lastColumn);
  const middleChars = Math.floor((stride - 24) / CHAR_WIDTH);

  // Nodes in reading order: down each column, then across.
  const order = [...layout.nodes].sort((a, b) => a.column - b.column || a.index - b.index);
  const active = activeId != null ? byId.get(activeId) ?? null : null;
  const touches = (band) => active && (band.source === active.id || band.target === active.id);

  function handleKeyDown(event, index) {
    const move = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
      Home: -index,
      End: order.length - 1 - index,
    }[event.key];
    if (move == null) return;
    event.preventDefault();
    const next = order[Math.max(0, Math.min(order.length - 1, index + move))];
    targets.current.get(next.id)?.focus();
  }

  const headings = compact
    ? ["Came from", "", "Went to"]
    : ["Came from", "", "Went to", "Category"];

  return (
    <div className="px-2 pb-2 pt-1">
      <div ref={box} className="relative">
        {active && (
          <div
            className="absolute z-10"
            style={{
              top: `${((active.y + active.height) / height) * 100}%`,
              left: `${((active.x + active.width / 2) / width) * 100}%`,
              transform: `translate(${
                active.column === 0 ? "0" : active.column === lastColumn ? "-100%" : "-50%"
              }, 6px)`,
            }}
          >
            <Readout node={active} graph={graph} byId={byId} />
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          role="group"
          aria-label="Where the money came from and where it went"
        >
          {headings.map((heading, column) =>
            heading ? (
              <text
                key={heading}
                x={padLeft + stride * column + (column === 0 ? 12 : 0)}
                y={11}
                textAnchor={column === 0 ? "end" : "start"}
                className="fill-chalk-soft font-mono text-label uppercase tracking-normal"
              >
                {heading}
              </text>
            ) : null
          )}

          {layout.bands.map((band) => (
            <path
              key={`${band.source}>${band.target}`}
              d={band.d}
              className={bandTone(band, byId).fill}
              fillOpacity={active ? (touches(band) ? 0.55 : 0.08) : 0.3}
              data-source={band.source}
              data-target={band.target}
            />
          ))}

          {order.map((node, index) => {
            const tone = toneOf(node);
            const first = node.column === 0;
            const last = node.column === lastColumn;
            const chars = first ? leftChars : last ? rightChars : middleChars;
            const x = first ? node.x - 6 : node.x + node.width + 6;
            return (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={2}
                  className={tone.fill}
                />
                <text
                  x={x}
                  y={node.centre - 2}
                  textAnchor={first ? "end" : "start"}
                  // A label in the middle sits over the bands; the halo in the
                  // card's own colour keeps it legible across them.
                  paintOrder="stroke"
                  strokeWidth={first || last ? 0 : 3}
                  strokeLinejoin="round"
                  className="fill-chalk stroke-panel font-sans text-label tracking-normal"
                >
                  {clip(node.label, chars)}
                  <tspan
                    x={x}
                    dy={12}
                    className="fill-chalk-soft font-mono tabular-nums"
                  >
                    {formatCompactCents(node.valueCents)}
                  </tspan>
                </text>
                {/* The hit area is the node's whole slot and its label, so the
                    target is the name the reader is looking at rather than a
                    sliver of colour. */}
                <rect
                  ref={(element) => {
                    if (element) targets.current.set(node.id, element);
                    else targets.current.delete(node.id);
                  }}
                  x={first ? node.x - padLeft + 8 : node.x - 2}
                  y={node.centre - 14}
                  width={first ? padLeft - 4 : Math.min(stride, padRight) - 4}
                  height={28}
                  fill="transparent"
                  role="img"
                  aria-label={describe(node, graph)}
                  tabIndex={node.id === (activeId ?? order[0].id) ? 0 : -1}
                  className="cursor-pointer outline-none focus-visible:fill-chalk/5"
                  onMouseEnter={() => setActiveId(node.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(node.id)}
                  onBlur={() => setActiveId(null)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
