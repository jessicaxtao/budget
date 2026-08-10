// Variants are named for the job, not the colour, and each one states the
// surface it belongs on — the app runs a dark chrome with inverted light data
// rows inside it, so a button that reads well in one is often illegible in the
// other.
const variants = {
  // On dark chrome.
  primary: "bg-azure text-panel hover:bg-chalk",
  outline: "border border-edge text-chalk hover:border-chalk-soft hover:bg-panel-raised",
  danger: "border border-vermilion/60 text-vermilion hover:bg-vermilion hover:text-panel",
  // On light data rows.
  row: "text-ink-soft hover:bg-band hover:text-vermilion-ink",
};

const sizes = {
  sm: "px-2 py-1 text-label",
  md: "px-3.5 py-2 text-sm",
};

export default function Button({ variant = "outline", size = "md", className = "", ...props }) {
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 font-sans font-medium tracking-wide transition-colors disabled:opacity-40 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
