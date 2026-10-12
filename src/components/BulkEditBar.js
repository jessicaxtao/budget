import { useRef } from "react";
import Button from "./Button";

/**
 * What to do with the rows that are ticked.
 *
 * It appears only when something is selected and it sits **above** the register
 * rather than below it: the rows it acts on run down the page from there, so the
 * verb and the thing it applies to are on screen together, and a bar that
 * appeared under sixty rows would be a control nobody finds.
 *
 * **Four verbs, and each is a question the register's own columns ask**, asked of
 * forty rows at once instead of one: refile into a category, move to an account,
 * tag (or untag) the notes, remove. Nothing here can do something a row cannot do
 * on its own — bulk editing is a quicker hand, not a wider power — which is why
 * there is no bulk *direction* change and no bulk date: both are one-row
 * corrections, and doing either to a selection is far more likely to be a
 * mistake than an intention.
 *
 * **The two selects commit on change** and go straight back to their prompt,
 * which is the app's rule for a control with nothing to half-type — and the right
 * one here for a second reason: the select is not reporting a state of the
 * selection (forty rows do not share one category) but performing an action, so
 * leaving the chosen value sitting in it would be a claim that is not true.
 *
 * **Removing forty rows asks for no confirmation, and that is the point of the
 * undo stack.** A confirm dialog is a worse protection than a real undo: it is
 * clicked through without reading, and it protects only the keystroke rather than
 * the decision. Ctrl+Z puts the rows back where they sat, their statements with
 * them — see `TransactionsContext`.
 *
 * **Nothing is said here**, and that is deliberate: every action hands its
 * `{ ok, error, note }` back to the page, which carries the one line that says
 * what just happened — the same line an undo writes to. Two places saying it
 * would mean a note from the last bulk edit sitting under these buttons while
 * the ledger had since been walked back out from under it, which is the sort of
 * stale sentence a reader has no way to date. The bar keeps one piece of state
 * of its own, the tag being typed, and clears it when the write lands.
 */
export default function BulkEditBar({
  count,
  shownCount,
  budgets,
  accounts,
  onRefile,
  onMove,
  onTag,
  onUntag,
  onDelete,
  onClear,
}) {
  const tagRef = useRef(null);

  /** A tag written, or taken off. The field is cleared only if the write landed. */
  function tagWith(action) {
    const result = action(tagRef.current.value) ?? { ok: true };
    if (result.ok) tagRef.current.value = "";
  }

  const select =
    "border border-edge bg-panel px-2 py-1 font-sans text-label text-chalk outline-none transition-colors focus:border-azure";

  const chosen = `the ${count === 1 ? "entry" : `${count} entries`} selected`;

  return (
    <div
      // Azure is the selection colour everywhere in the app — the chips, the
      // caret rule on a cell — so the bar that belongs to a selection wears it.
      className="mb-4 rounded-2xl border border-azure/60 bg-panel px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-label uppercase text-chalk">
          {count} of {shownCount} selected
        </span>
        {/* The two selects and the Remove button name the count in their own
            accessible names, so the number is said where the action is rather
            than only once at the start of the row. */}

        {/* Named by `aria-label` and not by a `<label>`: the prompt inside the
            select already says what it does on screen, and a visible label
            beside it would be the same words twice. */}
        <select
          value=""
          aria-label={`Refile ${chosen} into a category`}
          onChange={(event) => onRefile(event.target.value)}
          className={select}
        >
          <option value="">Refile into…</option>
          {budgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>

        <select
          value=""
          aria-label={`Move ${chosen} to an account`}
          onChange={(event) => onMove(event.target.value)}
          className={select}
        >
          <option value="">Move to…</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="text"
            ref={tagRef}
            aria-label="Tag to add or remove"
            placeholder="#tag"
            className="w-28 border-0 border-b-2 border-edge bg-transparent px-0 py-1 font-sans text-row text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
          />
          <Button variant="outline" size="sm" onClick={() => tagWith(onTag)}>
            Tag
          </Button>
          <Button variant="outline" size="sm" onClick={() => tagWith(onUntag)}>
            Untag
          </Button>
        </div>

        <Button variant="danger" size="sm" onClick={onDelete}>
          Remove {count}
        </Button>

        <Button variant="outline" size="sm" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}
