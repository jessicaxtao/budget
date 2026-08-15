import Button from "./Button";
import { formatCents } from "../utils";

/**
 * Who the household gives to, with what each has been given this year.
 *
 * A standing list, like the accounts on Configuration: an organisation is a fact
 * about the household rather than an event, and it outlives every gift made to
 * it. Which is why a year with nothing given to one still shows it — a list that
 * emptied itself every January would read as though the organisations had been
 * deleted.
 *
 * **The deductible flag here is a default and nothing more.** It decides what a
 * new gift to this organisation starts on; it does not restate what was claimed
 * on gifts already recorded, which each carry their own figure. So correcting a
 * charity's status in March cannot quietly change what a return filed in
 * February said. See `DonationsContext`.
 *
 * Editing is a modal opened on the record rather than typing over the name in the
 * row, the same call as `AccountList`: there are two answers here and the second
 * one is a yes-or-no that belongs beside the first, not behind it.
 */

function OrganizationRow({ row, striped, onEdit, onRemove }) {
  // Gifts whose organisation was removed. One bucket rather than a row each, and
  // it has no record behind it to edit or remove — what it needs is refiling,
  // which happens on the list of gifts.
  const unfiled = row.recipientId == null;

  // Two lines rather than one. This panel sits in the narrow column, and a name,
  // a figure and two buttons on a single row leave the name eight characters
  // wide — which is the one thing here that cannot be abbreviated. So the name
  // takes the width it needs against its figure, and the standing fact shares
  // the line underneath with the actions.
  return (
    <div className={`px-4 py-2 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}>
      <div className="flex items-baseline gap-3">
        <div
          className={`min-w-0 flex-1 truncate font-sans text-row ${
            unfiled ? "text-ink-soft" : "text-ink"
          }`}
        >
          {unfiled ? "No organization" : row.name}
        </div>
        <div
          className={`shrink-0 font-mono text-row font-medium tabular-nums ${
            row.giftCount === 0 ? "text-ink-soft" : "text-ink"
          }`}
        >
          {formatCents(row.totalCents)}
        </div>
      </div>
      <div className="mt-0.5 flex items-center gap-3">
        <div className="min-w-0 flex-1 truncate font-mono text-label uppercase text-ink-soft">
          {unfiled
            ? "Removed — refile these gifts"
            : row.deductibleByDefault
              ? "Deductible"
              : "Not deductible"}
          {row.giftCount > 0 &&
            ` · ${row.giftCount} ${row.giftCount === 1 ? "gift" : "gifts"}`}
        </div>
        {/* Editing before removing, and drawn as a button where Remove is bare
            text: the quiet one is the destructive one. Both name the
            organisation, since a column of them is otherwise a column of the
            same two words. */}
        {!unfiled && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="row-action"
              size="sm"
              aria-label={`Edit organization: ${row.name}`}
              onClick={() => onEdit(row)}
            >
              Edit
            </Button>
            <Button
              variant="row"
              size="sm"
              aria-label={`Remove organization: ${row.name}`}
              onClick={() => onRemove(row)}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OrganizationList({ year, rows, onAdd, onEdit, onRemove }) {
  const named = rows.filter((row) => row.recipientId != null);

  return (
    <section aria-label="Organizations" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
            Organizations
          </h2>
          <p className="mt-0.5 font-sans text-row text-chalk-soft">
            Given in {year}, per organization.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd}>
          Add organization
        </Button>
      </div>

      {named.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No organizations yet. Add the first one — a gift is filed under the organization that
          received it, and whether gifts to it are deductible is what a new gift starts on.
        </p>
      ) : (
        rows.map((row, index) => (
          <OrganizationRow
            key={row.recipientId ?? "unfiled"}
            row={row}
            striped={index % 2 === 1}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))
      )}
    </section>
  );
}
