import { DEFAULT_BUCKET, UNGROUPED_ID } from "./contexts/BudgetsContext";

/**
 * Categories arranged under the headings they are filed under.
 *
 * The store keeps two flat lists — groups, and budgets carrying a nullable
 * `groupId` — because that is the shape a rearrangement can be written back in
 * without a cascade. Screens want the other shape, so the fold lives here
 * rather than in a provider: it reads no state and belongs to neither store.
 *
 * **Array order is display order** in both inputs, and it survives the fold. A
 * section lists its categories in the order they appear in `budgets`, and the
 * sections come out in the order they appear in `groups`.
 */

/**
 * The ungrouped section always comes back, even with nothing in it.
 *
 * It is not a heading the user made and it holds no name of its own — it is
 * where a category sits when it is filed under nothing. Dropping it when empty
 * would take away the one place a user can drag a category *out* to, so the
 * last category to leave a group could never be un-grouped again. Callers that
 * only want to render headings can skip it on `budgets.length`; the drag layer
 * needs it there.
 */
export function toSections(groups, budgets) {
  const byGroup = new Map(groups.map((group) => [group.id, []]));
  const ungrouped = [];

  for (const budget of budgets) {
    const bucket = byGroup.get(budget.groupId);
    if (bucket) bucket.push(budget);
    // A category filed under a group that no longer exists reads as ungrouped
    // rather than vanishing. deleteGroup already hands its members back, so
    // this only catches storage edited by hand — but a category the user can
    // see nowhere is the one failure they cannot fix from the UI.
    else ungrouped.push(budget);
  }

  const sections = groups.map((group) => ({
    groupId: group.id,
    name: group.name,
    bucket: group.bucket ?? DEFAULT_BUCKET,
    budgets: byGroup.get(group.id),
  }));

  // No heading out here to take a default from, so the ungrouped section carries
  // the app default as its own — which keeps `bucket` a real bucket on every
  // section and spares every caller a null check that means the same thing.
  sections.push({
    groupId: UNGROUPED_ID,
    name: "Ungrouped",
    bucket: DEFAULT_BUCKET,
    budgets: ungrouped,
  });

  // `effectiveBucket` is what the category counts as, which since buckets stopped
  // being inheritable is simply the one on its record. The section is a fallback
  // for storage edited by hand, not a resolution step — nothing in the app writes
  // a category without a bucket — and it is kept because a split that silently
  // drops a category is worse than one that files it under its heading's default.
  return sections.map((section) => ({
    ...section,
    budgets: section.budgets.map((budget) => ({
      ...budget,
      effectiveBucket: budget.bucket ?? section.bucket,
    })),
    plannedCents: section.budgets.reduce((sum, budget) => sum + budget.plannedCents, 0),
  }));
}

/**
 * The inverse: sections back to the `[{ groupId, budgetIds }]` that
 * `setCategoryLayout` commits. Used after a drag, where the page has already
 * moved a category between sections locally and needs to write the whole
 * arrangement in one go.
 */
export function toLayout(sections) {
  return sections.map((section) => ({
    groupId: section.groupId,
    budgetIds: section.budgets.map((budget) => budget.id),
  }));
}
