import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Button from "./Button";
import { toLayout } from "../planLayout";
import { formatCents, fromCents, toCents } from "../utils";

/**
 * The categories, filed under their groups, in the order the user arranged
 * them — and the place that order is set.
 *
 * Dragging is the whole point of the component: a group is a heading and
 * nothing else, so "which group is this in" and "where in the list is it" are
 * the same gesture, and the store commits them as one write for that reason.
 *
 * A drag is previewed against a copy and committed once, on drop. Nothing is
 * written while the pointer is moving: `setCategoryLayout` rewrites both stored
 * lists, and doing that on every frame of a drag would put a few hundred
 * writes through localStorage to describe one rearrangement.
 */

// Sections need droppable ids of their own so an empty group is still a target
// — otherwise the last category to leave a group could never be put back.
// Prefixed so they cannot collide with a category's uuid.
const SECTION_PREFIX = "section:";
const sectionId = (groupId) => `${SECTION_PREFIX}${groupId ?? "ungrouped"}`;

/** Where an id sits: which section, and which row within it. `item` is -1 for
 *  the section itself, which is what a drop onto empty space reports. */
function locate(sections, id) {
  if (id == null) return null;
  for (let section = 0; section < sections.length; section += 1) {
    if (sectionId(sections[section].groupId) === id) return { section, item: -1 };
    const item = sections[section].budgets.findIndex((budget) => budget.id === id);
    if (item !== -1) return { section, item };
  }
  return null;
}

function withTotals(sections) {
  return sections.map((section) => ({
    ...section,
    plannedCents: section.budgets.reduce((sum, budget) => sum + budget.plannedCents, 0),
  }));
}

/** Lift a category out of one section and drop it into another. */
function moveBetweenSections(sections, from, to) {
  const next = sections.map((section) => ({ ...section, budgets: [...section.budgets] }));
  const [moved] = next[from.section].budgets.splice(from.item, 1);
  const at = to.item === -1 ? next[to.section].budgets.length : to.item;
  next[to.section].budgets.splice(at, 0, moved);
  return withTotals(next);
}

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" aria-hidden="true" className="h-4 w-2.5 fill-current">
      <circle cx="2" cy="3" r="1.4" />
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="2" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="2" cy="13" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}

const rowClass = (index) =>
  `flex items-center gap-3 px-3 py-2 ${index % 2 === 0 ? "bg-sheet" : "bg-sheet-alt"}`;

const handleClass =
  "cursor-grab touch-none px-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none active:cursor-grabbing";

/**
 * One category row: a drag handle, the name, its estimate, and a way out.
 *
 * The handle is a button of its own rather than the whole row being draggable.
 * The row holds a text field, and a pointer sensor over the whole row would
 * swallow the click that focuses it — the user could never edit the figure they
 * came here to edit.
 */
