import Button from "./Button";
import { EARN_MODES, formatMultiplier } from "../rewards";
import { amountAtRest, amountEditing, formatBps, formatCents, formatDateMedium } from "../utils";

const formatPoints = (points) => points.toLocaleString("en-US");

const term = "font-mono text-label uppercase text-ink-soft";
const figure = "mt-0.5 font-mono text-row tabular-nums text-ink";
const inlineInput =
  "w-24 border-0 border-b border-transparent bg-transparent px-0 py-0.5 font-mono text-row tabular-nums text-ink outline-none placeholder:text-ink-soft/50 hover:border-rule focus:border-azure";

/** A rate as the card advertises it — the figure the household would recognise. */
export function rateText({ rate, program }) {
  if (rate.mode === EARN_MODES.CASHBACK) return `${formatBps(rate.rateBps)} cash back`;
  return `${formatMultiplier(rate.pointsPer100Dollars)} ${program?.name ?? "a removed program"}`;
}

/** What a rate applies to, resolved live so a rename follows. */
export function countsText({ rate, categories, payees, missing }) {
  if (rate.allSpending) return "Everything else";
  const named = [...categories, ...payees];
  if (named.length === 0) return "Nothing that still exists";
  return missing > 0 ? `${named.join(", ")} (+${missing} since removed)` : named.join(", ");
}

/** What one rate came to over the fee year, in its own unit. */
function earnedText(row, earned) {
  if (!earned) return null;
  if (row.rate.mode === EARN_MODES.CASHBACK) {
    return earned.cashCents > 0 ? formatCents(earned.cashCents) : null;
  }
  if (earned.points <= 0) return null;
  return `${formatPoints(earned.points)} ${row.program?.unit ?? "points"}`;
}

/**
 * Every card the household holds, what it earns, what it costs, and whether
 * the one is covering the other.
 *
 * **A fee is certain and its credits are not**, which is the whole shape of
 * this list: the fee is charged in full on day one, while the credits and the
 * rewards arrive a purchase at a time, so the net figure is read as the
 * question "has this card paid for itself yet this year" rather than as a
 * balance. A card with no fee has nothing to weigh and simply says what it
 * earned.
 *
 * Takes its rows from `useCardValue` and holds no state, `CardOfferList`'s
 * split. The fee commits on **blur** and the renewal date on **change** — a
 * figure typed in place against a control with nothing to half-type — and both
 * inputs are keyed on the stored value, so a refused edit re-seeds.
 */
