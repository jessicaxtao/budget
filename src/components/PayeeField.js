import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { normalizePayeeName } from "../contexts/PayeesContext";
import { matchPayees } from "../payeeSearch";

/**
 * Naming a payee by typing at it: the matching payees appear as the letters go
 * in, and one of them — or a new one — is what the field commits.
 *
 * One component for both places a payee is named, the entry form and every row
 * of the register, so the two cannot come to disagree about what counts as a
 * match or what the keyboard does. The ranking itself is a floor lower, in
 * `src/payeeSearch.js`, where it is testable as the arithmetic it is; what is
 * here is what the *control* means.
 *
 * **It is a real combobox rather than an `<input list>` and a `<datalist>`.** A
 * datalist cannot be styled to sit on either of this app's two surfaces, cannot
 * carry a second line of context on an option, cannot offer "create this one" as
 * the last row, and matches differently in every browser — Firefox on the prefix,
 * Chrome on the substring. The search would then be a different search depending
 * on where the app was opened, which is the one thing a shared component exists
 * to prevent.
 *
 * **The second controlled control in the app**, after `SplitParts`, and for its
 * stated reason: the set of options is itself changing as the user types, which
 * nothing uncontrolled can express. What it is careful *not* to control is the
 * commit — see below.
 *
 * **Two faces, like the register's money cells.** At rest the field shows the
 * payee's name; under the caret it shows what is being typed. That is what lets
 * the same control be a cell in a grid of sixty rows and a field in a form
 * without either one having to fake the other.
 *
 * **What it commits, and what it refuses to decide.** `onCommit` is handed either
 * a `payeeId` (an existing payee was picked, or the text names one exactly, or
 * the field was cleared) or a bare `name` (nothing matches, so this is a payee
 * that does not exist yet). It never creates anything itself, because *when* a
 * payee comes into being is the host's rule and the two hosts answer it
 * differently: the entry form holds the name as a draft and creates it on submit,
 * so a form abandoned half-typed leaves nothing behind, while a register cell has
 * no submit to wait for and creates on blur.
 *
 * Clearing the field clears the payee, and that is a real answer rather than an
 * abandoned edit — unlike a blank date or a blank amount, which no record can
 * have. A row that names nobody is an ordinary row.
 */

/** How many payees the list shows before it starts saying how many it is not. */
const LIMIT = 8;

/** The last row, when what is typed is not a payee yet. Not an id, and cannot
 *  collide with one: every real id is a UUID. */
const CREATE = "__create__";

const FORM_INPUT =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

// The list wears the surface it is opened on, which is the rule the whole palette
// is arranged around: `chalk` on dark chrome, `ink` on the light data sheet. A
// dark menu dropped over a light register row would read as belonging to another
// application.
const LIST_SURFACE = {
  form: "border-edge bg-panel",
  cell: "border-rule bg-sheet",
};

const OPTION_SURFACE = {
  form: "text-chalk",
  cell: "text-ink",
};

const OPTION_ACTIVE = {
  form: "bg-panel-raised",
  cell: "bg-sheet-alt",
};

const HINT_SURFACE = {
  form: "text-chalk-soft",
  cell: "text-ink-soft",
};

