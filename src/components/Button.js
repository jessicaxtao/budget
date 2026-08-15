// Variants are named for the job, not the colour, and each one states the
// surface it belongs on — the app runs a dark chrome with inverted light data
// rows inside it, so a button that reads well in one is often illegible in the
// other.
//
// Every variant carries a border, transparent where it is not drawn: the
// bordered ones would otherwise stand 2px taller than the rest, and these sit
// side by side in headers and toolbars where that shows.
const variants = {
  // On dark chrome.
  primary: "border border-transparent bg-azure text-panel hover:bg-chalk",
  outline: "border border-edge text-chalk hover:border-chalk-soft hover:bg-panel-raised",
  danger: "border border-vermilion/60 text-vermilion hover:bg-vermilion hover:text-panel",
  // On light data rows. `row` is the quiet one that turns red under the pointer
  // — it is what "Remove" wears, and the hover colour is the warning. Anything
  // that is not destructive needs `row-action`, which is drawn as a button
  // rather than as bare text and stays in the ink range throughout.
  row: "border border-transparent text-ink-soft hover:bg-band hover:text-vermilion-ink",
  "row-action": "border border-rule text-ink-soft hover:border-ink-soft hover:bg-band hover:text-ink",
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
