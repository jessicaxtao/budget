import { BUCKET_SERIES } from "./hooks/useSpendingReport";

/**
 * The arithmetic behind the cashflow diagram: which flows there are, how big
 * each one is, and where it is drawn. A pure module for `chartAxis`' reason —
 * no colour, no wording beyond a node's own name, no ARIA — so the rule that
 * matters can be tested without React in the way.
 *
 * **The rule that matters is conservation.** Every node in the middle passes on
 * exactly what reaches it, and both ends of the diagram add up to the same
 * figure. A diagram that leaked would draw money that does not exist, so the
 * graph is built from the report's own identity rather than from a second walk
 * of the ledger:
 *
 *   netCents = income − Σ netSpent(b)
 *            = income + Σ refunds-beyond-spending − Σ positive netSpent(b)
 *
 * A category whose refunds outweighed its spending has a **negative** net, and a
 * band cannot be drawn with negative width. So it is moved to the side its sign
 * puts it — `stackPaths`' rule, one dimension over — and enters on the left as
 * money that came back, rather than being clamped to zero (which would leave the
 * two ends disagreeing by exactly that refund). Likewise what was left: a window
 * that earned more than it cost ends in **Kept**, and one that cost more than it
 * earned starts with **Spent beyond income**, the gap paid out of what the
 * household already had. Only one of the two can be non-zero.
 *
 * Every figure in and out is cents.
 */

/** The four columns, left to right. */
export const SANKEY_COLUMNS = {
  SOURCE: 0,
  HUB: 1,
  BUCKET: 2,
  CATEGORY: 3,
};

/** Past this many payers the smallest fold into one "Other income" node. */
export const MAX_SOURCES = 5;
/** Past this many categories the smallest fold into one node per bucket. */
export const MAX_CATEGORIES = 12;

const bucketNodeId = (key) => `bucket:${key}`;

/**
 * The nodes and links the report's window describes, or null where no money
 * moved at all — a diagram of nothing would divide by an empty total.
 *
 * @param report       `useSpendingReport`'s result
 * @param payeeName    resolves a payee id to a name, or null; the hook keeps to
 *                     money and the page owns names
 * @param categories   false draws buckets as the last column, for a box too
 *                     narrow for four
 */
