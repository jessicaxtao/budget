# Canopy Budget typography research

Research date: October 23, 2026. Recommendation study; no application styling changes.

## Recommendation

Use **Inter throughout the working interface**, including balances. Its quieter shapes and strong small-text support make it the strongest new direction for Canopy's dense financial interface. Use proportional numerals in standalone hero balances and tabular numerals in aligned rows. **Unified DM Sans** is the minimal-change alternative: it preserves the current body family while removing most monospace. Keep Grove's parchment, paper, canopy green, bark, golden accents, rounded surfaces, and warm dark theme. These already supply personality without requiring three competing type voices.

This is a design judgment, not a claim that budgeting apps require one particular font. Lunch Money is a useful counterexample: its published dashboard includes visibly monospaced financial rows. The goal for Canopy is a calmer consumer product that makes amounts and actions easier to scan.

## What is actually in Canopy

- [Font imports and body styles](../src/index.css) load Young Serif, DM Sans, and IBM Plex Mono. DM Sans is already the body family.
- [PageHeader](../src/components/PageHeader.js) already uses a sans serif semibold title. The design document's Young Serif page-title recipe is not the implemented header.
- [DashboardSummary](../src/components/DashboardSummary.js) uses DM Sans labels and IBM Plex Mono figures. The repeated `font-mono text-label uppercase` treatment uses 11px tracked labels; responsive table labels reproduce that treatment in CSS.
- [Tailwind configuration](../tailwind.config.js) maps the three families. Young Serif still contributes an editorial brand voice, while Plex Mono gives balances and small labels a ledger or technical tone.

The suspected mismatch is the combination and distribution of fonts, especially pervasive monospace and tiny tracked labels, rather than an unsuitable body family. That is an assessment of the code and current design brief, not a measured usability result.

## Competitor evidence

Evidence types: **documented** means a first-party product/design statement; **visual** means a directly inspected screenshot published by the product owner; **inference** means the recommendation drawn from that evidence. Public marketing typography is not proof of the font inside a signed-in or native application. Exact competitor font names are intentionally unassigned where implementation evidence is unavailable.

