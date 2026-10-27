import { useEffect, useId, useRef, useState } from "react";

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A savings goal drawn as an envelope that opens to show its name: sealed when
 * it first scrolls into view, then the seal peels, the flap lifts and the
 * letter rises. A click closes it and opens it again. Pure decoration around
 * the heading — the name is the only part a screen reader is given, and it is
 * in the document whether the envelope is open or shut.
 *
 * Where there is nothing to watch the scroll with, or motion is turned down,
 * the envelope simply starts open. The animation itself is CSS (`.goal-envelope`
 * in index.css); this only decides when to add `.is-open`.
 */
export default function GoalEnvelope({ name, caption, sealFigure, sealLabel, delayMs = 0 }) {
  const ref = useRef(null);
  const stripesId = `goal-envelope-stripes-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [open, setOpen] = useState(() => prefersReducedMotion() || typeof window.IntersectionObserver !== "function");

  useEffect(() => {
    if (open || !ref.current) return undefined;
    let timer = null;
    const observer = new window.IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      timer = setTimeout(() => setOpen(true), 300 + delayMs);
    }, { threshold: 0.6 });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // Opening is a one-off: once open, a click is what closes it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className={`goal-envelope cursor-pointer select-none ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)}>
      <div className="goal-envelope__backdrop" aria-hidden="true" />
      <div className="goal-envelope__body">
        <div className="goal-envelope__back" aria-hidden="true" />
        <div className="goal-envelope__flap" aria-hidden="true">
          <div className="goal-envelope__flap-shadow" />
          <div className="goal-envelope__flap-front" />
          <div className="goal-envelope__flap-back" />
        </div>
        <div className="goal-envelope__letter">
          <span className="goal-envelope__ornament" style={{ top: "4cqi", left: "5cqi" }} aria-hidden="true">✻</span>
          <h3 className="goal-envelope__name font-display" title={name}>{name}</h3>
          <p className="goal-envelope__caption font-sans">{caption}</p>
          <span className="goal-envelope__ornament" style={{ top: "24cqi", right: "6cqi" }} aria-hidden="true">✻</span>
        </div>
        <svg className="goal-envelope__pocket" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id={stripesId} width="11.25" height="100" patternUnits="userSpaceOnUse">
              <rect className="goal-envelope__pocket-stripe" width="5.625" height="100" />
              <rect className="goal-envelope__pocket-stripe-alt" x="5.625" width="5.625" height="100" />
            </pattern>
          </defs>
          <polygon points="0,0 50,47 100,0 100,100 0,100" fill={`url(#${stripesId})`} />
          <polygon className="goal-envelope__pocket-fold" points="0,0 50,47 50,60 0,100" />
          <polygon className="goal-envelope__pocket-fold" points="100,0 50,47 50,60 100,100" />
        </svg>
        <div className="goal-envelope__seal font-sans" aria-hidden="true">
          <span className="goal-envelope__seal-figure">{sealFigure}</span>
          <span className="goal-envelope__seal-label">{sealLabel}</span>
        </div>
      </div>
    </div>
  );
}
