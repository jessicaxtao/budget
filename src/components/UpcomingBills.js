import { Link } from "react-router-dom";
import Button from "./Button";
import { TRANSACTION_KINDS } from "../contexts/TransactionsContext";
import { formatCents, formatDateMedium, formatDayDelta, formatDayShort } from "../utils";

/**
 * What is due next, and what was due already.
 *
 * The dashboard's subject is "where am I right now", and a bill falling on
 * Thursday is exactly that — it is the same question the paycheque countdown in
 * the summary above already answers from the other side. The two belong on one
 * page for that reason: what is coming in, and what is going out before it does.
 *
 * **Overdue leads, and it is a word before it is a colour.** A row nobody has
 * entered is the whole reason this panel exists, so it sorts first (the hook's
 * doing) and says "3 days ago" in `vermilion-ink` — the one warning tone that
 * carries text on this light surface. `ReconciliationList` states the same rule
 * for a stale reconciliation, and for the same reason: colour is never the only
 * channel.
 *
 * **Two actions, and neither of them writes silently.** Enter opens a small form
 * seeded from the schedule, because the two things that actually vary about a
 * recurring bill are the amount and the day it went out — a panel that wrote
 * $180.00 the moment a button was pressed would be a ledger asserting a figure
 * nobody read off a statement. Skip records that the occurrence was decided about
 * without writing anything, which is what a month the gym was closed looks like.
 *
 * Prop-driven, `ReconciliationList`'s call: the page resolves the payee, the
 * account and the category, because a name is not money and this panel is worth
 * being able to test without three stores behind it.
 */

/** How the due date reads, and whether it needs attention. */
function due(row) {
  if (row.overdue) {
    return { tone: "text-vermilion-ink", note: formatDayDelta(row.dueInDays) };
  }
  return {
    tone: row.dueInDays === 0 ? "text-sulfur" : "text-ink-soft",
    note: formatDayDelta(row.dueInDays),
  };
}

function UpcomingRow({ row, striped, describe, onEnter, onSkip, matches = [], onMatch }) {
  const status = due(row);
  const isInflow = row.schedule.kind === TRANSACTION_KINDS.INFLOW;
  const { name, filing } = describe(row.schedule);
  // The occurrence, not the schedule: two rows of one schedule are two different
  // things to say out loud, and a label naming only the payee would be ambiguous
  // on a weekly bill.
  const label = `${name} due ${formatDateMedium(row.date)}`;

  return (
    /**
     * **The name and the figure first, everything else beneath.** The two facts
     * a reader scans for share the top line — the name taking the room it needs
     * on the left and the figure pinned right, so a long payee truncates rather
     * than shoving the amount onto a line of its own. Below it sit where the
     * money comes from, when it is due, and the two actions.
     *
     * The filing then takes a line of its own, and the due date and the two
     * actions share the line below it. The filing is not folded in beside the
     * date to save a line because this panel is always a narrow column of the
     * dashboard grid, never full width — and "EVERYDAY CHECKING · INS…" trimmed
     * to the account alone has lost the category, which is the half worth
     * reading. A line each keeps both whole at every width.
     */
    <div className={`px-4 py-2.5 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}>
      <div className="flex items-baseline gap-x-3">
        <div className="min-w-0 flex-1 truncate font-sans text-row text-ink">{name}</div>
        <div
          className={`shrink-0 font-mono text-row font-medium tabular-nums ${isInflow ? "text-verdant" : "text-vermilion-ink"}`}
        >
          {isInflow ? "+" : "−"}
          {formatCents(row.schedule.amountCents)}
        </div>
      </div>
      {row.isPaycheck && (
        <p className="mt-0.5 text-label uppercase text-ink-soft">
          Estimate based on {row.estimateBasis}
        </p>
      )}
      {matches.length > 0 && (
        <div className="mt-3 border-t border-rule pt-2 text-row text-ink">
          <p>{matches.length === 1 ? "Possible payment already recorded" : "Several payments could match — choose the one for this reminder"}</p>
          <ul className="mt-1 space-y-2">
            {matches.map((transaction, index) => <li key={transaction.id}>
              <p>Payment {index + 1}: {formatDateMedium(transaction.date)} · {formatCents(transaction.amountCents)}{transaction.description ? ` · ${transaction.description}` : ""}</p>
              <Button variant="row-action" size="sm"
                aria-label={`Use payment ${index + 1} for ${label}`}
                onClick={() => onMatch(row, transaction.id)}>Use this payment</Button>
            </li>)}
          </ul>
          <p className="mt-1 text-ink-soft">Marks this reminder handled and keeps the existing ledger entry.</p>
        </div>
      )}

      <div className="mt-1 flex flex-col gap-y-1">
        <div className="min-w-0 truncate text-label uppercase text-ink-soft">
          {filing}
        </div>
        <div className="flex items-center gap-x-3">
          <div className={`whitespace-nowrap text-label uppercase ${status.tone}`}>
            {formatDayShort(row.date)} · {status.note}
          </div>
          {!row.isPaycheck && <span className="ml-auto inline-flex shrink-0 items-center gap-1">
            {/* Enter before Skip, and drawn as a button where Skip is bare text:
                the quiet one is the one that throws an occurrence away. */}
            <Button
              variant="row-action"
              size="sm"
              aria-label={`Enter ${label}`}
              onClick={() => onEnter(row)}
            >
              Enter
            </Button>
            <Button variant="row" size="sm" aria-label={`Skip ${label}`} onClick={() => onSkip(row)}>
              Skip
            </Button>
          </span>}
        </div>
      </div>
    </div>
  );
}

export default function UpcomingBills({
  rows,
  overdueCount,
  dueCents,
  windowDays,
  scheduleCount,
  describe,
  onEnter,
  onSkip,
  matches,
  onMatch,
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Upcoming</h2>
          {rows.length > 0 && (
            <p className="mt-0.5 font-sans text-row text-chalk-soft">
              {/* The total is money *out* only, and says so: netting an expected
                  paycheque off it would report a smaller bill than has to be paid. */}
              {`${formatCents(dueCents)} going out in the next ${windowDays} days.`}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <span
            className={`text-label uppercase ${
              overdueCount > 0 ? "text-vermilion" : "text-verdant"
            }`}
          >
            {overdueCount > 0
              ? `${overdueCount} ${overdueCount === 1 ? "is" : "are"} overdue`
              : "Nothing overdue"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          {scheduleCount === 0 ? (
            <>
              Nothing scheduled yet.{" "}
              <Link to="/settings" className="text-azure underline underline-offset-2 hover:text-chalk">
                Add a scheduled transaction
              </Link>{" "}
              and what is due will appear here — nothing is ever recorded until you say so.
            </>
          ) : (
            // Everything is dealt with, which is a different fact from having no
            // schedules at all and has to read as one.
            <>Nothing due in the next {windowDays} days. Everything scheduled is up to date.</>
          )}
        </p>
      ) : (
        rows.map((row, index) => (
          <UpcomingRow
            key={row.key}
            row={row}
            striped={index % 2 === 1}
            describe={describe}
            onEnter={onEnter}
            onSkip={onSkip}
            matches={matches?.get(row.key)}
            onMatch={onMatch}
          />
        ))
      )}
    </section>
  );
}