| Product | What the evidence supports | Lesson for Canopy |
| --- | --- | --- |
| **Monarch Money** | **Documented:** its December 2024 refresh emphasized warmer colors, better contrast, and greater information density, including shorter transaction rows and tighter budget spacing. **Visual:** the accompanying dark-mode mobile screenshot uses restrained sans serif headings, labels, and amounts; hierarchy comes from size, weight, color, and placement. [Design lead's refresh article](https://www.monarch.com/blog/monarch-brand-refresh) | Warmth and financial clarity can coexist. Keep Grove's palette; simplify type roles and make dense rows easy to read. This is a published 2024 reference, not a claim that every current platform has identical styling. |
| **YNAB** | **Documented:** its September 2025 remodel defines separate Home and Spending spaces, with priority categories, progress, and transactions, and explicitly reports refreshed iOS/Android visuals. The public website also presents product imagery alongside a much more expressive marketing message. Exact app font was not verified. [Remodel announcement](https://www.ynab.com/whats-new/the-great-ynab-remodel), [official website](https://www.ynab.com/) | Judge typography against repeated planning and transaction tasks. Brand warmth should support a clear hierarchy of category, status, and amount. This is an inference from its documented information structure; it is not evidence for copying a named YNAB font. |
| **Copilot Money** | **Visual:** its official desktop dashboard image uses rounded-looking sans serif forms, large summary figures, modest section titles, aligned transaction amounts, and compact category rows. Some date/category labels use uppercase, but the primary reading text stays sentence case. **Documented:** its Dashboard guide distinguishes free-to-spend, transaction review, budgets, upcoming items, and net income. [Official site](https://www.copilot.money/), [dashboard guide](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview) | Let the amount carry visual emphasis. Use one cohesive sans serif voice with a small number of weights; keep uppercase for occasional compact metadata rather than every label. |
| **Quicken Simplifi** | **Visual:** its official Spending Plan image uses sans serif labels and amounts, with stronger weight for remaining money and totals. Small explanatory captions sit below the main value. [Official product page](https://www.quicken.com/products/simplifi/) | A clear label/value hierarchy can make a budget feel approachable without expressive display typography. Increase small labels before adding another family. |
| **Lunch Money** | **Visual:** its published dashboard combines a bold sans serif welcome heading with visibly monospaced amounts and several category rows, aligned columns, progress bars, and uppercase section labels. [Official dashboard image](https://lunchmoney.app/assets/images/screenshots/dashboard.png), [official site](https://lunchmoney.app/) | Monospace can fit a deliberate analytical tool. Canopy's warm paper surfaces plus serif branding plus mono create a different cumulative impression; removing most mono is a choice of product character, not a universal finance rule. |
| **Actual Budget** | **Documented font confirmation:** its repository design guide names Inter Variable for the interface and enables tabular OpenType features for financial figures in the same family. It describes compact typography with hierarchy controlled by size and weight. [Official design guide](https://github.com/actualbudget/actual/blob/master/DESIGN.md) | This is direct evidence for a unified sans serif budget interface with aligned figures. Canopy can adopt that principle while keeping Grove's warmer palette and proportional standalone hero figures. |

Direct image references inspected: [Monarch](https://cdn.sanity.io/images/mdewiujj/production/e27cb8f69d548264f4ce2481f045cf2d395bd189-2400x1260.png), [Copilot](https://framerusercontent.com/images/bnh1jc4bUXLlA25zPSSCyBHvc.png), [Simplifi](https://images.ctfassets.net/hfxittkcm76w/2lNTEu1fDWQ1UHiGujNNwk/cf6c77d0ac15b4309dfac29d0638703d/image-budget-viewport-desktop-2x.webp), and Lunch Money above. These are first-party public product references, not live authenticated app inspections. The YNAB AVIF image could not be decoded by the available local image viewer, so its row relies on documented product changes rather than a claimed visual font inspection.

## Candidate families

The fit assessments below are design recommendations, not measured rankings. Actual Budget's documented use of Inter is the confirmed competitor font identification in this study.

| Candidate | Fit with Grove | Tradeoff and evidence |
| --- | --- | --- |
| **Inter — recommended** | Crisp, neutral financial software character; Grove's green and warm surfaces prevent the result from feeling sterile. | Less distinctive on its own. The designer documents small-text optical designs, tall x-height, tabular figures, a slashed-zero option, variable weight, and SIL OFL licensing. [Official family and features](https://rsms.me/inter/) |
| **DM Sans — minimal change** | Familiar, approachable, and already installed. A unified family retains Canopy's warmth while eliminating the strongest ledger/technical cues. | Smaller change than replacing the entire family. Google's own description says it is a low-contrast geometric sans intended for small text, with an optical-size axis in the 2023 update. [Google Fonts description](https://github.com/google/fonts/blob/main/ofl/dmsans/DESCRIPTION.en_us.html), [upstream OFL statement](https://github.com/googlefonts/dm-fonts) |
| **Source Sans 3 — readability-led alternative** | Humanist warmth and a quieter, less geometric feel. Worth comparing in long account names and dense transaction tables. | More utilitarian than a premium consumer-finance aesthetic. Adobe explicitly designed the family for UI environments; it provides webfont and variable files under SIL OFL 1.1. [Adobe repository](https://github.com/adobe-fonts/source-sans), [license](https://github.com/adobe-fonts/source-sans/blob/release/LICENSE.md) |
| **Manrope — more personality** | Contemporary and geometric; expressive enough to give the brand a new voice while remaining sans serif. | Compare punctuation and digit shapes at actual ledger sizes. The open-source repository documents tabular figures and variable weights. Use the **Google Fonts/OFL distribution** for this comparison: the designer's newer V5 is a separate distribution with its own license, so do not treat all versions as interchangeable. [Open-source family](https://github.com/googlefonts/manrope), [Google Fonts license](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt), [designer's current release](https://www.sharanda.com/manrope) |

## Proposed type roles

These are starting values to compare in the artifact, not a new implemented design system.

| Role | Proposed treatment |
| --- | --- |
| Page title | Chosen sans, 28–30px, 600, slightly tight tracking |
| Section title | Chosen sans, 16–18px, 600 |
| Navigation and controls | Chosen sans, 14px, 400–500; 16px input text where mobile zoom behavior matters |
| Table rows | Chosen sans, 13px for dense desktop views; optional 14px for a more relaxed reading size |
| Supporting labels | Chosen sans, 12–13px, 500; sentence case and normal tracking |
| Main balance | Chosen sans, 30–36px, 600; proportional lining numerals |
| Row amounts | Chosen sans, 13px desktop or optional 14px, 500; tabular lining numerals; right aligned |
| Wordmark | Compare the current Young Serif wordmark with the chosen sans. A small serif wordmark can remain if it is the only serif role. |
| Technical identifiers | Monospace only where the identifier itself benefits from it |

Request `font-variant-numeric: tabular-nums lining-nums` on aligned amount rows and `proportional-nums lining-nums` on standalone hero figures, following Grove's distinction between data columns and display values. A separate monospaced font is not necessary for equal-width digits. Verify support in the exact delivered font files, because CSS alone cannot add missing OpenType features. Inter and the linked open-source Manrope documentation explicitly confirm tabular figures; equivalent exact-file verification remains an implementation check for DM Sans and Source Sans 3.

Compare each candidate with identical content, spacing, sizes, and colors in light and dark themes. Include `$1,111.11`, `$8,888.88`, `-$24.90`, `$0.00`, a long account name, a negative balance, and a narrow mobile view. Verify digit alignment, clear minus signs and decimal points, stable loading, and no truncation at browser zoom before adopting the selected family.
