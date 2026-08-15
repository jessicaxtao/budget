import { fireEvent, render, screen } from "@testing-library/react";
import NetWorthChart from "./NetWorthChart";
import { HOLDING_CLASSES, SPENDING_SLICE } from "../hooks/useNetWorth";
import { addMonths, formatPeriod } from "../utils";

/**
 * The chart's geometry, which is the part of it no page test can see: a
 * screenshot shows that something was drawn, and these assert that what was
 * drawn is finite, covers every month, sits on the right side of the baseline,
 * and is reachable without a pointer.
 *
 * A pure component, so this one takes props directly rather than going through
 * the providers — there is no store involved, and the shape it consumes is
 * asserted against the real hook in `useNetWorth.test.js`.
 */
const SLICES = [
  { key: SPENDING_SLICE, label: "Spending accounts", band: HOLDING_CLASSES.CASH },
  { key: "acc-401k", label: "401(k)", band: HOLDING_CLASSES.INVESTED },
  { key: "acc-house", label: "House", band: HOLDING_CLASSES.PROPERTY },
  { key: "acc-mortgage", label: "Mortgage", band: HOLDING_CLASSES.DEBT },
];

const entry = (period, over = {}) => {
  const values = Object.fromEntries(SLICES.map((slice) => [slice.key, over[slice.key] ?? 0]));
  return {
    period,
    values,
    netCents: Object.values(values).reduce((sum, cents) => sum + cents, 0),
  };
};

const monthsTo = (last, count, build = () => ({})) =>
  Array.from({ length: count }, (_, index) =>
    entry(addMonths(last, -(count - 1 - index)), build(index))
  );

const draw = (series, slices = SLICES) => render(<NetWorthChart series={series} slices={slices} />);

const paths = (container) =>
  [...container.querySelectorAll("path")].map((node) => node.getAttribute("d"));

/** Every coordinate in a path, so a segment's reach either side of the baseline
 *  can be read off it. SVG y grows downward, so smaller is higher. */
const pointsIn = (d) => {
  const numbers = d.match(/-?[\d.]+/g).map(Number);
  return numbers.filter((_, index) => index % 2 === 1);
};
const topOf = (d) => Math.min(...pointsIn(d));
const bottomOf = (d) => Math.max(...pointsIn(d));

test("draws only finite coordinates, so no month renders as a broken path", () => {
  const series = monthsTo("2026-08", 12, (index) => ({
    [SPENDING_SLICE]: 100000 + index * 1000,
    "acc-401k": 5000000 + index * 90000,
    "acc-house": 40000000,
    "acc-mortgage": -30000000 + index * 60000,
  }));

  const { container } = draw(series);

  const drawn = paths(container);
  expect(drawn.length).toBeGreaterThan(0);
  for (const d of drawn) expect(d).not.toMatch(/NaN|Infinity|undefined/);
  for (const node of container.querySelectorAll("line, circle, polyline, text")) {
    expect(node.outerHTML).not.toMatch(/NaN|Infinity/);
  }
});

test("an all-zero file draws no columns rather than dividing by an empty domain", () => {
  // Every account at zero gives the scale nothing to span. The guard matters:
  // without it every value maps to the same pixel and every coordinate is NaN.
  const { container } = draw(monthsTo("2026-08", 12));

  expect(paths(container)).toHaveLength(0);
  for (const node of container.querySelectorAll("line, polyline, circle")) {
    expect(node.outerHTML).not.toMatch(/NaN/);
  }
});

test("a slice is drawn on the side its own figure puts it, not the side its kind suggests", () => {
  // The spending band is net negative this month — the cards outweigh the cash.
  // Counting it as an asset because it is the cash band would overstate what is
  // owned and understate what is owed, while leaving the net right, which is the
  // worst of the three.
  const series = monthsTo("2026-08", 12, () => ({
    [SPENDING_SLICE]: -100000,
    "acc-401k": 500000,
  }));
  const { container } = draw(series);

  // Two segments a month: the holding above the baseline, the spending band
  // below it. Both start at the baseline, so the one that reaches higher is the
  // one drawn up and the one that reaches lower is the one drawn down.
  const [up, down] = paths(container);
  expect(topOf(up)).toBeLessThan(topOf(down));
  expect(bottomOf(down)).toBeGreaterThan(bottomOf(up));
});

