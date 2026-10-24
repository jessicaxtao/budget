import { Children, createContext, isValidElement, useContext, useMemo } from "react";
import { rectSortingStrategy } from "@dnd-kit/sortable";
import useSyncedState from "../hooks/useSyncedState";
import { SortableList, useSortableItem } from "./Sortable";

// Chart height tiers, in SVG viewBox units (same scale as VIEW.width = 760).
export const CHART_HEIGHTS = { sm: 180, md: 270, lg: 390 };

const DEFAULT_WIDGETS = [
  { id: "summary", label: "Summary", visible: true, width: "full" },
  { id: "calendar", label: "Cashflow calendar & runway", visible: true, width: "full" },
  { id: "scheduled", label: "Scheduled and other spending", visible: true, width: "half" },
  { id: "month", label: "Month by month", visible: true, width: "full", height: "md" },
  { id: "savings-rate", label: "Savings rate trend", visible: true, width: "half", height: "sm" },
  { id: "income", label: "Income by source", visible: true, width: "half" },
  { id: "flows", label: "Where it came from, where it went", visible: true, width: "full" },
  { id: "plan", label: "Against the plan", visible: true, width: "full", height: "md" },
  { id: "categories", label: "Where the money went", visible: true, width: "full" },
];

// Which widget ids contain a chart that accepts a chartHeight prop.
const CHART_WIDGET_IDS = new Set(["month", "savings-rate", "plan"]);

function migrateWidgets(value) {
  if (!Array.isArray(value)) return DEFAULT_WIDGETS;
  const saved = new Map(value.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  return [...value.filter((item) => DEFAULT_WIDGETS.some((known) => known.id === item?.id)),
    ...DEFAULT_WIDGETS.filter((item) => !saved.has(item.id))]
    .map((item) => ({ ...DEFAULT_WIDGETS.find((known) => known.id === item.id), ...saved.get(item.id) }));
}

// Provides a Map<widgetId, config> to descendants inside ReportWidgetLayout.
export const WidgetConfigContext = createContext(new Map());

// Read inside a descendant of ReportWidgetLayout's provider.
export function useWidgetConfig(id) {
  return useContext(WidgetConfigContext).get(id) ?? {};
}

function HeightButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-label uppercase transition-colors ${
        active
          ? "border-chalk bg-panel-raised text-chalk"
          : "border-edge text-chalk-soft hover:border-chalk hover:text-chalk"
      }`}
    >
      {children}
    </button>
  );
}

function SortableWidget({ id, colSpan, children }) {
  const item = useSortableItem(id);
  return (
    <div
      ref={item.ref}
      style={item.style}
      {...item.handle}
      className={colSpan === "full" ? "md:col-span-2" : ""}
    >
      {children}
    </div>
  );
}

export default function ReportWidgetLayout({ children }) {
  const [widgets, setWidgets] = useSyncedState("reportWidgets", DEFAULT_WIDGETS, migrateWidgets);
  const content = useMemo(() => {
    const byId = new Map();
    const other = [];
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.props["data-widget-id"]) byId.set(child.props["data-widget-id"], child);
      else other.push(child);
    });
    return { byId, other };
  }, [children]);
  const ordered = widgets.filter((widget) => content.byId.has(widget.id));
  const visibleIds = ordered.filter((widget) => widget.visible).map((widget) => widget.id);

  const configMap = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);

  function toggleVisible(id) {
    setWidgets((current) => current.map((item) => item.id === id ? { ...item, visible: !item.visible } : item));
  }

  function toggleWidth(id) {
    setWidgets((current) => current.map((item) =>
      item.id === id ? { ...item, width: item.width === "half" ? "full" : "half" } : item
    ));
  }

  function setHeight(id, height) {
    setWidgets((current) => current.map((item) =>
      item.id === id ? { ...item, height } : item
    ));
  }

  return (
    <WidgetConfigContext.Provider value={configMap}>
      <details className="rounded-2xl border border-edge bg-panel px-4 py-3">
        <summary className="cursor-pointer text-label uppercase text-chalk-soft hover:text-chalk">Report widgets</summary>
        <p className="mt-2 font-sans text-row text-chalk-soft">
          Drag widgets to reorder. On wider screens, set any widget to half-width to show two side by side.
        </p>
        <div className="mt-3 space-y-1.5">
          {ordered.map((widget) => (
            <div key={widget.id} className="flex items-center gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 font-sans text-row text-chalk">
                <input
                  type="checkbox"
                  checked={widget.visible}
                  onChange={() => toggleVisible(widget.id)}
                />
                <span className="truncate">{widget.label}</span>
              </label>
              {CHART_WIDGET_IDS.has(widget.id) && (
                <div className="flex shrink-0 items-center gap-1">
                  {["sm", "md", "lg"].map((tier) => (
                    <HeightButton
                      key={tier}
                      active={(widget.height ?? "md") === tier}
                      onClick={() => setHeight(widget.id, tier)}
                    >
                      {tier === "sm" ? "S" : tier === "md" ? "M" : "L"}
                    </HeightButton>
                  ))}
                </div>
              )}
              <button
                type="button"
                title={widget.width === "half" ? "Switch to full width" : "Switch to half width"}
                onClick={() => toggleWidth(widget.id)}
                className="shrink-0 rounded border border-edge px-2 py-0.5 text-label uppercase text-chalk-soft transition-colors hover:border-chalk hover:text-chalk"
              >
                {widget.width === "half" ? "½" : "↔"}
              </button>
            </div>
          ))}
        </div>
      </details>
      {content.other}
      <SortableList
        ids={visibleIds}
        strategy={rectSortingStrategy}
        onReorder={(ids) => setWidgets((current) => {
          const visible = ids.map((id) => current.find((item) => item.id === id));
          let index = 0;
          return current.map((item) => item.visible ? visible[index++] : item);
        })}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ordered.filter((widget) => widget.visible).map((widget) => (
            <SortableWidget key={widget.id} id={widget.id} colSpan={widget.width ?? "full"}>
              {content.byId.get(widget.id)}
            </SortableWidget>
          ))}
        </div>
      </SortableList>
    </WidgetConfigContext.Provider>
  );
}
