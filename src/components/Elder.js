/**
 * The Elder: the app's mascot, an old orangutan with the wide cheek pads only a
 * grown male carries.
 *
 * Drawn here once, with four moods, and the mood is never decoration — each one
 * is a reading of the books, chosen by the caller from the same rule the figure
 * beside him already follows:
 *
 *   content    nothing needs doing (everything assigned)
 *   pondering  money is waiting for a decision (unassigned)
 *   concerned  something is below zero — the app's one definition of trouble
 *   pleased    a goal was reached
 *
 * He appears beside the question a screen answers, never over a figure, and at
 * most once per screen. Mood is said in words by the figure next to him, so he
 * is `aria-hidden` by default; pass `label` only where he is the only carrier
 * of what he means.
 *
 * His colours are artwork, not palette: they are written out here rather than
 * taken from tailwind.config.js because he looks the same in both modes — the
 * orange reads on parchment and on bark alike, and a mascot that changed
 * colour with the lights would be two characters.
 */

export const ELDER_MOODS = {
  CONTENT: "content",
  PONDERING: "pondering",
  CONCERNED: "concerned",
  PLEASED: "pleased",
};

const FUR = "#C5561F";
const PAD = "#8C7262";
const PAD_EDGE = "#6A5448";
const FACE = "#6A5448";
const MUZZLE = "#A88C78";
const BROW = "#3E302A";
const EYE_WHITE = "#F1E4D4";
const PUPIL = "#2B211B";
const SPARK = "#F2B632";

// Brows, eyes and mouth are the whole of an expression; everything else is the
// same head.
const FACES = {
  [ELDER_MOODS.CONTENT]: {
    brows: "M166 152 Q183 140 198 150 M202 150 Q217 140 234 152",
    eyes: { dx: 0, dy: 0 },
    mouth: "M172 210 Q200 226 228 210",
  },
  [ELDER_MOODS.PONDERING]: {
    brows: "M166 146 Q183 132 198 144 M204 152 L234 152",
    eyes: { dx: 3, dy: -2 },
    mouth: "M182 214 L220 210",
  },
  [ELDER_MOODS.CONCERNED]: {
    brows: "M166 156 Q182 148 198 142 M202 142 Q218 148 234 156",
    eyes: { dx: 0, dy: 2 },
    mouth: "M176 216 Q188 207 200 215 Q212 223 224 214",
  },
  [ELDER_MOODS.PLEASED]: {
    brows: "M166 148 Q183 136 198 146 M202 146 Q217 136 234 148",
    eyes: null, // closed, smiling
    mouth: "M170 206 Q200 234 230 206",
  },
};

export default function Elder({ mood = ELDER_MOODS.CONTENT, label, className = "h-10 w-11" }) {
  const face = FACES[mood] ?? FACES[ELDER_MOODS.CONTENT];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <svg viewBox="70 12 260 236" className={`shrink-0 ${className}`} focusable="false" {...a11y}>
      <path d="M170 62 L178 28 L192 52 L200 18 L210 52 L224 30 L230 64 Z" fill={FUR} />
      <circle cx="200" cy="128" r="78" fill={FUR} />
      <path
        d="M200 110 C260 104 322 120 324 168 C326 214 280 236 200 240 C120 236 74 214 76 168 C78 120 140 104 200 110 Z"
        fill={PAD}
        stroke={PAD_EDGE}
        strokeWidth="3"
      />
      <path
        d="M200 132 C228 128 250 142 250 164 C250 180 242 188 236 194 C244 214 228 236 200 236 C172 236 156 214 164 194 C158 188 150 180 150 164 C150 142 172 128 200 132 Z"
        fill={FACE}
      />
      <path d={face.brows} stroke={BROW} strokeWidth="6" fill="none" strokeLinecap="round" />
      {face.eyes ? (
        <>
          <ellipse cx="184" cy="164" rx="9" ry="7" fill={EYE_WHITE} />
          <circle cx={185 + face.eyes.dx} cy={164 + face.eyes.dy} r="5.5" fill={PUPIL} />
          <ellipse cx="216" cy="164" rx="9" ry="7" fill={EYE_WHITE} />
          <circle cx={215 + face.eyes.dx} cy={164 + face.eyes.dy} r="5.5" fill={PUPIL} />
        </>
      ) : (
        <path
          d="M175 166 Q185 156 195 166 M205 166 Q215 156 225 166"
          stroke={PUPIL}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
      )}
      <ellipse cx="200" cy="208" rx="40" ry="26" fill={MUZZLE} />
      <ellipse cx="194" cy="192" rx="3.5" ry="3" fill={BROW} />
      <ellipse cx="206" cy="192" rx="3.5" ry="3" fill={BROW} />
      <path d={face.mouth} stroke={BROW} strokeWidth="5" fill="none" strokeLinecap="round" />
      {mood === ELDER_MOODS.PLEASED && (
        <>
          <path d="M300 40 L304 52 L316 56 L304 60 L300 72 L296 60 L284 56 L296 52 Z" fill={SPARK} />
          <path d="M98 50 L101 58 L109 61 L101 64 L98 72 L95 64 L87 61 L95 58 Z" fill={SPARK} />
        </>
      )}
      {mood === ELDER_MOODS.PONDERING && (
        <>
          <circle cx="292" cy="72" r="7" fill={SPARK} />
          <circle cx="310" cy="46" r="11" fill={SPARK} />
        </>
      )}
    </svg>
  );
}