test("every month is reachable and readable without a pointer", () => {
  const series = monthsTo("2026-08", 12, () => ({
    [SPENDING_SLICE]: 500000,
    "acc-mortgage": -100000,
  }));
  draw(series);

  // One hit target per month, each naming its own figures — the keyboard and
  // the screen reader get what the hover does.
  const targets = screen.getAllByRole("img");
  expect(targets).toHaveLength(12);
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining(formatPeriod("2026-08")));
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("$4,000"));
  // By its own name, not by the band it happens to sit in.
  expect(targets[11]).toHaveAccessibleName(expect.stringContaining("Spending accounts"));
});

test("the arrows walk the months, so a decade is one tab stop and not a hundred and twenty", () => {
  const series = monthsTo("2026-08", 12, () => ({ [SPENDING_SLICE]: 500000 }));
  draw(series);

  const targets = screen.getAllByRole("img");
  // Exactly one month is in the tab order, and it is the one the reader came
  // for. Twelve stops would be tedious; a hundred and twenty would be a trap.
  expect(targets.filter((node) => node.getAttribute("tabindex") === "0")).toHaveLength(1);
  expect(targets[11]).toHaveAttribute("tabindex", "0");

  fireEvent.focusIn(targets[11]);
  fireEvent.keyDown(targets[11], { key: "ArrowLeft" });
  expect(targets[10]).toHaveFocus();

  fireEvent.keyDown(targets[10], { key: "Home" });
  expect(targets[0]).toHaveFocus();
});

test("focus opens the same read-out as hover, so the tooltip gates nothing", () => {
  const series = monthsTo("2026-08", 12, () => ({
    [SPENDING_SLICE]: 500000,
    "acc-401k": 250000,
  }));
  draw(series);

  expect(screen.queryByText(formatPeriod("2026-04"))).not.toBeInTheDocument();

  fireEvent.focusIn(screen.getAllByRole("img")[7]);

  expect(screen.getByText(formatPeriod("2026-04"))).toBeInTheDocument();
  expect(screen.getByText("$7,500")).toBeInTheDocument();
});

test("a slice with nothing in it is left out of the read-out rather than shown as zero", () => {
  const series = monthsTo("2026-08", 12, () => ({ [SPENDING_SLICE]: 500000 }));
  draw(series);

  fireEvent.focusIn(screen.getAllByRole("img")[11]);

  // The legend always names every series; the read-out only names the ones this
  // month actually holds — so an empty one appears once (legend) and a filled
  // one appears twice.
  expect(screen.getAllByText("Spending accounts")).toHaveLength(2);
  expect(screen.getAllByText("401(k)")).toHaveLength(1);
});

test("the legend names every series, which is what carries identity when colour cannot", () => {
  draw(monthsTo("2026-08", 12, () => ({ [SPENDING_SLICE]: 1 })));

  for (const label of ["Spending accounts", "401(k)", "House", "Mortgage", "Net worth"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

test("a decade thins the month labels instead of printing a hundred and twenty", () => {
  const { container } = draw(monthsTo("2026-08", 120, () => ({ [SPENDING_SLICE]: 500000 })));

  // The month labels, as against the axis ticks, which are money.
  const months = [...container.querySelectorAll("text")].filter((node) =>
    /^[A-Z][a-z]{2}/.test(node.textContent)
  );

  expect(months.length).toBeLessThanOrEqual(14);
  expect(months.length).toBeGreaterThan(4);
  // Counted back from the most recent, so the month the reader came for is
  // always the one named at the right-hand edge.
  expect(months[months.length - 1].textContent).toContain("Aug");
  expect(months[months.length - 1].textContent).toContain("2026");
});
