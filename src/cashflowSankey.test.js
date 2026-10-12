import { MAX_CATEGORIES, sankeyFlows, sankeyLayout } from "./cashflowSankey";

/**
 * The diagram's one rule is conservation, so these assert it from outside the
 * module: what reaches every middle node leaves it, both ends add up to the same
 * figure, and that figure is the report's own income and spending — read off the
 * report fixture here rather than off anything the module computed.
 */

const row = (budgetId, bucket, netSpentCents, name = budgetId) => ({
  budgetId,
  name,
  bucket,
  netSpentCents,
});

const report = ({ incomeSources, rows }) => ({
  incomeSources,
  totalIncomeCents: incomeSources.reduce((sum, source) => sum + source.incomeCents, 0),
  rows,
});

function expectConserved(graph) {
  const sum = (bands) => bands.reduce((total, band) => total + band.valueCents, 0);
  for (const node of graph.nodes) {
    const into = graph.links.filter((band) => band.target === node.id);
    const outOf = graph.links.filter((band) => band.source === node.id);
    if (into.length) expect(sum(into)).toBe(node.valueCents);
    if (outOf.length) expect(sum(outOf)).toBe(node.valueCents);
  }
  const ends = (side) =>
    graph.nodes
      .filter((node) =>
        side === "left"
          ? !graph.links.some((band) => band.target === node.id)
          : !graph.links.some((band) => band.source === node.id)
      )
      .reduce((total, node) => total + node.valueCents, 0);
  expect(ends("left")).toBe(graph.totalCents);
  expect(ends("right")).toBe(graph.totalCents);
}

test("income starts the diagram, with who paid it carried on the node", () => {
  const graph = sankeyFlows(
    report({
      incomeSources: [
        { payeeId: "employer", incomeCents: 400000 },
        { payeeId: null, incomeCents: 100000 },
      ],
      rows: [row("rent", "essentials", 200000), row("fun", "fun", 50000)],
    }),
    { payeeName: (id) => (id === "employer" ? "Acme" : null) }
  );

  expectConserved(graph);
  const income = graph.nodes[0];
  expect(income).toMatchObject({ id: "income", column: 0, label: "Income", valueCents: 500000 });
  expect(income.payers).toEqual([
    { label: "Acme", valueCents: 400000 },
    { label: "No payer named", valueCents: 100000 },
  ]);
  // Nothing else is on the left in an ordinary window.
  expect(graph.nodes.filter((node) => node.column === 0)).toHaveLength(1);
  expect(graph.nodes.find((node) => node.id === "kept").valueCents).toBe(250000);
});

test("a window that spent more than it earned draws the gap under income, against the last buckets", () => {
  const graph = sankeyFlows(
    report({
      incomeSources: [{ payeeId: null, incomeCents: 100000 }],
      rows: [row("rent", "essentials", 120000), row("fun", "fun", 60000)],
    })
  );

  expectConserved(graph);
  expect(graph.nodes.find((node) => node.kind === "shortfall").valueCents).toBe(80000);
  expect(graph.nodes.some((node) => node.id === "kept")).toBe(false);
  // Income pays for what comes first in the plan's order; the gap meets the rest.
  expect(graph.links.filter((band) => band.source !== "bucket:essentials" && band.source !== "bucket:fun")).toEqual([
    { source: "income", target: "bucket:essentials", valueCents: 100000 },
    { source: "shortfall", target: "bucket:essentials", valueCents: 20000 },
    { source: "shortfall", target: "bucket:fun", valueCents: 60000 },
  ]);
});

test("a category refunded more than it spent enters on the left instead of being clamped", () => {
  const graph = sankeyFlows(
    report({
      incomeSources: [{ payeeId: "employer", incomeCents: 100000 }],
      rows: [row("rent", "essentials", 60000), row("travel", "fun", -15000)],
    })
  );

  expectConserved(graph);
  expect(graph.nodes.find((node) => node.kind === "refund").valueCents).toBe(15000);
  // Kept is the report's own net: income less every category's net spend.
  expect(graph.keptCents).toBe(100000 - (60000 - 15000));
  expect(graph.nodes.some((node) => node.id === "category:travel")).toBe(false);
});

test("a window with no income still starts with it, at nothing", () => {
  const graph = sankeyFlows(
    report({ incomeSources: [], rows: [row("rent", "essentials", 50000)] })
  );

  expectConserved(graph);
  expect(graph.nodes[0]).toMatchObject({ id: "income", valueCents: 0 });
  expect(graph.nodes.find((node) => node.kind === "shortfall").valueCents).toBe(50000);
});

test("the smallest categories fold into one node per bucket, and nothing is lost", () => {
  const rows = Array.from({ length: MAX_CATEGORIES + 4 }, (_, index) =>
    row(`c${index}`, index % 2 ? "fun" : "essentials", 10000 - index * 100)
  );
  const graph = sankeyFlows(
    report({ incomeSources: [{ payeeId: "employer", incomeCents: 200000 }], rows })
  );

  expectConserved(graph);
  const categories = graph.nodes.filter((node) => node.kind === "category");
  expect(categories.filter((node) => node.label.endsWith("more"))).toHaveLength(2);
  expect(categories.length).toBe(MAX_CATEGORIES + 2);
});

test("a narrow box ends at the buckets", () => {
  const graph = sankeyFlows(
    report({
      incomeSources: [{ payeeId: "p", incomeCents: 80000 }],
      rows: [row("rent", "essentials", 50000)],
    }),
    { categories: false }
  );

  expectConserved(graph);
  expect(graph.columns).toBe(2);
  expect(graph.nodes.some((node) => node.kind === "category")).toBe(false);
});

test("no money moving is no diagram, rather than a division by nothing", () => {
  expect(sankeyFlows(report({ incomeSources: [], rows: [] }))).toBeNull();
});

test("bands are as wide as their money, and fill each node exactly", () => {
  const graph = sankeyFlows(
    report({
      incomeSources: [
        { payeeId: "a", incomeCents: 300000 },
        { payeeId: "b", incomeCents: 100 },
      ],
      rows: [row("rent", "essentials", 200000), row("gum", "fun", 50)],
    })
  );
  const layout = sankeyLayout(graph, { left: 100, right: 600, top: 20, height: 260 });

  for (const node of layout.nodes) {
    expect(Number.isFinite(node.y)).toBe(true);
    expect(node.y).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(node.y + node.height).toBeLessThanOrEqual(280 + 1e-9);
  }
  for (const band of layout.bands) {
    expect(band.width).toBeCloseTo(band.valueCents * layout.scale);
    expect(band.d).not.toMatch(/NaN/);
  }
  // Every band leaving income sits inside it, top to bottom without a gap.
  const income = layout.nodes.find((node) => node.id === "income");
  const leaving = layout.bands.filter((band) => band.source === "income").sort((a, b) => a.y0 - b.y0);
  expect(leaving[0].y0).toBeCloseTo(income.y);
  const lastBand = leaving[leaving.length - 1];
  expect(lastBand.y0 + lastBand.width).toBeCloseTo(income.y + income.height);
});
