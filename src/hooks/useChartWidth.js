import { useLayoutEffect, useState } from "react";

/**
 * The width a chart's box actually has, for a viewBox drawn at that width.
 *
 * The charts used to draw at a fixed 760 units and refuse to shrink below 600px,
 * scrolling sideways instead — because a viewBox scaled down to a phone scales
 * its labels down with it, to type nobody can read. Measuring the box and
 * drawing a viewBox of exactly that width keeps the type at its real size and
 * lets the plot itself be what gets narrower.
 *
 * `max` caps the viewBox width so the SVG does not try to render at a size
 * nothing was designed at. Past `max` the viewBox stops growing — but the SVG
 * element is `w-full`, so a container wider than `max` would scale everything
 * (including type) up. Keep `max` large enough to match any realistic content
 * width so the chart always renders at 1:1 scale. `min` is where a plot stops
 * being a plot.
 *
 * Where there is no `ResizeObserver` — jsdom, which is every test in this suite
 * — the chart stays at `max`, so every coordinate a test reads is the one it
 * always read.
 */
export default function useChartWidth(ref, { max = 1400, min = 280 } = {}) {
  const [width, setWidth] = useState(max);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;

    const measure = (measured) => {
      if (!measured) return;
      setWidth(Math.max(min, Math.min(max, Math.round(measured))));
    };
    measure(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, max, min]);

  return width;
}
