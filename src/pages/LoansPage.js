import { useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
import Button from "../components/Button";
import AddLoanModal from "../components/AddLoanModal";
import { useAccounts } from "../contexts/AccountsContext";
import { useLoans as useLoansStore } from "../contexts/LoansContext";
import useLoans from "../hooks/useLoans";
import { amortize, compareWhatIf } from "../domain/amortization";
import {
  amountEditing,
  formatBps,
  formatCents,
  formatPeriod,
  fromBps,
  todayISO,
  toPeriod,
} from "../utils";

/**
 * Every amortizing loan, read beside what the books say each one owes.
 *
 * No month stepper — like Retirement, almost nothing here is about a month, and
 * the one dated figure (owed) says which statement it came from. The maths lives
 * in `src/domain/amortization.js` and the join in `src/hooks/useLoans.js`; this
 * page only arranges and labels it (`.claude/LOANS.md`).
 */

function monthsToWords(months) {
  if (months <= 0) return "paid off";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years > 1 ? "s" : ""}`);
  if (rest) parts.push(`${rest} month${rest > 1 ? "s" : ""}`);
  return `${parts.join(" ")} to go`;
}

const monthYear = (date) => (date ? formatPeriod(toPeriod(date)) : "—");

/** The extra payments a sensitivity row stands for. */
const SENSITIVITY_STEPS = [5000, 10000, 25000, 50000];

/** Walk the projection again with a different set of extras, from the same owed
 *  figure today — the arithmetic behind the what-if and the sensitivity table. */
function walkProjection(row, extras) {
  return amortize({
    balanceCents: row.owedCents,
    rateBps: row.loan.rateBps,
    paymentCents: row.paymentCents,
    fromDate: row.nextPaymentDate ?? row.loan.firstPaymentDate,
    rateChanges: row.loan.rateChanges,
    balloonCents: row.loan.balloonCents,
    extras,
  });
}

/* --------------------------------------------------------------- the list */

function LoanCard({ row, name, selected, onSelect }) {
  const repaidBps =
    row.loan.originalPrincipalCents > 0
      ? Math.max(
          0,
          Math.min(10000, Math.round(((row.loan.originalPrincipalCents - row.owedCents) / row.loan.originalPrincipalCents) * 10000))
        )
      : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border bg-panel p-4 text-left transition-colors ${
        selected ? "border-tab-teal" : "border-edge hover:border-chalk-soft"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-sans text-row font-semibold text-chalk">{name}</span>
        <span className="font-mono text-lg text-chalk">{formatCents(row.owedCents)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-band">
        <div className="h-full rounded-full bg-tab-teal" style={{ width: `${repaidBps / 100}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 font-sans text-label text-chalk-soft">
        <span>{formatCents(row.paymentCents)}/mo</span>
        <span>{row.neverPaysOff ? "does not pay off" : `paid off ${monthYear(row.summary.payoffDate)}`}</span>
      </div>
    </button>
  );
}

/* --------------------------------------------------------------- the hero */

