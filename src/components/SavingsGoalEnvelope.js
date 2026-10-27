import { useMemo } from "react";

/**
 * A savings goal drawn as an open envelope you fold money into: dollar bills
 * fan up out of the pocket, one more appearing as the goal fills, and the paper
 * seams turn gold when the target is reached.
 *
 * It *is* the progress indicator — the wrapper carries `role="progressbar"` with
 * the same `aria-valuenow` a plain bar would, so a screen reader is told the
 * percentage while everyone else sees the fan. The figure itself (saved, target,
 * remaining) stays in the card beside it; this only draws the share.
 *
 * **The colours are hardcoded here, the Elder's rule** (`Elder.js`): this is a
 * drawing rather than chrome, it reads the same on a light or a dark card, and a
 * per-goal paper colour the two modes would each need a token for is six tokens
 * times two that nothing else in the app would ever name. The bills are a money
 * green and the "reached" seam is `coin`, both the same in either mode.
 */
const PAPERS = {
  kraft: { front: "#EFE4CE", flap: "#E7D9BE", back: "#D8C7A4", edge: "#BBA678" },
  sage: { front: "#DCE6D5", flap: "#D0DEC6", back: "#B9CDAD", edge: "#9DB68C" },
  sky: { front: "#D7E4EC", flap: "#C9DBE6", back: "#AFCAD9", edge: "#8FB2C6" },
  rose: { front: "#F0DCDF", flap: "#E8CDD2", back: "#DBB6BE", edge: "#C795A0" },
  lavender: { front: "#E1DCEC", flap: "#D5CEE4", back: "#C2B8D9", edge: "#A595C4" },
  butter: { front: "#F3E7C6", flap: "#EEDFB2", back: "#E3CE90", edge: "#CBAF6B" },
};

const BILL = { paper: "#4F8C61", edge: "#39694A", line: "#D7ECDD", ink: "#EDF6EF" };
const GOLD = "#F2B632";
const MAX_BILLS = 7;

const pts = (arr) => arr.map((p) => p.join(",")).join(" ");

/** One stylised dollar bill, upright. Placed by the fan inside a rotated group. */
function Bill({ x, y, w, h }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={BILL.paper} stroke={BILL.edge} strokeWidth="1.2" />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx="3" fill="none" stroke={BILL.line} strokeWidth="1" opacity="0.65" />
      <ellipse cx={cx} cy={cy} rx="8" ry="11" fill={BILL.line} opacity="0.3" />
      <text x={cx} y={cy + 5} textAnchor="middle" fontFamily="Georgia, serif" fontSize="14" fontWeight="700" fill={BILL.ink}>$</text>
      <text x={x + 6} y={y + 12} fontFamily="Georgia, serif" fontSize="7" fontWeight="700" fill={BILL.ink}>1</text>
      <text x={x + w - 6} y={y + h - 5} textAnchor="end" fontFamily="Georgia, serif" fontSize="7" fontWeight="700" fill={BILL.ink}>1</text>
    </g>
  );
}

export default function SavingsGoalEnvelope({ ratio, color = "kraft", name }) {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  const reached = clamped >= 1;
  const paper = PAPERS[color] ?? PAPERS.kraft;

  // The fan: one bill per seventh of the goal, centred and splayed, the centre
  // bill drawn last so it sits on top. Lowered so its lower half tucks behind
  // the front pocket — the money sits *in* the envelope.
  const bills = useMemo(() => {
    const n = clamped <= 0 ? 0 : Math.max(1, Math.round(clamped * MAX_BILLS));
    const W = 28;
    const H = 52;
    const step = n > 1 ? Math.min(14, 72 / (n - 1)) : 0;
    return Array.from({ length: n }, (_, i) => {
      const a = (i - (n - 1) / 2) * step;
      return { a, d: Math.abs(a) };
    })
      .sort((p, q) => q.d - p.d)
      .map((b, i) => (
        <g key={i} transform={`translate(100,156) rotate(${b.a.toFixed(1)})`}>
          <Bill x={-W / 2} y={-(H + 8)} w={W} h={H} />
        </g>
      ));
  }, [clamped]);

  return (
    <div
      role="progressbar"
      aria-label={`Savings progress for ${name}`}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mx-auto w-full max-w-[164px]"
    >
      <svg
        viewBox="0 0 200 196"
        className="block h-auto w-full"
        style={{ filter: "drop-shadow(0 2px 3px rgba(43,33,27,0.14))" }}
        aria-hidden="true"
      >
        {/* inside back wall — recessed, so the money reads as sitting in front of it */}
        <polygon points={pts([[40, 70], [160, 70], [160, 170], [40, 170]])} fill={paper.back} stroke={paper.edge} strokeWidth="1.4" strokeLinejoin="round" />
        {/* open lid */}
        <polygon points={pts([[40, 70], [160, 70], [100, 36]])} fill={paper.flap} stroke={paper.edge} strokeWidth="1.4" strokeLinejoin="round" />
        <line x1="100" y1="70" x2="100" y2="36" stroke={paper.edge} strokeWidth="1" />
        {/* the bill fan, half-tucked into the pocket below */}
        {bills}
        {/* front V-notch pocket */}
        <polygon points={pts([[40, 116], [100, 146], [160, 116], [160, 170], [40, 170]])} fill={paper.front} stroke={paper.edge} strokeWidth="1.4" strokeLinejoin="round" />
        {/* gold seams + sparkles once the goal is reached (the envelope stays open — the money is in) */}
        {reached && (
          <>
            <g stroke={GOLD} strokeWidth="2" strokeLinecap="round">
              <line x1="40" y1="116" x2="100" y2="146" />
              <line x1="160" y1="116" x2="100" y2="146" />
              <line x1="40" y1="70" x2="100" y2="36" />
              <line x1="160" y1="70" x2="100" y2="36" />
            </g>
            <g fill={GOLD} stroke="none">
              <text x="150" y="60" fontSize="15">✦</text>
              <text x="46" y="74" fontSize="11">✦</text>
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
