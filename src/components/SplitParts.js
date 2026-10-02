import { v4 as uuidV4 } from "uuid";
import Button from "./Button";
import { amountAtRest, amountEditing, formatCents, toCents } from "../utils";

/**
 * One transaction divided between categories: the parts, what they add up to,
 * and how far that is from the whole.
 *
 * Shared by the two forms that can write a division — `AddTransactionModal`,
 * where a receipt is split as it is entered, and `SplitTransactionModal`, where
 * one already in the ledger is divided or redivided. One editor rather than two
 * because the arithmetic is the whole of the feature: the parts have to add up
 * to the whole or the envelope view and the balance sheet would be reading two
 * different transactions, and a second implementation of that rule is a second
 * chance to get it wrong.
 *
 * **This is the one form control in the app that is controlled rather than
 * uncontrolled**, and the reason is that the set of fields is itself being
 * edited. Every other form here has a fixed shape and is re-seeded through refs
 * when it opens, which works because `defaultValue` is only ever needed once per
 * field; a list the user adds rows to and removes rows from has no such fixed
 * shape, and reading it back out of the DOM would mean the host could not tell
 * what is in it without a `FormData` pass on every keystroke. The host holds the
 * parts in state, seeds them when the modal opens exactly as it seeds its refs,
 * and this renders them. The money field keeps both of its faces all the same —
 * formatted at rest, raw under the caret — because a column of figures that did
 * not line up on its decimal point would be the same eyesore here as anywhere.
 *
 * The parts are held as **typed strings**, not cents. A half-written "12." is a
 * real state on the way to "12.50", and a component that parsed every keystroke
 * would have to decide what to put back on screen for the ones that do not
 * parse. `toCents` is asked at the edges — for the running total, and once more
 * on submit.
 */

/** A new, empty part. The id is the row's identity and the part's, both. */
export const blankPart = (budgetId = "") => ({ id: uuidV4(), budgetId, amount: "" });

/** The editor's rows for a record already divided. */
export const partsFromSplits = (splits) =>
  (splits ?? []).map((part) => ({
    id: part.id,
    budgetId: part.budgetId ?? "",
    amount: amountAtRest(part.amountCents),
  }));

/** What the parts add up to so far. Unreadable ones count as nothing. */
export const partsAssignedCents = (parts) =>
  parts.reduce((total, part) => total + (toCents(part.amount) ?? 0), 0);

/** The parts in the shape the store takes. Only call it on parts that check out. */
export const partsToSplits = (parts) =>
  parts.map((part) => ({
    id: part.id,
    budgetId: part.budgetId,
    amountCents: toCents(part.amount),
  }));

/**
 * What is wrong with this division, in a sentence, or null if nothing is.
 *
 * The store checks all of this again at its own boundary and refuses in the same
 * cases — it has to, since nothing stops another caller — but its messages are
 * written for a record rather than for a form, and it is in no position to say
 * how far off the total the parts are. This is the version with the figures in
 * it, and it is what both hosts show, so the two cannot word one problem
 * differently.
 */
export function describeSplitProblem(parts, totalCents) {
  if (parts.length < 2) {
    return "A split needs two parts or more. Add another, or file the whole thing under one category.";
  }
  for (const part of parts) {
    if (!part.budgetId) return "Every part of a split names the category it came out of.";
    const cents = toCents(part.amount);
    if (cents == null) return "Every part of a split needs an amount.";
    if (cents <= 0) return "Every part of a split is more than nothing. Take out the ones that are not.";
  }
  if (totalCents == null) return "Enter the amount of the whole transaction first.";

  const left = totalCents - partsAssignedCents(parts);
  if (left > 0) return `The parts are ${formatCents(left)} short of the ${formatCents(totalCents)} total.`;
  if (left < 0) return `The parts are ${formatCents(-left)} over the ${formatCents(totalCents)} total.`;
  return null;
}

const figureInput =
  "w-28 border-0 border-b-2 border-rule bg-transparent px-0 py-1 text-right font-mono text-row text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-azure";

const selectInput =
  "w-full border-0 border-b-2 border-rule px-0 py-1 font-sans text-row text-ink outline-none transition-colors focus:border-azure";

