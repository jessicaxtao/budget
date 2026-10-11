import { act, fireEvent, render, screen } from "@testing-library/react";
import CashflowSankey from "./CashflowSankey";

/**
 * The chart-suite questions asked of the diagram, through props alone: no
 * coordinate is NaN, nothing is drawn out of nothing, focus opens the same
 * read-out as hover, and one tab stop walks every node.
 */

const report = {
  totalIncomeCents: 600000,
  incomeSources: [
    { payeeId: "p1", incomeCents: 500000 },
    { payeeId: null, incomeCents: 100000 },
  ],
  rows: [
    { budgetId: "b1", name: "Rent", bucket: "essentials", netSpentCents: 250000 },
    { budgetId: "b2", name: "Dining", bucket: "fun", netSpentCents: 50000 },
  ],
};
const payeeName = (id) => (id === "p1" ? "Acme" : null);

test("no coordinate is NaN", () => {
  const { container } = render(<CashflowSankey report={report} payeeName={payeeName} />);

  for (const element of container.querySelectorAll("path, rect, text")) {
    for (const name of ["d", "x", "y", "width", "height"]) {
      expect(element.getAttribute(name) ?? "").not.toMatch(/NaN/);
    }
  }
});

test("a window where no money moved says so rather than drawing an empty diagram", () => {
  const { container } = render(
    <CashflowSankey report={{ totalIncomeCents: 0, incomeSources: [], rows: [] }} />
  );

  expect(container.querySelector("svg")).toBeNull();
  expect(screen.getByText(/nothing to draw/)).toBeInTheDocument();
});

test("focus opens the read-out, naming the bands that touch the node", () => {
  render(<CashflowSankey report={report} payeeName={payeeName} />);

  fireEvent.focusIn(screen.getByRole("img", { name: /^Income:/ }));

  expect(screen.getByText("to Essentials")).toBeInTheDocument();
  expect(screen.getByText("to Kept")).toBeInTheDocument();
  expect(screen.getByText("from Acme")).toBeInTheDocument();
});

test("one tab stop, and the arrows walk the nodes", () => {
  render(<CashflowSankey report={report} payeeName={payeeName} />);
  const nodes = screen.getAllByRole("img");

  expect(nodes.filter((node) => node.getAttribute("tabindex") === "0")).toHaveLength(1);
  act(() => nodes[0].focus());
  fireEvent.keyDown(nodes[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(nodes[1]);
  fireEvent.keyDown(nodes[1], { key: "End" });
  expect(document.activeElement).toBe(nodes[nodes.length - 1]);
});