function Hero({ row }) {
  const { summary, loan } = row;
  const repaidBps =
    loan.originalPrincipalCents > 0
      ? Math.max(0, Math.min(10000, Math.round(((loan.originalPrincipalCents - row.owedCents) / loan.originalPrincipalCents) * 10000)))
      : 0;

  const aheadMagnitude = Math.abs(row.aheadCents);
  const firstPrincipal = row.projection.rows[0]?.principalCents ?? 0;
  let drift = null;
  if (aheadMagnitude > firstPrincipal) {
    drift =
      row.aheadCents > 0
        ? `Your last statement is ${formatCents(aheadMagnitude)} ahead of schedule.`
        : `Your last statement is ${formatCents(aheadMagnitude)} behind schedule.`;
  }

  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <p className="font-mono text-3xl text-chalk">{formatCents(row.owedCents)} owed</p>
      <p className="mt-1 font-sans text-row text-chalk-soft">
        {row.neverPaysOff
          ? "At this payment the balance never clears — the payment does not cover the interest."
          : `${monthsToWords(summary.paymentsLeft)} · paid off ${monthYear(summary.payoffDate)}`}
      </p>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-band">
        <div className="h-full rounded-full bg-tab-teal" style={{ width: `${repaidBps / 100}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 font-sans text-label text-chalk-soft">
        <span>{(repaidBps / 100).toFixed(0)}% of principal repaid</span>
        {loan.firstPaymentDate && <span>payment {row.paymentsElapsed} of {loan.termMonths}</span>}
      </div>

      {row.owedSource.kind === "derived" && (
        <p className="mt-3 font-sans text-label text-chalk-soft">
          Owed is the books’ own figure — no statement entered yet. Enter one in the Net worth monthly pass.
        </p>
      )}
      {drift && <p className="mt-3 font-sans text-row text-azure">{drift}</p>}
    </div>
  );
}

/* -------------------------------------------------------------- the tiles */

function Tile({ label, children }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <p className="text-label uppercase text-chalk-soft">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function SplitBar({ segments }) {
  const total = segments.reduce((sum, s) => sum + s.cents, 0) || 1;
  return (
    <>
      <div className="flex h-2 overflow-hidden rounded-full bg-band">
        {segments.map((s) => (
          <div key={s.label} className={s.className} style={{ width: `${(s.cents / total) * 100}%` }} />
        ))}
      </div>
      <dl className="mt-2 space-y-0.5">
        {segments.map((s) => (
          <div key={s.label} className="flex justify-between font-sans text-label text-chalk-soft">
            <dt>{s.label}</dt>
            <dd className="font-mono text-chalk">{formatCents(s.cents)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Tiles({ row }) {
  const next = row.projection.rows[0];
  const escrow = row.loan.escrowCents ?? 0;
  const pmi = row.loan.pmiCents ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Next payment">
        {next ? (
          <SplitBar
            segments={[
              { label: "Principal", cents: next.principalCents, className: "bg-verdant" },
              { label: "Interest", cents: next.interestCents, className: "bg-vermilion" },
              ...(escrow ? [{ label: "Escrow", cents: escrow, className: "bg-azure" }] : []),
              ...(pmi ? [{ label: "PMI", cents: pmi, className: "bg-property" }] : []),
            ]}
          />
        ) : (
          <p className="font-sans text-row text-chalk-soft">Paid off.</p>
        )}
      </Tile>

      <Tile label="Paid so far (by the schedule)">
        <dl className="space-y-0.5">
          <div className="flex justify-between font-sans text-label text-chalk-soft">
            <dt>Principal</dt>
            <dd className="font-mono text-chalk">{formatCents(row.paidSoFar.principalCents)}</dd>
          </div>
          <div className="flex justify-between font-sans text-label text-chalk-soft">
            <dt>Interest</dt>
            <dd className="font-mono text-chalk">{formatCents(row.paidSoFar.interestCents)}</dd>
          </div>
        </dl>
      </Tile>

      <Tile label="Equity">
        {row.equityCents != null ? (
          <>
            <p className="font-mono text-xl text-chalk">{formatCents(row.equityCents)}</p>
            <p className="mt-1 font-sans text-label text-chalk-soft">
              {row.ltvBps != null ? `${formatBps(row.ltvBps)} loan-to-value` : "value of the collateral less what is owed"}
            </p>
          </>
        ) : (
          <p className="font-sans text-row text-chalk-soft">No collateral named.</p>
        )}
      </Tile>

      <Tile label="Interest still to pay">
        <p className="font-mono text-xl text-chalk">{formatCents(row.interestRemainingCents)}</p>
        {row.summary.crossover && (
          <p className="mt-1 font-sans text-label text-chalk-soft">
            From {monthYear(row.summary.crossover.date)}, more of each payment is principal.
          </p>
        )}
      </Tile>
    </div>
  );
}

/* -------------------------------------------------- balance over time chart */

const CHART = { w: 760, h: 240, padL: 56, padR: 16, padT: 16, padB: 28 };

function BalanceChart({ row }) {
  const { contract, loan } = row;
  const collateralValue = loan.collateralValueCents;
  const rate = row.collateralRateBps != null ? fromBps(row.collateralRateBps) : null;

  const points = useMemo(() => {
    // Sample the contract roughly every three months so a thirty-year loan is a
    // readable line rather than 360 segments.
    const stride = Math.max(1, Math.round(contract.rows.length / 120));
    const sampled = contract.rows.filter((_, i) => i % stride === 0 || i === contract.rows.length - 1);
    return sampled.map((r, i) => {
      const yearsIn = (r.n - 1) / 12;
      const collateral =
        collateralValue && rate != null ? Math.round(collateralValue * (1 + rate) ** yearsIn) : null;
      return { n: r.n, date: r.date, balance: r.balanceCents, collateral, i };
    });
  }, [contract.rows, collateralValue, rate]);

  if (points.length === 0) return null;

  const maxY = Math.max(
    loan.originalPrincipalCents,
    ...points.map((p) => p.collateral ?? 0)
  ) || 1;
  const n = points.length;
  const plotW = CHART.w - CHART.padL - CHART.padR;
  const plotH = CHART.h - CHART.padT - CHART.padB;
  const x = (i) => CHART.padL + (plotW * i) / Math.max(1, n - 1);
  const y = (v) => CHART.padT + plotH * (1 - v / maxY);

  const line = (pick) =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`)
      .join(" ");

  const todayIndex = points.findIndex((p) => p.balance <= row.owedCents);

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <h3 className="mb-3 font-sans text-row font-semibold text-chalk">Balance over time</h3>
      <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className="w-full" role="img" aria-label="Loan balance falling over time against the collateral's value">
        {/* y gridlines */}
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={CHART.padL} x2={CHART.w - CHART.padR} y1={y(maxY * t)} y2={y(maxY * t)} className="stroke-rule" strokeWidth="1" />
            <text x={CHART.padL - 6} y={y(maxY * t) + 4} textAnchor="end" className="fill-chalk-soft font-mono text-[10px]">
              {formatCents(Math.round(maxY * t)).replace(/\.00$/, "")}
            </text>
          </g>
        ))}

        {/* collateral value, where there is one — equity is the gap to the balance */}
        {points[0]?.collateral != null && (
          <path d={line((p) => p.collateral)} fill="none" className="stroke-property" strokeWidth="2" strokeDasharray="2 3" />
        )}

        {/* the contract balance */}
        <path d={line((p) => p.balance)} fill="none" className="stroke-tab-teal" strokeWidth="2.5" />

        {/* today */}
        {todayIndex > 0 && (
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1={CHART.padT} y2={CHART.padT + plotH} className="stroke-chalk-soft" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* x labels: first and last year */}
        <text x={CHART.padL} y={CHART.h - 8} textAnchor="start" className="fill-chalk-soft font-mono text-[10px]">
          {monthYear(points[0]?.date)}
        </text>
        <text x={CHART.w - CHART.padR} y={CHART.h - 8} textAnchor="end" className="fill-chalk-soft font-mono text-[10px]">
          {monthYear(points[n - 1]?.date)}
        </text>
      </svg>
      {points[0]?.collateral != null && (
        <p className="mt-2 font-sans text-label text-chalk-soft">
          <span className="text-property">Dashed</span> is the collateral’s value; the gap above the balance is equity.
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------- pay it off faster */

function MoneyInput({ id, label, defaultCents, onCommit, placeholder = "$0.00" }) {
  return (
    <label className="block">
      <span className="mb-1 block text-label uppercase text-chalk-soft">{label}</span>
      <input
        key={id}
        type="text"
        inputMode="decimal"
        defaultValue={defaultCents ? amountEditing(defaultCents) : ""}
        placeholder={placeholder}
        onBlur={(e) => onCommit(e.target.value)}
        className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-row text-chalk outline-none focus:border-azure"
      />
    </label>
  );
}

function PayItOffFaster({ row }) {
  const { setLoanWhatIf } = useLoansStore();
  const whatIf = row.loan.whatIf;

  const commit = (patch) => setLoanWhatIf({ id: row.loan.id, ...patch });

  const sensitivity = useMemo(
    () =>
      SENSITIVITY_STEPS.map((cents) => {
        const plan = walkProjection(row, { extraMonthlyCents: cents });
        return { cents, ...compareWhatIf(row.projection, plan) };
      }),
    [row]
  );

  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <h3 className="mb-1 font-sans text-row font-semibold text-chalk">Pay it off faster</h3>
      <p className="mb-4 font-sans text-label text-chalk-soft">
        A guess that moves no money — nothing changes in the books until you actually pay more.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MoneyInput
          id={`extra-monthly-${whatIf.extraMonthlyCents}`}
          label="Extra each month"
          defaultCents={whatIf.extraMonthlyCents}
          onCommit={(v) => commit({ extraMonthly: v })}
        />
        <MoneyInput
          id={`extra-yearly-${whatIf.extraYearlyCents}`}
          label="Extra each year"
          defaultCents={whatIf.extraYearlyCents}
          onCommit={(v) => commit({ extraYearly: v })}
        />
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={whatIf.biweekly}
          onChange={(e) => commit({ biweekly: e.target.checked })}
          className="h-3.5 w-3.5 accent-azure"
        />
        <span className="font-sans text-row text-chalk">Pay half every two weeks (one extra payment a year)</span>
      </label>

      {row.whatIfSummary ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Months sooner">
            <p className="font-mono text-xl text-chalk">{row.whatIfSummary.monthsSooner}</p>
          </Tile>
          <Tile label="Interest saved">
            <p className="font-mono text-xl text-verdant">{formatCents(row.whatIfSummary.interestSavedCents)}</p>
          </Tile>
          <Tile label="New payoff">
            <p className="font-mono text-xl text-chalk">{monthYear(row.whatIfSummary.payoffDate)}</p>
          </Tile>
        </div>
      ) : (
        <p className="mt-4 font-sans text-row text-chalk-soft">
          Enter an extra payment to see how much sooner the loan ends and how much interest it saves.
        </p>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-collapse font-sans text-row">
          <caption className="mb-2 text-left text-label uppercase text-chalk-soft">
            If I paid more each month
          </caption>
          <thead>
            <tr className="border-b border-rule text-left text-label uppercase text-chalk-soft">
              <th className="py-1.5 pr-4 font-medium">Extra</th>
              <th className="py-1.5 pr-4 text-right font-medium">Months sooner</th>
              <th className="py-1.5 text-right font-medium">Interest saved</th>
            </tr>
          </thead>
          <tbody>
            {sensitivity.map((s) => (
              <tr key={s.cents} className="border-b border-rule/50">
                <td className="py-1.5 pr-4 font-mono text-chalk">+{formatCents(s.cents)}</td>
                <td className="py-1.5 pr-4 text-right font-mono text-chalk">{s.monthsSooner}</td>
                <td className="py-1.5 text-right font-mono text-verdant">{formatCents(s.interestSavedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 font-sans text-label leading-relaxed text-chalk-soft">
        Paying the loan off is a guaranteed return at its rate ({formatBps(row.loan.rateBps)}). Weigh that against
        what the money could earn invested — and keep a full emergency fund before paying a loan down early.
      </p>
    </div>
  );
}

/* ------------------------------------------------------ kind-specific panel */

function MortgagePanel({ row }) {
  if (row.loan.kind !== "mortgage" || !row.pmi) return null;
  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <h3 className="mb-2 font-sans text-row font-semibold text-chalk">PMI</h3>
      <dl className="space-y-1 font-sans text-row text-chalk-soft">
        <div className="flex justify-between">
          <dt>Can be requested (80% LTV)</dt>
          <dd className="font-mono text-chalk">{monthYear(row.pmi.requestDate)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Drops automatically (78% LTV)</dt>
          <dd className="font-mono text-chalk">{monthYear(row.pmi.autoDate)}</dd>
        </div>
        {row.pmi.whatIfRequestDate && row.pmi.whatIfRequestDate !== row.pmi.requestDate && (
          <div className="flex justify-between">
            <dt>With your extra payments</dt>
            <dd className="font-mono text-verdant">{monthYear(row.pmi.whatIfRequestDate)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function CarPanel({ row }) {
  if (row.loan.kind !== "auto" || row.equityCents == null) return null;
  const underwater = row.equityCents < 0;
  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <h3 className="mb-2 font-sans text-row font-semibold text-chalk">Above / below water</h3>
      <p className="font-sans text-row text-chalk-soft">
        The car is worth {formatCents(row.collateralCurrentCents ?? 0)} and you owe {formatCents(row.owedCents)}.{" "}
        {underwater ? (
          <span className="text-vermilion">
            You are underwater by {formatCents(-row.equityCents)} — selling today would not clear the loan.
          </span>
        ) : (
          <span className="text-verdant">Selling today would leave {formatCents(row.equityCents)} after clearing the loan.</span>
        )}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- full schedule */

function ScheduleDetails({ row, today }) {
  return (
    <details className="rounded-xl border border-edge bg-panel">
      <summary className="cursor-pointer px-5 py-4 font-sans text-row font-semibold text-chalk">
        Full schedule ({row.contract.rows.length} payments)
      </summary>
      <div className="max-h-96 overflow-y-auto border-t border-edge">
        <table className="w-full border-collapse font-mono text-label">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-rule text-right text-chalk-soft">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Interest</th>
              <th className="px-3 py-2 font-medium">Principal</th>
              <th className="px-3 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {row.contract.rows.map((r) => {
              const past = r.date <= today;
              const current = !past && row.nextPaymentDate === r.date;
              return (
                <tr
                  key={r.n}
                  className={`border-b border-rule/40 text-right ${current ? "bg-tab-teal/15 text-chalk" : past ? "text-chalk-soft/50" : "text-chalk"}`}
                >
                  <td className="px-3 py-1.5 text-left">{r.n}</td>
                  <td className="px-3 py-1.5 text-left">{r.date}</td>
                  <td className="px-3 py-1.5">{formatCents(r.interestCents)}</td>
                  <td className="px-3 py-1.5">{formatCents(r.principalCents)}</td>
                  <td className="px-3 py-1.5">{formatCents(r.balanceCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* --------------------------------------------------------------- the page */

export default function LoansPage() {
  const { rows, totalOwedCents, totalMonthlyPaymentCents, debtFreeDate, anyNeverPaysOff } = useLoans();
  const { accounts } = useAccounts();
  const { deleteLoan } = useLoansStore();
  const [showModal, setShowModal] = useState(false);
  const [editingLoan, setEditingLoan] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const today = todayISO();
  const nameOf = (loan) =>
    accounts.find((a) => a.id === loan.accountId)?.name ?? "Account removed";

  const selected = rows.find((r) => r.loan.id === selectedId) ?? (rows.length === 1 ? rows[0] : null);

  function handleAdd() {
    setEditingLoan(null);
    setShowModal(true);
  }

  return (
    <>
      <PageHeader
        title="Loans"
        actions={
          <Button variant="primary" onClick={handleAdd}>
            Add loan
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-edge bg-panel p-8 text-center">
          <p className="font-sans text-row text-chalk-soft">
            No loans yet. Add a mortgage, a car loan or any amortizing loan to see how much is left, how
            long until it is gone, and what paying more would buy.
          </p>
          <div className="mt-4 flex justify-center">
            <Button variant="primary" onClick={handleAdd}>
              Add a loan
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {rows.length > 1 && (
            <div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((row) => (
                  <LoanCard
                    key={row.loan.id}
                    row={row}
                    name={nameOf(row.loan)}
                    selected={selected?.loan.id === row.loan.id}
                    onSelect={() => setSelectedId(row.loan.id)}
                  />
                ))}
              </div>
              <p className="mt-3 font-sans text-row text-chalk-soft">
                <span className="font-mono text-chalk">{formatCents(totalOwedCents)}</span> owed across{" "}
                {rows.length} loans · <span className="font-mono text-chalk">{formatCents(totalMonthlyPaymentCents)}</span>/mo ·{" "}
                {anyNeverPaysOff ? "one loan does not pay off" : `debt-free ${monthYear(debtFreeDate)}`}
              </p>
            </div>
          )}

          {selected ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-xl text-chalk">{nameOf(selected.loan)}</h2>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditingLoan(selected.loan); setShowModal(true); }}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => { if (selectedId === selected.loan.id) setSelectedId(null); deleteLoan({ id: selected.loan.id }); }}>
                    Remove
                  </Button>
                </div>
              </div>

              {selected.accountRemoved && (
                <p className="rounded-lg border border-edge bg-panel-raised px-4 py-3 font-sans text-row text-chalk-soft">
                  The account this loan was against has been removed. Its schedule is still readable below.
                </p>
              )}

              <Hero row={selected} />
              <Tiles row={selected} />
              <BalanceChart row={selected} />
              <PayItOffFaster row={selected} />
              <MortgagePanel row={selected} />
              <CarPanel row={selected} />
              <ScheduleDetails row={selected} today={today} />
            </div>
          ) : (
            <p className="font-sans text-row text-chalk-soft">Pick a loan above to open it.</p>
          )}
        </div>
      )}

      <AddLoanModal show={showModal} loan={editingLoan} handleClose={() => setShowModal(false)} />
    </>
  );
}
