import Button from "./Button";
import { OFFER_KINDS, OFFER_STATUS, nextOfferWindow } from "../rewards";
import { formatBps, formatCents, formatDateMedium, formatDayDelta } from "../utils";

const formatPoints = (points) => points.toLocaleString("en-US");

/**
 * How far through an offer the spending is, as a bar.
 *
 * Local, the `GoalMeter` rule: full means *done* here for both kinds — the cap
 * used up, the target met — but what done means differs, so each caller would
 * read a shared meter its own way. The bar is the only thing coloured; the
 * sentence beside it always says the same in words.
 */
function OfferMeter({ ratio, tone, label }) {
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div
      className="h-2 w-full bg-edge"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-2 ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function windowText(offer) {
  const start = formatDateMedium(offer.startDate);
  return offer.endDate ? `${start} – ${formatDateMedium(offer.endDate)}` : `from ${start}`;
}

/**
 * The one sentence an offer is read for, and the bar's colour beside it.
 *
 * A capped bonus is good news while there is room and says when to stop; a
 * target is good news once it is met and says what it takes to get there; a
 * credit is a target the household has **already paid for**, so what is left of
 * it is a warning. The three are worded apart because the same figure — $400
 * left — means "keep using this card" under a cap, "keep going" under a target
 * and "you are about to lose this" under a credit.
 */
export function describeOffer(row) {
  const { offer, status, remainingCents, qualifyingCents } = row;
  const cap = offer.kind === OFFER_KINDS.CAP;
  const deadline = row.daysLeft != null ? ` — ends ${formatDayDelta(row.daysLeft).toLowerCase()}` : "";

  if (status === OFFER_STATUS.UPCOMING) {
    return { headline: `Opens ${formatDateMedium(offer.startDate)}`, tone: "bg-edge" };
  }
  // A credit reads the opposite way round from the cap it is arithmetically:
  // what is left is not an opportunity but money already paid for, and running
  // out of it is the good outcome.
  if (offer.kind === OFFER_KINDS.CREDIT) {
    if (row.reached) return { headline: "Credit used in full", tone: "bg-verdant" };
    if (status === OFFER_STATUS.ENDED) {
      return { headline: `${formatCents(remainingCents)} expired unused`, tone: "bg-vermilion" };
    }
    const pace = row.perWeekCents != null ? `, about ${formatCents(row.perWeekCents)} a week` : "";
    return {
      headline: `${formatCents(remainingCents)} still to use${deadline}${pace}`,
      tone: qualifyingCents > 0 ? "bg-azure" : "bg-sulfur",
    };
  }
  if (cap) {
    if (row.reached) {
      return {
        headline:
          status === OFFER_STATUS.ENDED
            ? "Used in full"
            : "Limit reached — back to your usual card",
        tone: "bg-verdant",
      };
    }
    if (status === OFFER_STATUS.ENDED) {
      return {
        headline: `Ended with ${formatCents(remainingCents)} of room unused`,
        tone: "bg-sulfur",
      };
    }
    return { headline: `${formatCents(remainingCents)} of room left${deadline}`, tone: "bg-azure" };
  }
  if (row.reached) {
    return { headline: "Target met", tone: "bg-verdant" };
  }
  if (status === OFFER_STATUS.ENDED) {
    return { headline: `Missed by ${formatCents(remainingCents)}`, tone: "bg-vermilion" };
  }
  const pace = row.perWeekCents != null ? `, about ${formatCents(row.perWeekCents)} a week` : "";
  return {
    headline: `${formatCents(remainingCents)} to go${deadline}${pace}`,
    tone: qualifyingCents > 0 ? "bg-azure" : "bg-edge",
  };
}

function rewardText(row) {
  const { offer } = row;
  if (offer.kind === OFFER_KINDS.CREDIT) {
    return `${formatCents(row.earnedCents ?? 0)} back so far — counts against the card's annual fee`;
  }
  if (offer.kind === OFFER_KINDS.CAP) {
    if (row.earnedCents == null) return null;
    return `${formatCents(row.earnedCents)} earned at ${formatBps(offer.rateBps)}`;
  }
  if (offer.bonusPoints == null) return null;
  const points = `${formatPoints(offer.bonusPoints)}${row.program ? ` ${row.program.unit}` : " points"}`;
  const worth = row.bonusValueCents != null ? ` (about ${formatCents(row.bonusValueCents)})` : "";
  return `${row.reached ? "Earned" : "Bonus"}: ${points}${worth}`;
}

function countsText(row) {
  if (row.offer.allSpending) return "All spending on the card";
  const named = [...row.categories, ...row.payees];
  return named.length > 0 ? named.join(", ") : "Nothing that still exists";
}

/**
 * Every tracked card offer, one block per offer: what it is, where the
 * spending stands, and the one thing worth doing about it.
 *
 * Takes its rows as a prop and holds no state, `SavingsGoalList`'s split, so
 * what the page owns (the modal, the store) stays on the page.
 */
export default function CardOfferList({ rows, onEdit, onRepeat, onDelete }) {
  return (
    <ul className="divide-y divide-rule">
      {rows.map((row) => {
        const { offer } = row;
        const { headline, tone } = describeOffer(row);
        const reward = rewardText(row);
        const ended = row.status === OFFER_STATUS.ENDED;
        const showElsewhere =
          row.elsewhereCents > 0 && row.status !== OFFER_STATUS.UPCOMING;
        // **A credit's figure stops at the credit.** Spending past a cap is
        // worth saying — it earned the card's ordinary rate instead of the
        // bonus — but spending past a credit is just shopping, and "$1,340 of
        // $300" reads as a meter that has gone wrong rather than as a credit
        // long since used up.
        const counted =
          offer.kind === OFFER_KINDS.CREDIT
            ? Math.min(row.qualifyingCents, offer.limitCents)
            : row.qualifyingCents;
        return (
          <li key={offer.id} className={`bg-sheet px-4 py-3 ${ended ? "opacity-80" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h3 className="font-sans text-row font-semibold text-ink">{offer.name}</h3>
                <p className="font-mono text-label uppercase text-ink-soft">
                  {[row.cardName ?? "A removed account", windowText(offer)].join(" · ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="row-action"
                  size="sm"
                  aria-label={`Edit ${offer.name}`}
                  onClick={() => onEdit(offer)}
                >
                  Edit
                </Button>
                {nextOfferWindow(offer) && (
                  <Button
                    variant="row-action"
                    size="sm"
                    aria-label={`Next round of ${offer.name}`}
                    onClick={() => onRepeat(offer)}
                  >
                    Next round
                  </Button>
                )}
                <Button
                  variant="row"
                  size="sm"
                  aria-label={`Remove ${offer.name}`}
                  onClick={() => onDelete(offer)}
                >
                  Remove
                </Button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-sans text-row font-medium text-ink">{headline}</p>
              <p className="font-mono text-row tabular-nums text-ink">
                {formatCents(counted)}
                <span className="text-ink-soft"> of {formatCents(offer.limitCents)}</span>
              </p>
            </div>
            <div className="mt-1.5">
              <OfferMeter
                ratio={counted / offer.limitCents}
                tone={tone}
                label={`${offer.name}: ${formatCents(counted)} of ${formatCents(offer.limitCents)}`}
              />
            </div>

            <dl className="mt-2 grid gap-x-6 gap-y-0.5 font-sans text-row text-ink-soft sm:grid-cols-[auto_1fr]">
              <dt className="font-mono text-label uppercase">Counts</dt>
              <dd>
                {countsText(row)}
                {row.missing > 0 &&
                  ` — and ${row.missing} ${row.missing === 1 ? "category or payee" : "categories or payees"} since removed`}
              </dd>
              {reward && (
                <>
                  <dt className="font-mono text-label uppercase">Reward</dt>
                  <dd>{reward}</dd>
                </>
              )}
              {row.overCents > 0 && (
                <>
                  <dt className="font-mono text-label uppercase">Past the limit</dt>
                  <dd>{formatCents(row.overCents)} at the card's ordinary rate</dd>
                </>
              )}
              {showElsewhere && (
                <>
                  <dt className="font-mono text-label uppercase">Elsewhere</dt>
                  <dd className="text-vermilion-ink">
                    {formatCents(row.elsewhereCents)} of matching spending went on another account
                    while this offer{" "}
                    {
                      {
                        [OFFER_KINDS.CAP]: "had room",
                        [OFFER_KINDS.TARGET]: "was still to meet",
                        [OFFER_KINDS.CREDIT]: "was still to use",
                      }[offer.kind]
                    }
                  </dd>
                </>
              )}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
