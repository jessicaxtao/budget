/** @type {import('tailwindcss').Config} */

// The palette is the Gotham terminal scheme, taken as-is from its ANSI slots so
// the app reads like the terminal it sits next to. Two surfaces do the work: a
// dark chrome that climbs Gotham's four background steps from the near-black
// page up to the blue slate (44m), and, inverted inside it, a light data body
// (`sheet` on Gotham's foreground mint) where the numbers live. Text tokens are
// named for the surface they sit on — `ink`/`ink-soft` on light, `chalk`/
// `chalk-soft` on dark — so a wrong pairing is visible at the call site.
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // The chrome ramp, darkest first. The accents below are what has to
        // stay legible on it, so the large surfaces take the bottom two steps
        // and the slate is reserved for bands and hovers — on a slate-sized
        // card `azure` figures fall to 2.7:1.
        ledger: "#0C1014", // app background
        panel: "#0A3749", // cards, dark chrome
        "panel-raised": "#195465", // table header bands, hover / nested surface
        edge: "#245361", // hairline on dark

        sheet: "#D3EBE9", // data rows
        "sheet-alt": "#C9E5E3", // zebra row
        band: "#99D1CE", // group and subtotal rows
        rule: "#B2DAD7", // hairline on light

        ink: "#0C1014", // text on light
        "ink-soft": "#245361", // secondary text on light
        chalk: "#D3EBE9", // text on dark
        // Gotham's foreground pair. The dimmer cyan `#599CAA` is the obvious
        // next step down but only reaches 4.1:1 on `panel`, so secondary text
        // takes the brighter one and `azure` keeps `#599CAA` for accents.
        "chalk-soft": "#99D1CE", // secondary text on dark

        azure: "#599CAA", // figures, links, primary action
        verdant: "#2AA889", // income, under budget, yes
        // Gotham's bright red rather than its base red (#C23127): the base sits
        // at 2.3:1 on `panel`, which is where the modals' error text lands.
        // This one matches the old palette's contrast there and beats it on the
        // page.
        vermilion: "#D26937", // expense, over budget, no
        sulfur: "#EDB443", // active tab, caution

        // The accents above are tuned for the dark chrome and are too light to
        // carry text on the light data rows, so destructive actions inside the
        // sheet surface use a darkened Gotham red instead.
        "vermilion-ink": "#8F2119",

        // The net-worth series, and the only colours in the app chosen by
        // measurement rather than by picking them off the Gotham ramp: a stacked
        // chart is read by telling its bands apart, so the four have to clear a
        // colour-vision separation gate against each other on `panel`, which no
        // four of the accents above do. Cash and debt keep `verdant` and
        // `vermilion` — money held and money owed mean the same here as
        // everywhere else in the app — so only the two the palette had no hue
        // for are new, stepped to pass alongside them.
        //
        // Validated all-pairs on #0A3749: worst normal-vision ΔE 16.3, worst
        // simulated protan/deutan ΔE 6.4. That last figure sits in the band that
        // is only legal with a second, non-colour channel, which is why the
        // chart ships a legend, a direct label on the net, and a table view of
        // the same figures — none of them optional. **Changing one of these four
        // means re-running the check on all four.**
        invested: "#5A8FEA", // stocks, bonds, and the like
        property: "#C173B8", // the house, and anything owned that is neither
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
