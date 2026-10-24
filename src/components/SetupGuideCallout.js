import { useLayoutEffect, useState } from "react";

const CALLOUT_WIDTH = 352;
const CALLOUT_HEIGHT = 210;
const EDGE = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

/** A lightweight coachmark that follows the setup action it describes. */
export default function SetupGuideCallout({ targetId, title, description, children }) {
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return undefined;

    target.classList.add("relative", "z-40", "ring-2", "ring-azure", "ring-offset-2", "ring-offset-panel");
    target.scrollIntoView({ block: "center", behavior: "smooth" });

    function updatePosition() {
      const rect = target.getBoundingClientRect();
      const width = Math.min(CALLOUT_WIDTH, window.innerWidth - EDGE * 2);
      const left = clamp(rect.left + rect.width / 2 - width / 2, EDGE, window.innerWidth - width - EDGE);
      const placeAbove = rect.bottom + CALLOUT_HEIGHT + 20 > window.innerHeight;
      const top = placeAbove
        ? clamp(rect.top - CALLOUT_HEIGHT - 20, EDGE, window.innerHeight - CALLOUT_HEIGHT - EDGE)
        : clamp(rect.bottom + 20, EDGE, window.innerHeight - CALLOUT_HEIGHT - EDGE);
      const arrowLeft = clamp(rect.left + rect.width / 2 - left, 22, width - 22);
      setPosition({ left, top, width, arrowLeft, placeAbove });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      target.classList.remove("relative", "z-40", "ring-2", "ring-azure", "ring-offset-2", "ring-offset-panel");
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [targetId]);

  if (!position) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed z-50 overflow-y-auto rounded-xl border border-azure/60 bg-panel p-4 text-left shadow-xl shadow-black/40"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: "calc(100vh - 2rem)",
      }}
    >
      <span
        aria-hidden="true"
        className={`absolute h-3 w-3 rotate-45 border-azure/60 bg-panel ${
          position.placeAbove
            ? "-bottom-1.5 border-b border-r"
            : "-top-1.5 border-l border-t"
        }`}
        style={{ left: position.arrowLeft }}
      />
      <div className="relative pointer-events-auto">
        <p className="mb-1 text-label uppercase text-azure">Getting started</p>
        <h2 className="font-sans text-base font-semibold text-chalk">{title}</h2>
        <div className="mt-1 font-sans text-row text-chalk-soft">{description}</div>
        {children}
      </div>
    </aside>
  );
}
