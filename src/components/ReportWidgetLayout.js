import { Children, isValidElement, useMemo } from "react";
import useSyncedState from "../hooks/useSyncedState";
import { SortableList, useSortableItem } from "./Sortable";

const DEFAULT_WIDGETS = [
  { id: "summary", label: "Summary", visible: true },
  { id: "scheduled", label: "Scheduled and other spending", visible: true },
  { id: "month", label: "Month by month", visible: true },
  { id: "flows", label: "Where it came from, where it went", visible: true },
  { id: "plan", label: "Against the plan", visible: true },
  { id: "categories", label: "Where the money went", visible: true },
];

function migrateWidgets(value) {
  if (!Array.isArray(value)) return DEFAULT_WIDGETS;
  const saved = new Map(value.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  return [...value.filter((item) => DEFAULT_WIDGETS.some((known) => known.id === item?.id)),
    ...DEFAULT_WIDGETS.filter((item) => !saved.has(item.id))]
    .map((item) => ({ ...DEFAULT_WIDGETS.find((known) => known.id === item.id), ...saved.get(item.id) }));
}

function SortableWidget({ id, children }) {
  const item = useSortableItem(id);
  return <div ref={item.ref} style={item.style} {...item.handle}>{children}</div>;
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

  return <>
    <details className="border border-edge bg-panel px-4 py-3">
      <summary className="cursor-pointer font-mono text-label uppercase text-chalk-soft hover:text-chalk">Report widgets</summary>
      <p className="mt-2 font-sans text-row text-chalk-soft">Drag widgets to change their order. Choose which ones appear below.</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {ordered.map((widget) => <label key={widget.id} className="flex items-center gap-2 font-sans text-row text-chalk">
          <input type="checkbox" checked={widget.visible} onChange={() => setWidgets((current) => current.map((item) => item.id === widget.id ? { ...item, visible: !item.visible } : item))} />
          {widget.label}
        </label>)}
      </div>
    </details>
    {content.other}
    <SortableList ids={visibleIds} onReorder={(ids) => setWidgets((current) => {
      const visible = ids.map((id) => current.find((item) => item.id === id));
      let index = 0;
      return current.map((item) => item.visible ? visible[index++] : item);
    })}>
      <div className="space-y-4">
        {ordered.filter((widget) => widget.visible).map((widget) => <SortableWidget key={widget.id} id={widget.id}>{content.byId.get(widget.id)}</SortableWidget>)}
      </div>
    </SortableList>
  </>;
}
