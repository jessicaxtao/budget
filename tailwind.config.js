/** @type {import('tailwindcss').Config} */

// The palette is sampled directly from the budgeting spreadsheet this app
// replaces, so the two read as the same tool. Two surfaces do the work: a dark
// chrome (`ledger` page, `panel` cards and table headers) and, inverted inside
// it, a near-white data body (`sheet`) where the numbers live. Text tokens are
// named for the surface they sit on — `ink`/`ink-soft` on light, `chalk`/
// `chalk-soft` on dark — so a wrong pairing is visible at the call site.
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ledger: "#505A5E", // app background
        panel: "#333333", // cards, table headers, dark chrome
        "panel-raised": "#3E4548", // hover / nested surface on dark
        edge: "#5E686C", // hairline on dark

        sheet: "#FFFFFF", // data rows
        "sheet-alt": "#F3F3F3", // zebra row
        band: "#E5E3E1", // group and subtotal rows
        rule: "#D2D5D6", // hairline on light

        ink: "#1F2325", // text on light
        "ink-soft": "#6B7376", // secondary text on light
        chalk: "#FFFFFF", // text on dark
        // Light enough to clear 4.5:1 against `ledger`, which is the surface
        // most secondary text actually sits on — a softer grey reads well on
        // `panel` but falls to ~3.8:1 on the page background.
        "chalk-soft": "#CFD4D6", // secondary text on dark

        azure: "#5FB2EB", // figures, links, primary action
        verdant: "#32AE7B", // income, under budget, yes
        vermilion: "#D66466", // expense, over budget, no
        sulfur: "#FAEF6E", // active tab, caution

        // The accents above are tuned for the dark chrome and are too light to
        // carry text on a white data row, so destructive actions inside the
        // sheet surface use a darkened red instead.
        "vermilion-ink": "#A63D3F",
      },
      fontFamily: {
        // One family for structure, one for figures. The spreadsheet's own
        // register is utilitarian sans; Plex carries that without the
        // characterlessness of the default grid font.
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        // A dense scale — this is a data tool, not a marketing page.
        label: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.08em" }],
        row: ["0.8125rem", { lineHeight: "1.25rem" }],
        figure: ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.01em" }],
      },
    },
  },
  plugins: [],
};
