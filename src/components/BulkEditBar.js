import { useRef, useState } from "react";
import Button from "./Button";
import { isTag } from "../tags";

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
 * Every action hands back the `{ ok, error }` its store produced, plus a `note`
 * for the thing a batch can do that a single edit cannot: leave some of the
 * chosen rows alone, which a divided receipt forces. Both are said here, where
 * the button that caused them is.
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
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const tagRef = useRef(null);

  /** Run one action and say what came back of it. */
  function run(action) {
    const result = action() ?? { ok: true };
    setError(result.ok ? null : result.error);
    setNote(result.ok ? result.note ?? null : null);
    return result;
  }

  function tagWith(action) {
    const typed = tagRef.current.value;
    if (!isTag(typed)) {
      setNote(null);
      setError("A tag is one word — letters, digits, hyphens or underscores, as in #holiday.");
      return;
    }
    const result = run(() => action(typed));
    if (result.ok) tagRef.current.value = "";
  }

  const select =
    "border border-edge bg-panel px-2 py-1 font-sans text-label text-chalk outline-none transition-colors focus:border-azure";

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

        {/* Named by `aria-label` and not by a `<label>`: the prompt inside the
            select already says what it does on screen, and a visible label
            beside it would be the same words twice. */}
        <select
          value=""
          aria-label={`Refile the ${count} selected entries into a category`}
          onChange={(event) => run(() => onRefile(event.target.value))}
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
          aria-label={`Move the ${count} selected entries to an account`}
          onChange={(event) => run(() => onMove(event.target.value))}
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

        <Button variant="danger" size="sm" onClick={() => run(onDelete)}>
          Remove {count}
        </Button>

        <Button variant="outline" size="sm" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      {/* Under the controls rather than beside them, so a message does not move
          the buttons the eye has just found. */}
      {error && (
        <p role="alert" className="mt-2 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
      {note && !error && (
        <p role="status" className="mt-2 font-sans text-row text-chalk-soft">
          {note}
        </p>
      )}
    </div>
  );
}
