import { Link } from "react-router-dom";
import { formatCents } from "../utils";

/**
 * Every category, under the group it is filed under, with what it has and what
 * it did this month.
 *
 *   activity  = the month's net movement, negative when money left
 *   budgeted  = what was assigned to it this month
 *   available = carried in + budgeted + activity
 *   target    = the standing monthly estimate, set on the budget plan
 *   goal      = the balance it is saving towards, set on the budget plan too
 *
 * Available leads because it is the figure the user acts on. Budgeted and
 * activity follow as the two things that moved it this month, and because
 * activity carries its own sign the row adds up as it is read rather than
 * needing one column subtracted from another. The two plan columns — what this
 * category was meant to need, and what it is saving towards — sit together at
 * the end, away from the figures that come from the books.
 *
 * The arrangement is the plan's, not this table's: the sections arrive in the
 * order set on the Configuration page, so a household that has spent time
 * arranging their categories sees the same order everywhere.
 *
 * One definition of trouble, and only one: `available < 0`. Not a second rule
 * about the target, which an envelope carrying money forward can exceed
 * quite safely — a sinking fund spends a year's saving in one month by design.
 * Nor about the goal, for the same reason in reverse: a category short of what
 * it is saving towards is a category part-way through saving, which is what
 * every goal looks like until the day it is met.
 */

const COLUMNS = [
  { key: "availableCents", label: "Available" },
  { key: "budgetedCents", label: "Budgeted" },
  { key: "activityCents", label: "Activity" },
  { key: "targetCents", label: "Target" },
  { key: "goalCents", label: "Goal" },
];

const headCell = "whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-chalk";

/** A figure on the light sheet. Null reads as a dash — no figure exists, which
 *  is a different statement from a figure of zero. */
function Figure({ cents, tone = "text-ink" }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
        cents == null ? "text-ink-soft" : tone
      }`}
    >
      {cents == null ? "—" : formatCents(cents)}
    </td>
  );
}

/**
 * How each column reads on a row. Driven off `COLUMNS` rather than written out
 * cell by cell, so the header and the body cannot disagree about how many
 * columns there are — which is exactly what happened when a column was dropped
 * from one and left in the other.
 *
 * The plan columns are grey and dash when unset: they describe intent, and a
 * category nobody has estimated is not a category planned at zero.
 */
function cellFor(row, key) {
  if (key === "availableCents") {
    // The one definition of trouble: the envelope is empty and still paying
    // out.
    const tone = row.availableCents < 0 ? "font-medium text-vermilion-ink" : "font-medium text-ink";
    return { cents: row.availableCents, tone };
  }
  if (key === "targetCents") return { cents: row.targetCents || null, tone: "text-ink-soft" };
  if (key === "goalCents") return { cents: row.goalCents, tone: "text-ink-soft" };
  return { cents: row[key], tone: "text-ink" };
}

function CategoryRow({ row, striped }) {
  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        {row.name}
      </th>
      {COLUMNS.map((column) => {
        const { cents, tone } = cellFor(row, column.key);
        return <Figure key={column.key} cents={cents} tone={tone} />;
      })}
    </tr>
  );
}

function GroupBand({ name, totals }) {
  return (
    <tr className="bg-band">
      <th scope="colgroup" className="px-4 py-1.5 text-left font-mono text-label uppercase text-ink">
        {name}
      </th>
      {COLUMNS.map((column) => (
        <td
          key={column.key}
          className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-label tabular-nums text-ink"
        >
          {/* A band with nothing saving towards anything leaves the goal column
              blank rather than subtotalling it to zero — the sum arrives null
              from `useDashboard` for exactly that case. */}
          {totals[column.key] == null ? "" : formatCents(totals[column.key])}
        </td>
      ))}
    </tr>
  );
}

export default function CategoryLedgerTable({ sections, otherRows, otherTotals, totals }) {
  const empty = sections.length === 0 && otherRows.length === 0;

  // The zebra runs across the whole table rather than restarting under each
  // band, so two rows of the same shade never end up either side of a heading.
  let stripe = 0;

  return (
    <section className="border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Categories</h2>
      </div>

      {empty ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No categories yet.{" "}
          <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
            Add one on the budget plan
          </Link>{" "}
          and it will appear here with everything it holds.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-panel-raised">
                <th
                  scope="col"
                  className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  Category
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={headCell}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            {sections.map((section) => (
              <tbody key={section.groupId ?? "ungrouped"}>
                <GroupBand name={section.name} totals={section.totals} />
                {section.rows.map((row) => (
                  <CategoryRow key={row.budgetId} row={row} striped={stripe++ % 2 === 1} />
                ))}
              </tbody>
            ))}

            {/* Spend and funding with no category of their own. They count in
                every total on the page, so they have to be visible somewhere
                too. */}
            {otherRows.length > 0 && (
              <tbody>
                {/* Never a goal on these: a goal belongs to a category the user
                    set one on, and the catch-alls are what is left over. */}
                <GroupBand name="No category" totals={otherTotals} />
                {otherRows.map((row) => (
                  <CategoryRow key={row.budgetId} row={row} striped={stripe++ % 2 === 1} />
                ))}
              </tbody>
            )}

            {/* Back on the dark chrome, bookending the header: this row is the
                page's total, not another band inside the sheet. */}
            <tfoot>
              <tr className="bg-panel-raised">
                <th
                  scope="row"
                  className="px-4 py-2 text-left font-mono text-label uppercase text-chalk"
                >
                  All categories
                </th>
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk"
                  >
                    {totals[column.key] == null ? "" : formatCents(totals[column.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
