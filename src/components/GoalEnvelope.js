/**
 * A savings goal drawn as an envelope. It stays **sealed** — a gold seal
 * showing the percent saved is its sticker — until the card opens it, when the
 * seal peels, the flap lifts and a letter bearing what has been saved rises.
 *
 * The goal's name and date are not on it: they sit outside, in the card's
 * heading (`SavingsGoalList`), so a sealed envelope still says which goal it is.
 * Purely presentational and fully controlled — the host owns the `open` state,
 * because the same click that opens the envelope reveals the goal's details, so
 * one toggle drives both. Everything on it is `aria-hidden`: the figure and the
 * percent are read from the details panel, not from this decoration. The
 * animation itself is CSS (`.goal-envelope` in index.css); this only adds
 * `.is-open`.
 */
export default function GoalEnvelope({ figure, figureLabel, sealFigure, sealLabel, color = "canopy", open = false }) {
  return (
    <div data-envelope-color={color} className={`goal-envelope ${open ? "is-open" : ""}`} aria-hidden="true">
      <div className="goal-envelope__body">
        <div className="goal-envelope__back" />
        <div className="goal-envelope__flap">
          <div className="goal-envelope__flap-shadow" />
          <div className="goal-envelope__flap-front" />
          <div className="goal-envelope__flap-back" />
        </div>
        <div className="goal-envelope__letter">
          <span className="goal-envelope__figure font-mono">{figure}</span>
          <span className="goal-envelope__figure-label font-sans">{figureLabel}</span>
        </div>
        <svg className="goal-envelope__pocket" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon className="goal-envelope__pocket-paper" points="0,0 50,47 100,0 100,100 0,100" />
          <polygon className="goal-envelope__pocket-fold" points="0,0 50,47 50,60 0,100" />
          <polygon className="goal-envelope__pocket-fold" points="100,0 50,47 50,60 100,100" />
        </svg>
        <div className="goal-envelope__seal font-sans">
          <span className="goal-envelope__seal-figure">{sealFigure}</span>
          <span className="goal-envelope__seal-label">{sealLabel}</span>
        </div>
      </div>
    </div>
  );
}
