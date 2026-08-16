import { formatBps, formatCents, formatPeriod } from "../utils";

/**
 * What the household is worth, how fast it is moving, and what kind of money it
 * is made of.
 *
 * A hero figure rather than a fifth chart: net worth is one number, and the one
 * the page is named after. Beside it sits the only figure that says whether that
 * number is any good — the change, over the same span `NetWorthPage`'s one
 * control has the chart drawing.
 *
 * **The percentage leads and the dollar figure follows.** Over a decade the
 * dollar change is a number nobody has an intuition for; the percentage is the
 * one a reader can compare against what the market did, against inflation,
 * against last year. Both are shown because a percentage of a small base
 * flatters and a large dollar change on a large base impresses, and neither
 * alone is honest.
 *
 * **The change is always stated against a named month, never as a bare arrow**,
 * and the base figure is printed with it. A ten-year change on books that are
 * eight months old measures from the opening balances, and the only thing that
 * makes that legible is saying which month and how much.
 *
 * The four bands underneath are the coarse cut — what kind of money this is —
 * and they stay four however many accounts there are. The account-by-account cut
 * of the same total is the chart below and the holdings table under that.
 */

/** Up is good here — this is the one figure in the app where more is better. */
function changeTone(cents) {
  if (cents > 0) return "text-verdant";
  if (cents < 0) return "text-vermilion";
  return "text-chalk-soft";
}

const signedCents = (cents) => `${cents > 0 ? "+" : ""}${formatCents(cents)}`;
const signedBps = (bps) => `${bps > 0 ? "+" : ""}${formatBps(bps)}`;

function Band({ label, swatch, cents, tone = "text-chalk" }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="flex items-center gap-1.5 font-mono text-label uppercase text-chalk-soft">
        <span className={`h-2 w-2 shrink-0 ${swatch}`} aria-hidden="true" />
        {label}
      </dt>
      {/* Proportional figures, not tabular: these sit side by side rather than
          stacked in a column, so there is nothing for the digits to line up
          with and equal-width digits only make them look loose. */}
      <dd className={`mt-1 font-mono text-figure font-medium ${tone}`}>{formatCents(cents)}</dd>
    </div>
  );
}

export default function NetWorthSummary({ period, current, change }) {
  const tone = changeTone(change.changeCents);

  return (
    // Named, so the hero figure and the four bands are one addressable region
    // rather than four numbers loose on the page — the chart's table twin below
    // repeats every one of them, and a reader needs to be able to tell which
    // copy they have landed on.
    <section aria-label="Net worth summary" className="border border-edge bg-panel">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-edge px-4 py-4">
        <div>
          <div className="font-mono text-label uppercase text-chalk-soft">
            Net worth · {formatPeriod(period)}
          </div>
          {/* The page's one hero figure. Same sans as everything else — a
              display face here would read as decoration on a balance sheet. */}
          <div
            className={`mt-1 font-sans text-5xl font-semibold tracking-tight ${
              current.netCents < 0 ? "text-vermilion" : "text-chalk"
            }`}
          >
            {formatCents(current.netCents)}
          </div>
        </div>

        <div className="sm:text-right">
          <dl>
            {/* The term before the figures rather than under them, so what is
                being measured is read before the measurement — and so the base
                month and the base figure travel together. */}
            <dt className="font-mono text-label uppercase text-chalk-soft">
              Change since {formatPeriod(change.fromPeriod)} · was{" "}
              {formatCents(change.fromCents)}
            </dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 sm:justify-end">
              {/* A dash where a percentage would be a fiction — a base of zero,
                  or a base on the other side of zero from where this ended up.
                  The same dash the app uses for any figure it does not have. */}
              <span className={`font-mono text-figure font-medium ${tone}`}>
                {change.changeBps == null ? "—" : signedBps(change.changeBps)}
              </span>
              <span className={`font-mono text-lg font-medium ${tone}`}>
                {signedCents(change.changeCents)}
              </span>
            </dd>
          </dl>
        </div>
      </div>

      {/* Hairline dividers drawn by the grid gap showing the edge colour
          through, as on the dashboard, so they stay 1px on every display. */}
      <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        <Band label="Cash" swatch="bg-verdant" cents={current.cashCents} />
        <Band label="Investments" swatch="bg-invested" cents={current.investedCents} />
        <Band label="Property & other" swatch="bg-property" cents={current.propertyCents} />
        {/* Shown as the positive amount owed, the way a statement reads it, and
            in the expense colour so the one band that subtracts is the one band
            that looks like it does. */}
        <Band
          label="Owed"
          swatch="bg-vermilion"
          cents={current.debtCents}
          tone={current.debtCents > 0 ? "text-vermilion" : "text-chalk"}
        />
      </dl>
    </section>
  );
}