export function sankeyFlows(
  report,
  {
    payeeName = () => null,
    categories = true,
    maxSources = MAX_SOURCES,
    maxCategories = MAX_CATEGORIES,
  } = {}
) {
  const nodes = [];
  const links = [];
  const node = (entry) => {
    nodes.push(entry);
    return entry;
  };
  const link = (source, target, valueCents) => {
    if (valueCents > 0) links.push({ source: source.id, target: target.id, valueCents });
  };

  // What actually cost money, and what came back beyond what it cost.
  const spending = report.rows.filter((row) => row.netSpentCents > 0);
  const refundedBeyondCents = report.rows
    .filter((row) => row.netSpentCents < 0)
    .reduce((sum, row) => sum - row.netSpentCents, 0);
  const spentCents = spending.reduce((sum, row) => sum + row.netSpentCents, 0);
  const incomeCents = report.totalIncomeCents;
  const leftCents = incomeCents + refundedBeyondCents - spentCents;
  const keptCents = Math.max(0, leftCents);
  const shortfallCents = Math.max(0, -leftCents);

  const totalCents = incomeCents + refundedBeyondCents + shortfallCents;
  if (totalCents <= 0) return null;

  // ---- Where it came from -------------------------------------------------
  const sources = report.incomeSources.filter((source) => source.incomeCents > 0);
  const shown = sources.length > maxSources ? sources.slice(0, maxSources - 1) : sources;
  const folded = sources.slice(shown.length);
  const hub = {
    id: "hub",
    column: SANKEY_COLUMNS.HUB,
    kind: "hub",
    label: "Money in",
    valueCents: totalCents,
  };

  for (const source of shown) {
    const entry = node({
      id: `source:${source.payeeId ?? "none"}`,
      column: SANKEY_COLUMNS.SOURCE,
      kind: "income",
      label: payeeName(source.payeeId) ?? "No payer named",
      valueCents: source.incomeCents,
    });
    link(entry, hub, entry.valueCents);
  }
  if (folded.length > 0) {
    const entry = node({
      id: "source:other",
      column: SANKEY_COLUMNS.SOURCE,
      kind: "income",
      label: `${folded.length} other payers`,
      valueCents: folded.reduce((sum, source) => sum + source.incomeCents, 0),
    });
    link(entry, hub, entry.valueCents);
  }
  if (refundedBeyondCents > 0) {
    const entry = node({
      id: "source:refunds",
      column: SANKEY_COLUMNS.SOURCE,
      kind: "refund",
      label: "Refunds beyond spending",
      valueCents: refundedBeyondCents,
    });
    link(entry, hub, entry.valueCents);
  }
  if (shortfallCents > 0) {
    const entry = node({
      id: "source:shortfall",
      column: SANKEY_COLUMNS.SOURCE,
      kind: "shortfall",
      label: "Spent beyond income",
      valueCents: shortfallCents,
    });
    link(entry, hub, entry.valueCents);
  }

  node(hub);

  // ---- Where it went --------------------------------------------------------
  if (keptCents > 0) {
    // Ends in the bucket column, beside what was spent, because that is the
    // question it answers: what the money did that was not spending. First in
    // it, because it leads nowhere further, and a node below the buckets
    // would have their bands to the categories cut straight across it.
    const entry = node({
      id: "kept",
      column: SANKEY_COLUMNS.BUCKET,
      kind: "kept",
      label: "Kept",
      valueCents: keptCents,
    });
    link(hub, entry, keptCents);
  }

  // The buckets in the plan's own order, unfiled last — `BUCKET_SERIES`, so the
  // diagram lists them as every other view of the split does.
  const namedIds = categories
    ? new Set(
        [...spending]
          .sort((a, b) => b.netSpentCents - a.netSpentCents)
          .slice(0, maxCategories)
          .map((row) => row.budgetId)
      )
    : new Set();

  for (const series of BUCKET_SERIES) {
    const rows = spending
      .filter((row) => (row.bucket ?? null) === series.bucket)
      .sort((a, b) => b.netSpentCents - a.netSpentCents);
    if (rows.length === 0) continue;

    const bucket = node({
      id: bucketNodeId(series.key),
      column: SANKEY_COLUMNS.BUCKET,
      kind: "bucket",
      bucket: series.bucket,
      label: series.label,
      valueCents: rows.reduce((sum, row) => sum + row.netSpentCents, 0),
    });
    link(hub, bucket, bucket.valueCents);
    if (!categories) continue;

    // The smallest categories fold into one node per bucket rather than one
    // across buckets, so a folded node still says what kind of spending it is
    // and no band has to cross another to reach it. A single leftover is drawn
    // as itself — "1 more" would hide a name to save nothing.
    const named = rows.filter((row) => namedIds.has(row.budgetId));
    const rest = rows.filter((row) => !namedIds.has(row.budgetId));
    const drawn = rest.length === 1 ? [...named, ...rest] : named;
    for (const row of drawn) {
      const entry = node({
        id: `category:${row.budgetId}`,
        column: SANKEY_COLUMNS.CATEGORY,
        kind: "category",
        bucket: series.bucket,
        budgetId: row.budgetId,
        label: row.name,
        valueCents: row.netSpentCents,
      });
      link(bucket, entry, entry.valueCents);
    }
    if (rest.length > 1) {
      const entry = node({
        id: `category:more:${series.key}`,
        column: SANKEY_COLUMNS.CATEGORY,
        kind: "category",
        bucket: series.bucket,
        label: `${rest.length} more`,
        valueCents: rest.reduce((sum, row) => sum + row.netSpentCents, 0),
      });
      link(bucket, entry, entry.valueCents);
    }
  }

  // Left to right, so a table read down the bands reads the diagram across.
  const columnOf = new Map(nodes.map((entry) => [entry.id, entry.column]));
  links.sort((a, b) => columnOf.get(a.source) - columnOf.get(b.source));

  return {
    nodes,
    links,
    columns: categories ? 4 : 3,
    totalCents,
    incomeCents,
    spentCents,
    keptCents,
    shortfallCents,
    refundedBeyondCents,
  };
}

/**
 * Where every node and band is drawn.
 *
 * Every node gets a **slot** at least `minSlot` tall, because each one carries
 * a two-line label and a $40 category beside a $40,000 salary would otherwise
 * be a hairline with its name printed over its neighbour's. The node itself is
 * still drawn at its true height inside the slot — the slot is room for the
 * words, never extra money — so the bands stay exactly as wide as the figures.
 * The scale is then the largest one at which the busiest column still fits.
 *
 * Bands leave a node in the order of what they reach and arrive in the order of
 * where they came from, which is what keeps them from crossing.
 */