function CategoryRow({ budget, index, onEstimateChange, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: budget.id,
  });

  // Committed on blur rather than per keystroke: a half-typed "12" on the way
  // to "1200" is a real figure, and writing it would leave the plan wrong for
  // as long as it took to finish typing.
  function handleBlur(e) {
    const raw = e.target.value;
    const cents = raw.trim() === "" ? 0 : toCents(raw);
    const result = onEstimateChange(budget, cents);
    // Put the stored figure back when the store refuses the typed one, so the
    // row never shows an amount the plan is not actually using.
    if (!result.ok) e.target.value = fromCents(budget.plannedCents);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // The original keeps its place in the flow as a gap rather than
      // disappearing, so the list does not resize under the pointer.
      className={`${rowClass(index)} ${isDragging ? "opacity-25" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${budget.name}`}
        className={handleClass}
      >
        <GripIcon />
      </button>

      <span className="min-w-0 flex-1 truncate font-sans text-row text-ink">{budget.name}</span>

      <input
        type="number"
        step={0.01}
        min={0}
        defaultValue={budget.plannedCents ? fromCents(budget.plannedCents) : ""}
        placeholder="0"
        aria-label={`Monthly estimate for ${budget.name}`}
        onBlur={handleBlur}
        className="w-28 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row tabular-nums text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure"
      />

      <Button
        variant="row"
        size="sm"
        aria-label={`Remove category: ${budget.name}`}
        onClick={() => onDelete(budget)}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * The copy that follows the pointer.
 *
 * Flat markup rather than a second `CategoryRow`: a sortable registers itself
 * under its id, and mounting one for a row already on screen would put two
 * claims on the same id into the same context. It is also the reason the
 * estimate is text here and the Remove button is gone — a duplicate of a live
 * form control is a control the user can reach and a label that matches two
 * fields at once.
 */
function DraggedRow({ budget }) {
  return (
    <div className={`${rowClass(0)} border border-azure shadow-lg`}>
      <span className={handleClass}>
        <GripIcon />
      </span>
      <span className="min-w-0 flex-1 truncate font-sans text-row text-ink">{budget.name}</span>
      <span className="w-28 pb-1 text-right font-mono text-row tabular-nums text-ink">
        {formatCents(budget.plannedCents)}
      </span>
    </div>
  );
}

function Section({
  section,
  hasGroups,
  onEstimateChange,
  onDeleteCategory,
  onAddCategory,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  canMoveUp,
  canMoveDown,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: sectionId(section.groupId) });
  const ungrouped = section.groupId == null;

  // "Ungrouped" only means something once there is a group to be outside of.
  // Before that it is the whole list, and heading it with the name of an
  // exception the user has never met would be noise. It is still rendered when
  // empty, though — with groups in play it is the one place a category can be
  // dragged *out* to, and hiding it would strand the last one to leave a group.
  const heading = ungrouped && !hasGroups ? "Categories" : section.name;

  return (
    <section className={`border ${isOver ? "border-azure" : "border-edge"} bg-panel`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h3
            className={`font-sans text-base font-semibold tracking-tight ${
              ungrouped ? "text-chalk-soft" : "text-chalk"
            }`}
          >
            {heading}
          </h3>
          <span className="font-mono text-label uppercase text-chalk-soft">
            {section.budgets.length}{" "}
            {section.budgets.length === 1 ? "category" : "categories"} ·{" "}
            <span className="text-chalk">{formatCents(section.plannedCents)}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onAddCategory(section.groupId)}>
            Add category
          </Button>
          {!ungrouped && (
            <>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move group up: ${section.name}`}
                disabled={!canMoveUp}
                onClick={() => onMoveGroup(section.groupId, -1)}
              >
                ↑
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Move group down: ${section.name}`}
                disabled={!canMoveDown}
                onClick={() => onMoveGroup(section.groupId, 1)}
              >
                ↓
              </Button>
              <Button variant="outline" size="sm" onClick={() => onRenameGroup(section)}>
                Rename
              </Button>
              <Button
                variant="danger"
                size="sm"
                aria-label={`Delete group: ${section.name}`}
                onClick={() => onDeleteGroup(section)}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <div ref={setNodeRef}>
        <SortableContext
          items={section.budgets.map((budget) => budget.id)}
          strategy={verticalListSortingStrategy}
        >
          {section.budgets.length === 0 ? (
            <p className="px-4 py-5 font-sans text-row text-chalk-soft">
              {!ungrouped
                ? "Nothing here yet. Add a category, or drag one in."
                : hasGroups
                ? "Nothing outside a group. Drag a category here to take it out of one."
                : "No categories yet."}
            </p>
          ) : (
            section.budgets.map((budget, index) => (
              <CategoryRow
                key={budget.id}
                budget={budget}
                index={index}
                onEstimateChange={onEstimateChange}
                onDelete={onDeleteCategory}
              />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  );
}

export default function CategoryPlanner({
  sections,
  onLayoutChange,
  onEstimateChange,
  onAddCategory,
  onRenameGroup,
  onDeleteGroup,
  onDeleteCategory,
}) {
  // Non-null only while a drag is in flight, so there is no mirror of the store
  // to fall out of step with it between drags.
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(null);

  const sensors = useSensors(
    // A few pixels of slop, so a click on the handle stays a click and the
    // Remove button beside it is not swallowed by a drag that never started.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const view = preview ?? sections;
  const groupCount = view.filter((section) => section.groupId != null).length;

  function handleDragStart({ active }) {
    const at = locate(sections, active.id);
    if (!at || at.item === -1) return;
    setDragging(sections[at.section].budgets[at.item]);
    setPreview(sections);
  }

  // Crossing into another section is handled here so the row appears under its
  // new heading while the pointer is still down. Reordering *within* a section
  // is left to the drop — dnd-kit is already animating that, and moving the
  // array underneath it as well would fight the animation.
  function handleDragOver({ active, over }) {
    if (!over) return;
    setPreview((current) => {
      const base = current ?? sections;
      const from = locate(base, active.id);
      const to = locate(base, over.id);
      if (!from || !to || from.item === -1 || from.section === to.section) return base;
      return moveBetweenSections(base, from, to);
    });
  }

  function handleDragEnd({ active, over }) {
    const base = preview ?? sections;
    setDragging(null);
    setPreview(null);

    // Dropped into nothing, or never actually moved: leave the stored order
    // alone rather than rewriting it with itself.
    if (!over) return;
    if (!preview && active.id === over.id) return;

    const from = locate(base, active.id);
    const to = locate(base, over.id);
    if (!from || !to || from.item === -1) return;

    const next =
      from.section === to.section
        ? withTotals(
            base.map((section, index) =>
              index === from.section
                ? {
                    ...section,
                    budgets: arrayMove(
                      section.budgets,
                      from.item,
                      to.item === -1 ? section.budgets.length - 1 : to.item
                    ),
                  }
                : section
            )
          )
        : moveBetweenSections(base, from, to);

    onLayoutChange(toLayout(next));
  }

  function handleDragCancel() {
    setDragging(null);
    setPreview(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mb-4 space-y-3">
        {view.map((section, index) => (
          <Section
            key={sectionId(section.groupId)}
            section={section}
            hasGroups={groupCount > 0}
            onEstimateChange={onEstimateChange}
            onDeleteCategory={onDeleteCategory}
            onAddCategory={onAddCategory}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            onMoveGroup={(groupId, delta) => {
              const at = view.findIndex((entry) => entry.groupId === groupId);
              const to = at + delta;
              if (at === -1 || to < 0 || to >= groupCount) return;
              onLayoutChange(toLayout(arrayMove(view, at, to)));
            }}
            canMoveUp={index > 0}
            canMoveDown={index < groupCount - 1}
          />
        ))}
      </div>

      {/* The dragged row follows the pointer as a detached copy, so it stays
          legible over whichever heading it is currently above. */}
      <DragOverlay>{dragging && <DraggedRow budget={dragging} />}</DragOverlay>
    </DndContext>
  );
}