export default function PayeeField({
  surface = "form",
  label,
  // Defaulted so a host with no payees yet — a fresh household, or a test
  // exercising the rest of a row — renders a plain field rather than throwing.
  payees = [],
  value,
  /** What to show at rest when there is no payee yet — the host's draft name. */
  draftName = "",
  placeholder,
  inputClassName,
  /** Optional second line on an option, e.g. the category it defaults to. */
  describePayee,
  /**
   * Every keystroke, for a host that needs the text before an answer is given.
   *
   * The entry form does: its submit button can be clicked from a field that has
   * never been blurred, and a form that read the payee only on blur would depend
   * on the browser firing one before the click — true in a browser, and far too
   * subtle a thing for a saved transaction to rest on. The register does not, and
   * must not: committing per letter there would write the ledger once per
   * keystroke.
   */
  onType,
  onCommit,
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputId = `${baseId}-input`;
  const wrapRef = useRef();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  // -1 is "nothing active", and it is the deliberate starting point: with the
  // first match active by default, typing a payee that does not exist yet and
  // pressing Enter would silently take a *different* payee that happens to share
  // three letters with it. Nothing is active until an arrow key says so, so Enter
  // means "what I typed" until the user has picked something else.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState(null);

  const current = payees.find((payee) => payee.id === value) ?? null;
  const restText = current?.name ?? draftName ?? "";
  const text = editing ? query : restText;

  const { matches, moreCount } = matchPayees(payees, editing ? query : "", { limit: LIMIT });
  const typed = query.trim();
  // Offered whenever what is typed is not already a payee by identity — even when
  // other payees match it as a substring, since "Ace" matching "Acme" says nothing
  // about whether Ace exists.
  const canCreate =
    typed !== "" &&
    !payees.some((payee) => normalizePayeeName(payee.name) === normalizePayeeName(typed));

  const options = canCreate ? [...matches, { id: CREATE }] : matches;
  const open = editing && options.length > 0;

  /**
   * Where the list goes. **Fixed**, measured off the field, rather than absolute
   * inside it: the register's table sits in an `overflow-x-auto` box, and a box
   * that scrolls on one axis clips the other as well — an absolutely positioned
   * list would be cut off at the edge of the grid on every row. The same
   * measurement keeps it out of the dialog's own scroll box in the form.
   */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      if (wrapRef.current) setRect(wrapRef.current.getBoundingClientRect());
    };
    measure();
    // Capturing, so a scroll of any ancestor is heard and not just the window's.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Every keystroke rebuilds the list, so the row that was active is not
  // necessarily the same row any more — and an index left pointing into a list
  // that has changed under it is how Enter takes the wrong payee.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  function close() {
    setEditing(false);
    setActiveIndex(-1);
  }

  /** What the typed text means, committed. Never creates anything itself. */
  function commitText(raw) {
    const trimmed = raw.trim();

    if (trimmed === "") {
      // Only a change if there was something to clear.
      if (value != null || draftName) onCommit({ payeeId: null, name: "" });
      return;
    }

    const key = normalizePayeeName(trimmed);
    const existing = payees.find((payee) => normalizePayeeName(payee.name) === key);
    if (existing) {
      if (existing.id !== value) onCommit({ payeeId: existing.id, name: existing.name });
      return;
    }

    // A name that is not a payee yet. Unchanged from what the field was already
    // showing is not an edit — which is what keeps tabbing through a row of the
    // register from re-reporting every draft it passes.
    if (value == null && key === normalizePayeeName(restText)) return;
    onCommit({ payeeId: null, name: trimmed });
  }

  function take(option) {
    if (option.id === CREATE) {
      close();
      onCommit({ payeeId: null, name: typed });
      return;
    }
    close();
    if (option.id !== value) onCommit({ payeeId: option.id, name: option.name });
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!editing) {
        setEditing(true);
        setQuery(restText);
        return;
      }
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wrapping through -1 rather than round the ends, so arrowing back up past
      // the first option returns the field to what was typed instead of jumping
      // to the bottom of a list the user was walking down from the top.
      const next = activeIndex + step;
      setActiveIndex(next < -1 ? options.length - 1 : next >= options.length ? -1 : next);
      return;
    }

    if (e.key === "Enter") {
      if (!open) return;
      // Consumed while the list is open, always. In the entry form this field
      // sits inside a `<form>`, and an Enter that both took an option and
      // submitted the form would save a transaction the user was still filling
      // in. Pressing Enter again submits, by which point the list is closed.
      e.preventDefault();
      if (activeIndex >= 0) take(options[activeIndex]);
      else {
        commitText(query);
        close();
      }
      return;
    }

    if (e.key === "Escape") {
      if (!editing) return;
      // Stopped as well as prevented: this field is used inside a `<dialog>`,
      // which closes on Escape, and backing out of a list of payees must not
      // throw away the half-filled form around it.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    if (e.key === "Tab") {
      // Tab commits and moves on, the contract every field in this app keeps.
      commitText(query);
      close();
    }
  }

  const listStyle = rect
    ? {
        position: "fixed",
        top: `${rect.bottom + 2}px`,
        left: `${rect.left}px`,
        // Never narrower than a name needs, even in the register's narrowest
        // column.
        minWidth: `${Math.max(rect.width, 224)}px`,
      }
    : { position: "fixed", top: 0, left: 0, minWidth: "224px" };

  const field = (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${options[activeIndex].id}` : undefined
        }
        aria-label={surface === "cell" ? label : undefined}
        autoComplete="off"
        // A payee list is proper nouns and shop names; a red squiggle under every
        // one of them says they are misspelt, and none of them are.
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setEditing(true);
          setQuery(e.target.value);
          onType?.(e.target.value);
        }}
        onFocus={(e) => {
          setEditing(true);
          setQuery(restText);
          // Selected, the way the register's money cells select their figure: at
          // rest this field holds a payee that was *chosen*, and typing is how a
          // different one is chosen. Leaving the caret where the click landed
          // makes the first keystroke insert into the middle of the old name —
          // "Trader Joe'scost" — which matches nothing and offers to create it.
          e.target.select();
        }}
        onBlur={() => {
          // Options cancel their own mousedown so focus never leaves the field,
          // which is what makes a blur here unambiguously "the user has moved on".
          commitText(query);
          close();
        }}
        onKeyDown={handleKeyDown}
        className={inputClassName ?? FORM_INPUT}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching payees"
          style={listStyle}
          className={`z-50 max-h-64 overflow-y-auto border shadow-xl shadow-black/40 ${LIST_SURFACE[surface]}`}
        >
          {options.map((option, index) => {
            const active = index === activeIndex;
            const creating = option.id === CREATE;
            const hint = creating ? null : describePayee?.(option);
            return (
              <li
                key={option.id}
                id={`${listId}-${option.id}`}
                role="option"
                aria-selected={active}
                // Cancelled so the field keeps focus: without it the input blurs
                // first, commits whatever was typed, and the click lands on a
                // list that has already closed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => take(option)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`cursor-pointer px-3 py-1.5 font-sans text-row ${
                  OPTION_SURFACE[surface]
                } ${active ? OPTION_ACTIVE[surface] : ""}`}
              >
                {creating ? (
                  <span>
                    <span className={`font-mono text-label uppercase ${HINT_SURFACE[surface]}`}>
                      New payee
                    </span>{" "}
                    {typed}
                  </span>
                ) : (
                  <>
                    <span className="block truncate">{option.name}</span>
                    {hint && (
                      <span
                        className={`block truncate font-mono text-label uppercase ${HINT_SURFACE[surface]}`}
                      >
                        {hint}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
          {moreCount > 0 && (
            // Not an option — it cannot be picked, and giving it a role would put
            // a dead row in the middle of the keyboard walk. It is there so a
            // truncated list never looks like a complete one.
            <li
              aria-hidden="true"
              className={`px-3 py-1 font-mono text-label uppercase ${HINT_SURFACE[surface]}`}
            >
              +{moreCount} more — keep typing
            </li>
          )}
        </ul>
      )}
    </div>
  );

  // In a cell the label is the input's own `aria-label` and there is nothing to
  // draw; in a form it is the caption above it, which is what every other field
  // here wears.
  if (surface === "cell") return field;

  // `htmlFor` rather than wrapping, unlike `Field`: the list is interactive
  // content and a `<label>` around it would make every click on an option a click
  // on the label as well.
  return (
    <div className="mb-5">
      <label
        htmlFor={inputId}
        className="mb-2 block font-mono text-label uppercase text-chalk-soft"
      >
        {label}
      </label>
      {field}
    </div>
  );
}
