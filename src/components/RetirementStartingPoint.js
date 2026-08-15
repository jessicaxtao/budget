import { Link } from "react-router-dom";
import { isOffBudget, scopeLabel } from "../contexts/AccountsContext";
import { STARTING_SOURCES } from "../contexts/RetirementContext";
import SourceChoice from "./SourceChoice";
import { formatCents, formatPeriod } from "../utils";

/**
 * What the plan starts from: the accounts the user counts as retirement money,
 * or a figure they type.
 *
 * Two answers rather than one, because both are legitimate and neither covers
 * the other. Most of the money is already in the books — a 401(k), a brokerage —
 * and ticking those keeps the projection current every time a statement is
 * entered, which is the whole reason the net-worth page exists. But a pension
 * nobody tracks here, or a scenario that asks "what if I started from a quarter
 * of a million", is a figure with no account behind it, and a planning screen
 * that could not be given one would be a planning screen for one household.
 *
 * The choice not in force is kept, not cleared — see the note in
 * `RetirementContext`. Toggling back and forth to compare is the point.
 *
 * Nothing here is editable beyond the tick: the values are `useNetWorth`'s, and
 * an account is corrected where it is owned, on the balance sheet. What a row
 * does say is where its figure came from, because a holding last valued in March
 * is being counted at March's figure and a plan built on it should say so.
 */

const labelClass = "mb-1.5 block font-mono text-label uppercase text-chalk-soft";

const inputClass =
  "w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure";

// Named distinctly from the spending question's two options, which are the same
// shape of choice on the same page: "a figure I enter" twice over is two radios
// with one name between them, and a reader arriving at the second by keyboard
// would have nothing to tell them apart.
const STARTING_OPTIONS = [
  { value: STARTING_SOURCES.ACCOUNTS, label: "The accounts I tick" },
  { value: STARTING_SOURCES.MANUAL, label: "A balance I enter" },
];

/** The month a hand-valued holding was last given a figure, or where a derived
 *  one comes from. The same distinction `HoldingsTable` draws, said shorter —
 *  this is a picker, not the balance sheet. */
function sourceNote(row) {
  if (!row.hand) return isOffBudget(row.account) ? "Never valued" : "From the ledger";
  return `Valued ${formatPeriod(row.asOf)}`;
}

function AccountRow({ row, striped, onToggle }) {
  return (
    <tr className={striped ? "bg-sheet-alt" : "bg-sheet"}>
      <th scope="row" className="px-4 py-2 text-left font-sans text-row font-normal text-ink">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={row.included}
            onChange={(event) => onToggle({ accountId: row.account.id, included: event.target.checked })}
            className="h-3.5 w-3.5 shrink-0 accent-ink-soft"
          />
          <span>{row.account.name}</span>
        </label>
      </th>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-label uppercase text-ink-soft">
        {scopeLabel(row.account)} · {sourceNote(row)}
      </td>
      <td
        className={`whitespace-nowrap px-3 py-2 text-right font-mono text-row tabular-nums ${
          row.included ? "font-medium text-ink" : "text-ink-soft"
        }`}
      >
        {formatCents(row.valueCents)}
      </td>
    </tr>
  );
}

export default function RetirementStartingPoint({
  plan,
  accountRows,
  selectedCents,
  error,
  onChange,
  onToggleAccount,
}) {
  const byAccounts = plan.startingSource === STARTING_SOURCES.ACCOUNTS;

  // Off budget first: those are the accounts this question is usually about,
  // and a list that opened on the current account would bury them. Stable
  // within each half, so nothing moves when a box is ticked.
  const rows = [
    ...accountRows.filter((row) => isOffBudget(row.account)),
    ...accountRows.filter((row) => !isOffBudget(row.account)),
  ];
  const chosen = rows.filter((row) => row.included).length;

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">
          Starting point
        </h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {byAccounts
            ? `${chosen} of ${rows.length} accounts`
            : "Not read from your accounts"}
        </span>
      </div>

      <div className="border-b border-edge px-4 py-3">
        <SourceChoice
          name="retirement-starting-source"
          legend="Where the starting balance comes from"
          value={plan.startingSource}
          options={STARTING_OPTIONS}
          onChange={(startingSource) => onChange({ startingSource })}
        />
      </div>

      {byAccounts ? (
        rows.length === 0 ? (
          <p className="px-4 py-5 font-sans text-row text-chalk-soft">
            No accounts yet.{" "}
            <Link to="/plan" className="text-azure underline underline-offset-2 hover:text-chalk">
              Add them on the budget plan
            </Link>{" "}
            — the retirement and brokerage accounts belong off budget, where the net-worth page
            values them.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-raised">
                  <th scope="col" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                    Account
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Where the figure comes from
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-mono text-label uppercase text-chalk">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <AccountRow
                    key={row.account.id}
                    row={row}
                    striped={index % 2 === 1}
                    onToggle={onToggleAccount}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-panel-raised">
                  <th scope="row" className="px-4 py-2 text-left font-mono text-label uppercase text-chalk">
                    Counted as retirement savings
                  </th>
                  <td />
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-row font-medium tabular-nums text-chalk">
                    {formatCents(selectedCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : (
        <div className="px-4 py-4">
          <label>
            <span className={labelClass}>Starting balance</span>
            <input
              // Keyed on the stored figure, so a value committed elsewhere —
              // or rejected here — re-seeds the field rather than leaving a
              // stale one in it.
              key={`start-${plan.startingBalanceCents ?? ""}`}
              // Text, like every money field here: a number input refuses
              // "$250,000" outright, and this is a figure people write in full.
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={
                plan.startingBalanceCents == null ? "" : plan.startingBalanceCents / 100
              }
              className={inputClass}
              // On blur, as every panel outside a modal commits: a half-typed
              // "2" on the way to "250000" is a valid figure, and writing it
              // would redraw the whole chart for as long as it took to finish.
              onBlur={(event) => onChange({ startingBalanceCents: event.target.value })}
            />
          </label>
          <p className="mt-2 font-sans text-row text-chalk-soft">
            What you have put aside for retirement today, wherever it is held.
            {selectedCents !== 0 && (
              <>
                {" "}
                Your ticked accounts come to{" "}
                <span className="text-chalk">{formatCents(selectedCents)}</span>.
              </>
            )}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-edge px-4 py-3 font-sans text-row text-vermilion">
          {error}
        </p>
      )}
    </section>
  );
}
