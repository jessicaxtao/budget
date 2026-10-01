// Variants are named for the job, not the colour, and each one states the
// surface it belongs on: the page and its cards, or the data rows inside them.
// In both of the Grove's modes those two are the same lightness, but the split
// is kept so the rows can drift from the cards without a button going
// illegible.
//
// Every variant carries a border, transparent where it is not drawn: the
// bordered ones would otherwise stand 2px taller than the rest, and these sit
// side by side in headers and toolbars where that shows.
const variants = {
  // On the page and its cards. `primary` wears `action`, the canopy green, not
  // `azure`: azure is a figure and bucket colour, and a button the same blue as
  // the essentials share would read as part of the chart beside it.
  primary: "border border-transparent bg-action text-on-action hover:bg-chalk hover:text-panel",
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
