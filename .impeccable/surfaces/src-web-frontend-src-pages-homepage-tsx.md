---
version: 1
slug: "src-web-frontend-src-pages-homepage-tsx"
primary_target: "src/web/frontend/src/pages/HomePage.tsx"
related_targets: []
---

## Direction contract

THESIS: Home reads as the category mix first — "where the dollars go" made literal as the first thing you see — instead of the current stacked-prose report where the hero number, chart, and six paragraph cards all carry equal weight and scroll past in sequence.

OWN-WORLD: The existing Spectrum Instrument system exactly as documented — teal→coral status spectrum, Plus Jakarta for anything named, Inter for body/controls, JetBrains Mono eyebrows/labels, `elev-none` flat cards with rationed warm/teal glow, `StatCard`/`Badge`/`StatusDot`/`Button`/`PageCard`/`HeroCard` as the only owners. No new tokens, no new component variants.

STORY: The visitor opens Home and immediately sees the shape of their spending (the donut) with the month total and status living inside/beside it, not below three paragraphs of prose. Secondary facts (comparison, target, income, net flow) render as compact stat tiles and badges next to the chart, not full sentences. Actions (Add, See spending, Review, Open plan) are real bordered/pill buttons, never bare colored text. "Needs attention" and "Coming up" become scannable rows with a status dot and a real button, not stacked block-links.

FIRST VIEWPORT: Eyebrow "Home" + heading "Where the dollars go." + an Add button (bordered, icon). Directly below: a large `CategoryDonut` (left, ~60% width) with the hero spend amount and status/target badges set at its center or immediately above it; to its right, a compact trend sparkline and the top category-change bar, both de-emphasized relative to the donut. "Coming up" and "Needs attention" sit in a two-column row beneath, each item a StatusDot + label + real button row. Recent activity closes the page as the existing `ActivityRowShell` list.

FORM: "Where It Went, led by the mix" — the roll's lead candidate (index 4 of my own ranked structural list), chosen by the user directly off the decision page with no re-roll. Seed key 338a3ba6.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
