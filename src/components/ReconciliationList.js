import Button from "./Button";
import { ACCOUNT_TYPES, scopeLabel } from "../contexts/AccountsContext";
import { formatCents, formatDateMedium, formatDayDelta } from "../utils";

/**
 * Every account, what it holds, and when it was last checked against a
 * statement.
 *
 * The balance beside it is derived — opening plus every transaction through the
 * account — and the reconciliation date is the only thing here that is not. That
 * is exactly why the two belong on one row: the derived figure is only worth
 * trusting as far as the last day someone confirmed it matched the bank, and a
 * balance with no date beside it invites more confidence than the books have
 * earned.
 *
 * Off-budget accounts are listed too, unlike in the transaction form. Nothing is
 * assigned out of them, but a brokerage nobody has looked at since last year is
 * precisely the account whose figure has quietly gone wrong.
 */

// A month. Long enough that an account checked at the last statement is not
// nagged about, short enough that a figure nobody has confirmed this cycle is.
const STALE_AFTER_DAYS = 31;

/**
 * How the date reads, and whether it needs attention.
 *
 * Colour is never the only channel — the state has a word of its own on the row
 * — and on this light surface `vermilion-ink` is the one warning tone that
 * carries text, since the accents are tuned for the dark chrome.
 */
function reconciliation(account, daysSince) {
  if (account.reconciledOn == null) {
    return { text: "Never", note: "Not checked yet", tone: "text-vermilion-ink" };
  }
  return {
    text: formatDateMedium(account.reconciledOn),
    note: formatDayDelta(-daysSince),
    tone: daysSince > STALE_AFTER_DAYS ? "text-vermilion-ink" : "text-ink",
  };
}

function ReconciliationRow({ account, balanceCents, daysSince, striped, onReconcile }) {
  const status = reconciliation(account, daysSince);
  // The same single definition of trouble as everywhere else: something owned
  // that has gone under. A debt is negative by definition.
  const overdrawn = account.type !== ACCOUNT_TYPES.LIABILITY && balanceCents < 0;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 ${striped ? "bg-sheet-alt" : "bg-sheet"}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-sans text-row text-ink">{account.name}</div>
        <div className="truncate font-mono text-label uppercase text-ink-soft">
          {scopeLabel(account)}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={`font-mono text-row font-medium tabular-nums ${
            overdrawn ? "text-vermilion-ink" : "text-ink"
          }`}
        >
          {formatCents(balanceCents)}
        </div>
        <div className={`whitespace-nowrap font-mono text-label uppercase ${status.tone}`}>
          {status.text} · {status.note}
        </div>
      </div>

      <Button
        variant="row-action"
        size="sm"
        aria-label={`Mark ${account.name} reconciled`}
        onClick={() => onReconcile(account)}
      >
        Reconcile
      </Button>
    </div>
  );
}

export default function ReconciliationList({ rows, onReconcile }) {
  const unchecked = rows.filter(
    (row) => row.account.reconciledOn == null || row.daysSince > STALE_AFTER_DAYS
  ).length;

  return (
    <section className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">Accounts</h2>
          <p className="mt-0.5 font-sans text-row text-chalk-soft">
            Balance, and when it last agreed with the statement.
          </p>
        </div>
        {rows.length > 0 && (
          <span
            className={`font-mono text-label uppercase ${
              unchecked > 0 ? "text-sulfur" : "text-verdant"
            }`}
          >
            {unchecked > 0 ? `${unchecked} need checking` : "All up to date"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-sans text-row text-chalk-soft">
          No accounts yet. Add one on the budget plan and its balance will follow the ledger from
          there.
        </p>
      ) : (
        rows.map((row, index) => (
          <ReconciliationRow
            key={row.account.id}
            account={row.account}
            balanceCents={row.balanceCents}
            daysSince={row.daysSince}
            striped={index % 2 === 1}
            onReconcile={onReconcile}
          />
        ))
      )}
    </section>
  );
}
