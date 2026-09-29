/**
 * What a set of books actually holds, counted.
 *
 * **A confirmation that says "your data" is asking the user to take it on
 * trust; one that says "412 transactions" lets them notice it should have been
 * four thousand and stop.** That is the whole job, and it is why this is a
 * shared component rather than a paragraph written twice: it is read at the two
 * moments in the app where books are about to be overwritten — the one-time
 * import on sign-in, and a restore from a file — and the two must not be able
 * to count differently.
 *
 * It takes a snapshot, the `{ key: value }` shape `snapshotScope` returns and
 * `restoreScope` takes, so the thing being counted is exactly the thing being
 * written.
 */
export default function BooksSummary({ snapshot, label }) {
  const size = (key) => (Array.isArray(snapshot?.[key]) ? snapshot[key].length : 0);

  const rows = [
    // The legacy pair folds into the ledger on read, so it is counted as part of
    // the same figure rather than listed as two stores nobody recognises.
    ["Transactions", size("transactions") + size("expenses") + size("income")],
    ["Categories", size("budgets")],
    ["Accounts", size("accounts")],
    ["Savings goals", size("savingsGoals")],
    ["Donations", size("donations")],
    ["Balance records", size("accountBalances")],
  ].filter(([, count]) => count > 0);

  if (rows.length === 0) {
    // Not nothing: where two sets of books are shown side by side, the side that
    // is empty is the answer the user needs most, and a missing panel reads as a
    // rendering fault rather than as "there is nothing here".
    return (
      <div className="border border-rule bg-sheet px-4 py-2">
        {label && <p className="font-mono text-label uppercase text-ink-soft">{label}</p>}
        <p className="font-sans text-row text-ink-soft">Empty — no books here.</p>
      </div>
    );
  }

  return (
    <div className="border border-rule bg-sheet">
      {label && (
        <p className="border-b border-rule px-4 py-2 font-mono text-label uppercase text-ink-soft">
          {label}
        </p>
      )}
      <dl className="divide-y divide-rule">
        {rows.map(([name, count]) => (
          <div key={name} className="flex items-baseline justify-between px-4 py-2">
            <dt className="font-sans text-row text-ink-soft">{name}</dt>
            <dd className="font-mono text-row tabular-nums text-ink">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