export function sankeyLayout(
  graph,
  { left, right, top, height, nodeWidth = 12, gap = 8, minSlot = 28 }
) {
  const columns = Array.from({ length: graph.columns }, () => []);
  for (const entry of graph.nodes) columns[entry.column].push(entry);

  const extent = (column, scale) =>
    column.reduce((sum, entry) => sum + Math.max(entry.valueCents * scale, minSlot), 0) +
    gap * Math.max(0, column.length - 1);

  // The fits are monotone in the scale, so a bisection finds the largest one.
  let low = 0;
  let high = height / Math.max(1, graph.totalCents);
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (columns.every((column) => extent(column, middle) <= height)) low = middle;
    else high = middle;
  }
  const scale = low;

  // Each column starts centred; then, right to left, every node that leads
  // somewhere is moved towards the middle of what it leads to, so a bucket
  // sits beside its own categories rather than its bands crossing its
  // neighbours' labels to reach them. Order within a column never changes —
  // only the gaps do — and the column is kept inside the plot.
  const slotTops = new Map();
  const slotOf = (entry) => Math.max(entry.valueCents * scale, minSlot);
  columns.forEach((column) => {
    let y = top + (height - extent(column, scale)) / 2;
    for (const entry of column) {
      slotTops.set(entry.id, y);
      y += slotOf(entry) + gap;
    }
  });
  const nodeById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  for (let columnIndex = columns.length - 2; columnIndex >= 0; columnIndex -= 1) {
    const column = columns[columnIndex];
    const wanted = column.map((entry) => {
      const outgoing = graph.links.filter((band) => band.source === entry.id);
      const weight = outgoing.reduce((sum, band) => sum + band.valueCents, 0);
      if (weight === 0) return slotTops.get(entry.id);
      const centre =
        outgoing.reduce((sum, band) => {
          const target = nodeById.get(band.target);
          return sum + (slotTops.get(band.target) + slotOf(target) / 2) * band.valueCents;
        }, 0) / weight;
      return centre - slotOf(entry) / 2;
    });
    // Down, pushing each node clear of the one above it…
    const tops = [];
    column.forEach((entry, index) => {
      const floor = index === 0 ? top : tops[index - 1] + slotOf(column[index - 1]) + gap;
      tops.push(Math.max(wanted[index], floor));
    });
    // …then up, pulling the column back inside the bottom of the plot.
    for (let index = column.length - 1; index >= 0; index -= 1) {
      const ceiling =
        index === column.length - 1 ? top + height : tops[index + 1] - gap;
      tops[index] = Math.min(tops[index], ceiling - slotOf(column[index]));
    }
    column.forEach((entry, index) => slotTops.set(entry.id, tops[index]));
  }

  const stride = graph.columns > 1 ? (right - left - nodeWidth) / (graph.columns - 1) : 0;
  const placed = new Map();
  columns.forEach((column, columnIndex) => {
    column.forEach((entry, index) => {
      const y = slotTops.get(entry.id);
      const slot = slotOf(entry);
      const nodeHeight = Math.max(1, entry.valueCents * scale);
      placed.set(entry.id, {
        ...entry,
        index,
        x: left + stride * columnIndex,
        y: y + (slot - nodeHeight) / 2,
        width: nodeWidth,
        height: nodeHeight,
        centre: y + slot / 2,
      });
    });
  });

  const order = (id) => {
    const entry = placed.get(id);
    return entry.column * 1000 + entry.index;
  };
  const outOffset = new Map();
  const inOffset = new Map();
  const bands = graph.links.map((entry) => ({ ...entry, width: entry.valueCents * scale }));
  const bySource = [...bands].sort((a, b) => order(a.target) - order(b.target));
  const byTarget = [...bands].sort((a, b) => order(a.source) - order(b.source));
  for (const band of bySource) {
    const offset = outOffset.get(band.source) ?? 0;
    band.y0 = placed.get(band.source).y + offset;
    outOffset.set(band.source, offset + band.width);
  }
  for (const band of byTarget) {
    const offset = inOffset.get(band.target) ?? 0;
    band.y1 = placed.get(band.target).y + offset;
    inOffset.set(band.target, offset + band.width);
  }
  for (const band of bands) {
    const x0 = placed.get(band.source).x + nodeWidth;
    const x1 = placed.get(band.target).x;
    const mid = (x0 + x1) / 2;
    const w = Math.max(band.width, 0.5);
    band.d =
      `M${x0},${band.y0}C${mid},${band.y0} ${mid},${band.y1} ${x1},${band.y1}` +
      `L${x1},${band.y1 + w}C${mid},${band.y1 + w} ${mid},${band.y0 + w} ${x0},${band.y0 + w}Z`;
  }

  return { nodes: [...placed.values()], bands, scale };
}
