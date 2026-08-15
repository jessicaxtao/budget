import { GOAL_SOURCES } from "../contexts/DonationsContext";
import { formatBps, formatCents } from "../utils";

/**
 * The four figures a year of giving comes down to: what was given, how much of
 * it can be claimed, what share of income it was, and what the household meant
 * to give.
 *
 * The first two are not the same question asked twice. A household gives to a
 * school raffle, buys a table at a gala, sends money to a neighbour's fund — all
 * of it giving, none of it deductible — and the gap between the two figures is
 * the one this page exists to make visible, because it is the figure people are
 * surprised by in April.
 *
 * The third is the one most households are actually asking about, and it needs no
 * goal to be set: giving is usually thought of as a share of what comes in, and
 * the share is computed off income actually recorded rather than off what the
 * plan expects — this is a report of a year, not a projection.
 */

const TICKS = 24;

/**
 * Progress towards a giving goal, drawn as the same ticks as every meter in the
 * app with **the tone reversed** — full means the goal is met, not that
 * something is spent out.
 *
 * Local rather than shared for exactly the reason `RetirementOutlook`'s
 * `FundedMeter` is: `TallyGauge` reads a full bar as trouble, and one component
 * reading both ways would be a trap for whichever caller came next. It is not a
 * call to that one either, for the same reason.
 */
function GivenMeter({ ratio, label }) {
  const filled = Math.max(0, Math.min(TICKS, Math.round(ratio * TICKS)));
  const tone = ratio >= 1 ? "bg-verdant" : ratio >= 0.5 ? "bg-sulfur" : "bg-azure";

  return (
    <div
      className="flex gap-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <span key={index} className={`h-3 w-[3px] ${index < filled ? tone : "bg-edge"}`} />
      ))}
    </div>
  );
}

function Tile({ label, figure, tone = "text-chalk", note }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-mono text-label uppercase text-chalk-soft">{label}</dt>
      <dd className={`mt-1 font-mono text-figure font-medium tabular-nums ${tone}`}>{figure}</dd>
      <dd className="mt-0.5 font-mono text-label uppercase text-chalk-soft">{note}</dd>
    </div>
  );
}

/** What the goal is a goal *of*, said where the figure is — a target that moves
 *  with income has to say so, or it reads as a figure that changed itself. */
function goalNote(goal, year) {
  if (!goal.stated) return `No goal set for ${year}`;
  if (goal.source === GOAL_SOURCES.INCOME_SHARE) {
    return `${formatBps(goal.shareBps)} of ${formatCents(goal.incomeCents)} recorded`;
  }
  return `Set for ${year}`;
}

/** The distance to the goal, as an instruction rather than as a verdict. */
function Progress({ goal, totalCents, year }) {
  if (!goal.stated) {
    return (
      <>
        No goal set for {year}. Naming one — a figure, or a share of what comes in — is what turns
        the total above into something to read against.
      </>
    );
  }

  if (goal.remainingCents > 0) {
    return (
      <>
        <span className="text-chalk">{formatCents(goal.remainingCents)}</span> still to give to
        reach {formatCents(goal.targetCents)}.
      </>
    );
  }

  const over = totalCents - goal.targetCents;
  return over > 0 ? (
    <>
      Past the goal by <span className="text-verdant">{formatCents(over)}</span>.
    </>
  ) : (
    <>
      <span className="text-verdant">Goal met</span> exactly.
    </>
  );
}

export default function GivingSummary({ giving }) {
  const {
    year,
    totalCents,
    deductibleCents,
    nonDeductibleCents,
    giftCount,
    incomeCents,
    shareOfIncomeBps,
    goal,
    byRecipient,
  } = giving;

  const organizations = byRecipient.filter((entry) => entry.giftCount > 0).length;
  // A goal of zero has nothing to be a share of, so the meter is suppressed
  // rather than drawn full or empty — the sentence beside it still says where
  // the year stands.
  const ratio = goal.targetCents > 0 ? totalCents / goal.targetCents : null;

  return (
    <section aria-label="Giving summary" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge px-4 py-3">
        <h2 className="font-sans text-base font-semibold tracking-tight text-chalk">{year}</h2>
        <span className="font-mono text-label uppercase text-chalk-soft">
          {giftCount} {giftCount === 1 ? "gift" : "gifts"} · {organizations}{" "}
          {organizations === 1 ? "organization" : "organizations"}
        </span>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour
          through, as on the dashboard, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Given"
          figure={formatCents(totalCents)}
          tone="text-chalk"
          note={`In ${year}`}
        />
        <Tile
          label="Tax deductible"
          figure={formatCents(deductibleCents)}
          tone="text-verdant"
          note={
            nonDeductibleCents === 0
              ? "All of it deductible"
              : `${formatCents(nonDeductibleCents)} not deductible`
          }
        />
        {/* A dash where a share would be a fiction: no income recorded is not a
            household that gave an infinite share of it. The dollar figures are
            unaffected, so refusing to invent one costs nothing. */}
        <Tile
          label="Share of income"
          figure={shareOfIncomeBps == null ? "—" : formatBps(shareOfIncomeBps)}
          tone={shareOfIncomeBps == null ? "text-chalk-soft" : "text-azure"}
          note={
            shareOfIncomeBps == null
              ? "No income recorded"
              : `Of ${formatCents(incomeCents)} received`
          }
        />
        <Tile
          label="Goal"
          figure={goal.stated ? formatCents(goal.targetCents) : "—"}
          tone={goal.stated ? "text-chalk" : "text-chalk-soft"}
          note={goalNote(goal, year)}
        />
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-edge px-4 py-3">
        {ratio != null && (
          <GivenMeter
            ratio={ratio}
            label={`${Math.round(Math.min(ratio, 1) * 100)} percent of the ${year} giving goal`}
          />
        )}
        <p className="flex-1 font-sans text-row text-chalk-soft">
          <Progress goal={goal} totalCents={totalCents} year={year} />
        </p>
      </div>
    </section>
  );
}
