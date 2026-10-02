import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";

/**
 * Folding other payees into this one.
 *
 * The operation the entity exists for. Any payee list typed into for a year holds
 * "Costco", "COSTCO" and "Costco Wholesale", and before this the only way to
 * unify them was to retype every row that named the wrong one.
 *
 * **Several sources at once, into the one target.** A household tidying up is
 * dealing with a cluster rather than a pair, and three merges would be three
 * writes to the ledger and three chances for a synced change to land in between —
 * so it is a checklist and one commit, which is also what lets the consequence be
 * stated as a single figure.
 *
 * **It states how many rows will move, and it has to.** A merge cannot be undone
 * and it changes transactions the user cannot see from here, which is exactly the
 * shape of action that needs its consequence written out with the figure in it
 * rather than a bare "are you sure".
 *
 * A modal rather than controls on the row, for `AddAccountModal`'s reason: the
 * answers are only valid together — which payees, into which one — and the whole
 * of it commits at once.
 */
export default function MergePayeesModal({
  show,
  target,
  payees,
  countById,
  onMerge,
  handleClose,
}) {
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState(null);

  // Re-seeded on both, because the panel opens this same mounted modal on a
  // different row without closing it in between — `AddSavingsGoalModal`'s
  // dependency list and its reason.
  useEffect(() => {
    if (!show) return;
    setPicked([]);
    setError(null);
  }, [show, target]);

  if (!target) return <Dialog show={show} handleClose={handleClose} title="Merge payees" />;

  const others = [...payees]
    .filter((payee) => payee.id !== target.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const movingCount = picked.reduce((total, id) => total + (countById.get(id) ?? 0), 0);

  function toggle(id) {
    setPicked((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]
    );
    setError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const result = onMerge({ fromIds: picked, intoId: target.id });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Dialog show={show} handleClose={handleClose} title={`Merge into ${target.name}`}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 font-sans text-row text-chalk-soft">
          Every transaction naming a payee you tick will name{" "}
          <span className="text-chalk">{target.name}</span> instead, and the ticked payees will be
          gone. The money itself does not move — no amount, date, account or category changes.
        </p>

        {others.length === 0 ? (
          <p className="mb-5 font-sans text-row text-chalk-soft">
            There is no other payee to merge in yet.
          </p>
        ) : (
          <ul className="mb-4 max-h-64 overflow-y-auto border border-edge">
            {others.map((payee, index) => {
              const count = countById.get(payee.id) ?? 0;
              return (
                <li
                  key={payee.id}
                  className={index % 2 === 1 ? "bg-sheet-alt" : "bg-sheet"}
                >
                  <label className="flex cursor-pointer items-baseline gap-3 px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.includes(payee.id)}
                      onChange={() => toggle(payee.id)}
                      className="mt-0.5 accent-azure"
                    />
                    <span className="min-w-0 flex-1 truncate font-sans text-row text-ink">
                      {payee.name}
                    </span>
                    <span className="shrink-0 font-mono text-label uppercase text-ink-soft">
                      {count} {count === 1 ? "row" : "rows"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {/* The consequence, live, with the figure in it. Announced rather than
            only drawn, the way the split editor's counter is: it is the thing the
            user is deciding about. */}
        <p role="status" className="mb-5 font-sans text-row text-chalk-soft">
          {picked.length === 0
            ? "Nothing ticked yet."
            : `${movingCount} ${movingCount === 1 ? "transaction" : "transactions"} will move to ${
                target.name
              }, and ${picked.length} ${picked.length === 1 ? "payee" : "payees"} will be removed.`}
        </p>

        {error && (
          <p role="alert" className="-mt-2 mb-5 font-sans text-row text-vermilion">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={picked.length === 0}>
            Merge
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