export default function CardValueList({
  rows,
  onFee,
  onRenews,
  onAddRate,
  onEditRate,
  onDeleteRate,
}) {
  return (
    <ul className="divide-y divide-rule">
      {rows.map((row) => {
        const earnedByRate = new Map(row.earnings.byRate.map((entry) => [entry.rate.id, entry]));
        const hasFee = (row.annualFeeCents ?? 0) > 0;
        const { credits, earnings } = row;
        const onlyPoints = earnings.cashCents === 0 && earnings.points.length === 1;
        return (
          <li key={row.accountId} className="bg-sheet px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h3 className="font-sans text-row font-semibold text-ink">{row.cardName}</h3>
                <p className={term}>
                  {row.feeYear.calendar
                    ? `This year so far — from ${formatDateMedium(row.feeYear.from)}`
                    : `Fee year from ${formatDateMedium(row.feeYear.from)}, renews ${formatDateMedium(
                        row.feeYear.renewsOn
                      )}`}
                </p>
              </div>
              <Button
                variant="row-action"
                size="sm"
                aria-label={`Add rates to ${row.cardName}`}
                onClick={() => onAddRate(row)}
              >
                Add rates
              </Button>
            </div>

            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className={term}>Annual fee</dt>
                <dd className={figure}>
                  {/* The two faces of a money field, `amountAtRest` and
                      `amountEditing`: it reads as money beside the figures it
                      is weighed against, and goes raw under the caret. */}
                  <input
                    key={`fee-${row.accountId}-${row.annualFeeCents ?? ""}`}
                    type="text"
                    inputMode="decimal"
                    aria-label={`${row.cardName} annual fee`}
                    placeholder="None stated"
                    defaultValue={amountAtRest(row.annualFeeCents)}
                    className={inlineInput}
                    onFocus={(event) => {
                      event.target.value = amountEditing(row.annualFeeCents);
                      event.target.select();
                    }}
                    onBlur={(event) => {
                      const typed = event.target.value;
                      if (typed.trim() === amountEditing(row.annualFeeCents)) {
                        event.target.value = amountAtRest(row.annualFeeCents);
                        return;
                      }
                      onFee(row, typed);
                    }}
                  />
                </dd>
                {/* A renewal date is a fact about a fee — with none stated
                    there is nothing for it to date, so it is not asked. */}
                {row.annualFeeCents != null && (
                  <dd className="mt-0.5 flex items-baseline gap-2">
                    <span className={term}>Renews</span>
                    <input
                      key={`renews-${row.accountId}-${row.renewsOn ?? ""}`}
                      type="date"
                      aria-label={`${row.cardName} renews on`}
                      defaultValue={row.renewsOn ?? ""}
                      className={`${inlineInput} w-36 text-ink-soft`}
                      onChange={(event) => onRenews(row, event.target.value)}
                    />
                  </dd>
                )}
              </div>
              <div>
                <dt className={term}>Credits used</dt>
                <dd className={figure}>
                  {credits.rows.length === 0 ? (
                    <span className="text-ink-soft">None tracked</span>
                  ) : (
                    <>
                      {formatCents(credits.usedCents)}
                      <span className="text-ink-soft"> of {formatCents(credits.worthCents)}</span>
                    </>
                  )}
                </dd>
                {credits.leftCents > 0 && (
                  <dd className={`${term} text-azure`}>{formatCents(credits.leftCents)} still to use</dd>
                )}
                {credits.expiredCents > 0 && (
                  <dd className={`${term} text-vermilion-ink`}>
                    {formatCents(credits.expiredCents)} expired unused
                  </dd>
                )}
              </div>
              <div>
                <dt className={term}>Rewards earned</dt>
                <dd className={figure}>{formatCents(earnings.valueCents)}</dd>
                {earnings.points.map((entry) => (
                  <dd key={entry.programId} className={term}>
                    {formatPoints(entry.points)} {entry.program?.unit ?? "points"}
                    {/* The money again only where it is a share of the figure
                        above rather than all of it. */}
                    {!onlyPoints && ` · ${formatCents(entry.valueCents)}`}
                  </dd>
                ))}
                {earnings.cashCents > 0 && earnings.points.length > 0 && (
                  <dd className={term}>{formatCents(earnings.cashCents)} cash back</dd>
                )}
              </div>
              <div>
                <dt className={term}>{hasFee ? "Against the fee" : "Worth this year"}</dt>
                <dd
                  className={`${figure} font-medium ${
                    !hasFee ? "text-ink" : row.netCents >= 0 ? "text-verdant" : "text-vermilion-ink"
                  }`}
                >
                  {hasFee
                    ? `${formatCents(Math.abs(row.netCents))} ${row.netCents >= 0 ? "ahead" : "behind"}`
                    : formatCents(earnings.valueCents + credits.usedCents)}
                </dd>
                {hasFee && (
                  <dd className={term}>
                    {formatCents(earnings.valueCents + credits.usedCents)} back on{" "}
                    {formatCents(row.annualFeeCents)}
                  </dd>
                )}
              </div>
            </dl>

            {row.rates.length === 0 ? (
              <p className="mt-2 font-sans text-row text-ink-soft">
                No rates yet, so nothing is counted for this card. Add what it earns and the
                spending already on your register does the rest.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-rule border-y border-rule">
                {row.rates.map((described) => {
                  const earned = earnedByRate.get(described.rate.id);
                  const text = earnedText(described, earned);
                  return (
                    <li
                      key={described.rate.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="font-sans text-row text-ink">
                          <span className="font-mono tabular-nums font-medium">
                            {formatBps(described.bps)}
                          </span>{" "}
                          — {rateText(described)}
                        </p>
                        <p className={term}>{countsText(described)}</p>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-row tabular-nums text-ink-soft">
                          {text ?? "—"}
                        </span>
                        <Button
                          variant="row-action"
                          size="sm"
                          aria-label={`Edit ${rateText(described)} on ${row.cardName}`}
                          onClick={() => onEditRate(described.rate)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="row"
                          size="sm"
                          aria-label={`Remove ${rateText(described)} from ${row.cardName}`}
                          onClick={() => onDeleteRate(described.rate)}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {row.postedBps > 0 && (
              <p className="mt-2 font-sans text-row text-sulfur">
                {formatBps(row.postedBps)} of this card's cash back already posts onto its own
                balance as a refund in your register, so it is counted in your budget rather than
                here. Don't enter it as a rate as well, or it is promised twice.
              </p>
            )}
            {earnings.unratedCents > 0 && row.rates.length > 0 && (
              <p className="mt-2 font-sans text-row text-ink-soft">
                {formatCents(earnings.unratedCents)} of spending on this card is not covered by any
                rate above, so nothing is claimed for it.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