export default function SplitParts({ parts, budgets, totalCents, onChange }) {
  const assignedCents = partsAssignedCents(parts);
  const leftCents = (totalCents ?? 0) - assignedCents;
  // The same three tones `AssignIncomeModal`'s counter wears, and for the same
  // reading: green is a figure that has landed, amber is one still to be placed,
  // red is one that has gone past what there was to place.
  const leftTone = leftCents < 0 ? "text-vermilion" : leftCents > 0 ? "text-sulfur" : "text-verdant";

  const replace = (id, changes) =>
    onChange(parts.map((part) => (part.id === id ? { ...part, ...changes } : part)));

  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-label uppercase text-chalk-soft">Split between</span>
        {/* Announced as it changes rather than only drawn, the way the assign
            form's counter is: it is the figure the user is working towards. And
            where there is nothing left over there is no figure to give — "adds
            up $0" reads as a total of nothing rather than as a division that
            balances. */}
        <span role="status" className="font-mono text-label uppercase text-chalk-soft">
          {leftCents === 0 ? (
            <span className={`font-medium ${leftTone}`}>Adds up</span>
          ) : (
            <>
              {leftCents > 0 ? "Left to split" : "Over by"}{" "}
              <span className={`font-mono text-row font-medium ${leftTone}`}>
                {formatCents(Math.abs(leftCents))}
              </span>
            </>
          )}
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-panel-raised">
            <th scope="col" className="px-3 py-2 text-left font-mono text-label uppercase text-chalk">
              Category
            </th>
            <th
              scope="col"
              className="w-36 px-3 py-2 text-right font-mono text-label uppercase text-chalk"
            >
              Amount
            </th>
            <th scope="col" className="w-10 px-1 py-2">
              <span className="sr-only">Remove part</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part, index) => {
            const striped = index % 2 === 1;
            const position = `part ${index + 1}`;
            return (
              <tr key={part.id} className={striped ? "bg-sheet-alt" : "bg-sheet"}>
                <td className="px-3 py-2">
                  <select
                    value={part.budgetId}
                    aria-label={`Category of ${position}`}
                    onChange={(e) => replace(part.id, { budgetId: e.target.value })}
                    className={`${selectInput} ${striped ? "bg-sheet-alt" : "bg-sheet"}`}
                  >
                    {/* A prompt rather than a default. Which category the second
                        half of a receipt came out of is exactly what the app
                        cannot guess, and a first-option default would be quietly
                        wrong on most rows. */}
                    <option value="">Choose a category</option>
                    {budgets.map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        {budget.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={part.amount}
                    placeholder="$0"
                    aria-label={`Amount of ${position}`}
                    onChange={(e) => replace(part.id, { amount: e.target.value })}
                    onFocus={(e) => {
                      const cents = toCents(part.amount);
                      const input = e.target;
                      if (cents != null) replace(part.id, { amount: amountEditing(cents) });
                      // After React has written the raw figure, not before: a
                      // selection made against the formatted text is collapsed
                      // the moment the value underneath it changes.
                      queueMicrotask(() => input.select());
                    }}
                    onBlur={() => {
                      const cents = toCents(part.amount);
                      if (cents != null) replace(part.id, { amount: amountAtRest(cents) });
                    }}
                    className={figureInput}
                  />
                </td>
                <td className="px-1 py-2 text-right">
                  <Button
                    variant="row"
                    size="sm"
                    type="button"
                    // Never down to nothing: an empty table with an "add" button
                    // under it is a worse way of saying "this is not split" than
                    // the one part that says it.
                    disabled={parts.length < 2}
                    aria-label={`Remove ${position}`}
                    onClick={() => onChange(parts.filter((entry) => entry.id !== part.id))}
                  >
                    &times;
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          // Seeded with whatever is still unplaced, which is the figure the new
          // part almost always wants: type $80 against a $120 receipt and the
          // part you add next is the other $40. Blank where there is nothing
          // left over, since a part of zero is refused anyway.
          onClick={() =>
            onChange([
              ...parts,
              { ...blankPart(), amount: leftCents > 0 ? amountAtRest(leftCents) : "" },
            ])
          }
        >
          Add a part
        </Button>
      </div>
    </div>
  );
}
