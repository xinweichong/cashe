# Cashe Design Language

> **Cashe = cash + cache.** The cash you've spent, caught by the cache.
> Brand hook: **cash, caught.**

A standalone reference for everyone designing, building, or extending Cashe. This document is the source of truth for tokens, components, and brand. Application of the language to specific pages is covered in [`docs/superpowers/specs/2026-05-11-cashe-application-redesign.md`](superpowers/specs/2026-05-11-cashe-application-redesign.md).

---

## 1 · Brand

### 1.1 Name & meaning

The name **cashe** (lowercase, always) is a portmanteau of **cash** and **cache**.

- **Cash** — the money. The transactions. The thing you spend.
- **Cache** — silent storage. The system that captures every transaction automatically, so you never have to log anything yourself.

Together: the cash you've spent, *caught* by the cache.

### 1.2 Brand hook

**cash, caught.**

Three syllables. Used as the primary tagline anywhere a short hook is appropriate (splash, hero, README, social profile).

Longer-form variant for marketing copy or hero subtitles: **every dollar seen, every dollar saved.**

### 1.3 Wordmark — `ca$he`

The wordmark is **ca$he** — the literal "s" replaced by a warm-gradient "$" glyph. The dollar character is a visual pun: $ is a stylised S, so it reads as the word *cashe* while flagging the brand as a money product.

| Property | Value |
|---|---|
| Family | Plus Jakarta Sans |
| Weight | 800 (ExtraBold — the max available weight) |
| Letter-spacing | `-0.045em` |
| Line-height | `0.9` |
| "ca" + "he" color | `#00D4AA` (teal) |
| "$" fill | Warm gradient (see §2.3) |
| Casing | Always lowercase, including in headings and titles |

Reference CSS:

```css
.cashe-mark {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 0.9;
  display: inline-flex;
  align-items: baseline;
  transform: translateX(-1px); /* optical correction */
}
.cashe-mark .ca,
.cashe-mark .he { color: #00D4AA; }
.cashe-mark .dollar {
  background: linear-gradient(135deg, #D97706, #EA580C 50%, #DC2626);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin: 0 -0.02em;
}
```

The wordmark is the primary expression of the brand. **Use it wherever space allows** — sidebar, headers, footers, splash, README, marketing.

### 1.4 Icon — B1 spectrum wash

All static icons (PWA, browser tab, banners) use the **B1 spectrum-wash** background: a diagonal gradient that sweeps teal (entry) → near-ink (center) → orange/red (exit).

**Background spec:**
```css
background:
  linear-gradient(135deg,
    rgba(0,212,170,.38)  0%,
    rgba(11,11,20,.94)  35%,
    rgba(11,11,20,.98)  58%,
    rgba(234,88,12,.34) 82%,
    rgba(220,38,38,.3) 100%),
  #0B0B14;
border: 1px solid #2A2A3F;
border-radius: 25.5%;
box-shadow: 0 18px 40px -30px rgba(0,212,170,.85);
```

**Adaptive foreground by context:**

| Context | Foreground | Files |
|---|---|---|
| Wide banners (README, OG/social) | `ca$he` wordmark + `CASH, CAUGHT.` tagline | `cashe-banner.png`, `og-image.png` |
| App / PWA home-screen icons | `ca$he` wordmark only | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| Browser tab favicons | `$` glyph only (legibility at small size) | `favicon-32.png`, `favicon-192.png`, `favicon-512.png` |
| Login screen tile | `ca$he` + `CASH, CAUGHT.` (React component) | `CasheBrandLockup` in `Brand.tsx` |

Tagline uses JetBrains Mono 600, `letter-spacing: 0.24em`, `text-transform: uppercase`, `color: rgba(238,234,245,.68)`.

### 1.5 Icon — where it appears

- ✅ Browser tab favicon (`favicon-32.png`, `favicon-192.png`) — `$` only
- ✅ PWA / home-screen icon (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) — `ca$he` wordmark
- ✅ README banner, OG/social image — `ca$he` + tagline
- ✅ Login screen (`CasheBrandLockup` component) — `ca$he` + tagline in B1 square tile
- ❌ Sidebar — wordmark text only, no icon tile.
- ❌ Inline app chrome — wordmark text only.

### 1.6 Wordmark — where it appears

- ✅ Sidebar (always wordmark, never icon)
- ✅ Login / splash
- ✅ Headers, footers, page chrome
- ✅ README, marketing pages, social posts
- ✅ Email signatures, Telegram bot startup message

### 1.7 Brand-mark meaning

When you have space to tell the brand story (e.g. an "About" page, an empty-state, a splash screen):

> **cashe = cash + cache.**
> The teal is the cache — quiet, persistent storage that captures every transaction the moment it happens. The "$" glyph in warm gradient is the cash — the spending, made visible. Together, they tell the story of a system that catches every dollar.

### 1.8 Re-rendering static brand assets

All static PNG assets are rendered by Chrome via Playwright — the browser is the single canonical source of truth for fonts, gradients, and spacing. **Never hand-edit the PNGs or hand-craft SVG replacements.**

#### Prerequisites (one-time)

```bash
# Python dependencies
pip install playwright pillow numpy fonttools
playwright install  # or use: --executable-path to system Chrome

# Font files (embedded in the script as base64; refresh if fontsource packages update)
npm pack @fontsource/plus-jakarta-sans   # extract latin-800-normal.woff
npm pack @fontsource/jetbrains-mono      # extract latin-600-normal.woff
```

The script assumes these WOFF files live at the paths hardcoded in `scripts/gen-brand-assets.py`. Update those paths if you re-extract.

#### Running

```bash
python3 scripts/gen-brand-assets.py
```

Outputs (all overwritten in-place):

| File | Size | Foreground |
|---|---|---|
| `cashe-banner.png` | 1280×420 | `ca$he` + tagline |
| `src/web/frontend/public/og-image.png` | 1200×630 | `ca$he` + tagline |
| `src/web/frontend/public/icon-192.png` | 192×192 | `ca$he` wordmark |
| `src/web/frontend/public/icon-512.png` | 512×512 | `ca$he` wordmark |
| `src/web/frontend/public/apple-touch-icon.png` | 180×180 | `ca$he` wordmark |
| `src/web/frontend/public/favicon-32.png` | 32×32 | `$` only |
| `src/web/frontend/public/favicon-192.png` | 192×192 | `$` only |
| `src/web/frontend/public/favicon-512.png` | 512×512 | `$` only |

#### If you change the design

Edit the HTML inside `scripts/gen-brand-assets.py` — it is plain CSS/HTML. The B1 background gradient, font sizes, and letter-spacing are all inline in that file. Change the values, re-run the script, commit the new PNGs.

---

## 2 · Colour

### 2.1 The Cashe Spectrum

The five anchor colours of the brand, ordered cool → warm. Each anchor has a semantic role.

| Token | Hex | Name | Semantic role |
|---|---|---|---|
| `--color-teal` | `#00D4AA` | Teal | SAVED · on-track · brand anchor |
| `--color-mint` | `#34D399` | Mint | CALM · under pace |
| `--color-honey` | `#FBBF24` | Honey | ACTIVE · neutral spending |
| `--color-tangerine` | `#FB923C` | Tangerine | NOTABLE · attention |
| `--color-coral` | `#FF6B6B` | Coral | WARM · over pace · alert |

**Semantic rule:** the position along the spectrum encodes intensity. Cool colours mean "good news" (saving, under budget, on track). Warm colours mean "this is where the money is going" (spending, over budget, notable). Never a stoplight binary — always a spectrum.

### 2.2 Neutrals & system tokens

| Token | Hex | Role |
|---|---|---|
| `--color-background` | `#0B0B14` | Page canvas (deep ink with a slight cool tilt) |
| `--color-card` | `#161624` | Card surfaces |
| `--color-card-elev` | `#1B1B2C` | Elevated card surfaces (dialogs, dropdowns) |
| `--color-border` | `#2A2A3F` | All borders and dividers |
| `--color-foreground` | `#EEEAF5` | Primary text |
| `--color-muted` | `#7A7488` | Secondary text, axis ticks, eyebrow labels |
| `--color-destructive` | `#FF453A` | Delete actions, errors, "stop" semantic |
| `--color-success` | `#00D4AA` | Aliased to teal — "saved/on track" is the only success state |
| `--color-warning` | `#FBBF24` | Aliased to honey |
| `--color-info` | `#34D399` | Aliased to mint |

**Note:** Previous semantic tokens (`#30D158` success, `#FFD60A` warning, `#64D2FF` info, `#FF453A` destructive) are partially retired. Semantic warnings now use spectrum colours. The only retained generic semantic colour is `--color-destructive` because "delete / stop" needs a colour that doesn't appear in normal spending semantics.

### 2.3 Gradients

Three signature gradients. Use them deliberately — gradients carry brand weight; they lose meaning when overused.

**Full Spectrum (signature)** — used on hero CTAs, splash, empty states, the wordmark "$" position when not warm-only. Read as "the whole brand."

```css
background: linear-gradient(135deg,
  #00D4AA 0%,  /* teal */
  #34D399 25%, /* mint */
  #FBBF24 50%, /* honey */
  #FB923C 75%, /* tangerine */
  #FF6B6B 100% /* coral */
);
```

**Spending Sub-Gradient (deep)** — used on the wordmark "$", the icon "$", hero numerics on Overview/Analytics, hover state on hero CTAs. Read as "the cash."

```css
background: linear-gradient(135deg,
  #D97706 0%,  /* deep amber */
  #EA580C 50%, /* burnt orange */
  #DC2626 100% /* crimson */
);
```

The deep version is used wherever the gradient must read clearly against the teal anchor (the wordmark $, the icon $). The soft version (below) is used wherever the gradient sits on the dark background and needs warmth without aggression.

**Spending Sub-Gradient (soft)** — used on hero numerics that sit on `--color-background` directly (where the deep gradient feels too saturated).

```css
background: linear-gradient(135deg,
  #FBBF24 0%,  /* honey */
  #FB923C 50%, /* tangerine */
  #FF6B6B 100% /* coral */
);
```

**App-Shell Wash (B2)** — applied to the authenticated app shell root as a fixed background. Same diagonal hue stops as B1 but at ~20% of the login-screen opacity, so it reads as atmosphere rather than statement. Card surfaces (`--color-card`) remain visually elevated above it.

```css
background: linear-gradient(135deg,
  rgba(0,212,170,.08)  0%,    /* teal hint */
  transparent         30%,
  transparent         68%,
  rgba(234,88,12,.07) 86%,    /* tangerine hint */
  rgba(220,38,38,.06) 100%    /* coral hint */
), #0B0B14;
```

B2 is exported from `Brand.tsx` as `B2_WASH` and applied to the `AppShell` root `div` in `AppShell.tsx`. Sidebar, mobile header, and bottom tabs use `bg-card/80 backdrop-blur-sm` so B2 bleeds through the chrome.

### 2.4 Category palette

Cashe ships with 10 cohesive category colours sampled along the spectrum. Used by the donut chart, category pills, and transaction-row tinting.

```ts
export const SPECTRUM_PALETTE = [
  '#00D4AA', '#2DD4BF', '#34D399', '#84CC16', '#EAB308',
  '#FBBF24', '#F97316', '#FB923C', '#FB7185', '#FF6B6B',
];
```

**Migration:** Existing categories with custom colours auto-snap to their nearest spectrum match on the first app load after deploy. One-time normalisation, no opt-in.

### 2.5 Surface tints

For "tinted row" effects (transaction rows in lists, active period chips, "your money is here" callouts), use the category colour with hex-suffix opacity:

| Suffix | Opacity | Use |
|---|---|---|
| `0D` | 5% | Row resting background |
| `1A` | 10% | Row hover / edit-mode background |
| `33` | 20% | Icon pill background |

Example: a "Dining" row with category colour `#FBBF24` would have background `#FBBF240D` at rest, `#FBBF241A` on hover, with a `#FBBF2433` icon pill.

---

## 3 · Typography

### 3.1 Type families

| Family | Role | Source |
|---|---|---|
| **Plus Jakarta Sans** | Display — wordmark, page H1/H2, hero numerics, all card titles (`PageCard`, `ChartCard`), sidebar nav labels | Google Fonts |
| **Inter** | Body — paragraphs, buttons, action labels, form fields | Google Fonts |
| **JetBrains Mono** | Mono — page eyebrow kickers, stat/KPI labels, inline data descriptors, transaction IDs, timestamps | Google Fonts |

Three families chosen for clear functional separation:
- **Plus Jakarta** carries personality — the brand's friendly-confident voice. Used at every level that names something (page, section, card).
- **Inter** carries clarity — body legibility, interactive chrome.
- **JetBrains Mono** carries precision — anywhere we say "this is data" (IDs, timestamps, stat labels, eyebrow labels).

### 3.2 Modular scale — 1.250 (major third)

| Token | Size | Role |
|---|---|---|
| `text-2xs` | 11px | Mono caption, eyebrow micro-labels |
| `text-xs` | 12px | Mono captions, status pill labels |
| `text-sm` | 14px | Body, button labels, form field labels |
| `text-base` | 16px | Default paragraph, lede |
| `text-lg` | 20px | Card titles, section sub-headings |
| `text-xl` | 25px | Page H2, section headings |
| `text-2xl` | 31px | Page H1, stat values (long figures) |
| `text-3xl` | 39px | Stat values (short figures), card hero numerics |
| `text-4xl` | 49px | Health-card numerics, large stat values |
| `text-5xl` | 61px | Tablet hero numerics |
| `text-6xl` | 77px | Desktop hero numerics (Overview total, Analytics summary) |

### 3.3 Typographic conventions

- **Display sizes (≥ 25px)** use `letter-spacing: -0.025em` to `-0.05em` (tighter at larger sizes).
- **Hero numerics** (≥ 49px) use `letter-spacing: -0.04em` to `-0.05em`, `line-height: 0.92` to `0.95`, and the spending sub-gradient (soft) as the `background-clip: text` fill.
- **Body** uses `line-height: 1.55` to `1.65`.
- **Mono Eyebrow (Tier A — full):** `font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted`. For page kicker lines, `HeroCard`/`HighlightCard` titles, `StatCard` labels, and standalone KPI stat labels (INCOME · SPENT · SAVED, SAVED · TOWARD GOALS · UNALLOCATED, CONTRIBUTION HISTORY, etc.).
- **Mono Eyebrow (Tier B — inline):** `font-mono text-xs text-muted`. For inline data descriptors that annotate a value without heading authority — budget period, goal deadline, velocity sub-stat, connection status, feature toggle descriptions.

### 3.4 Weights

| Family | Available weights |
|---|---|
| Plus Jakarta Sans | 400, 500, 700, 800 |
| Inter | 400, 500, 600, 700 |
| JetBrains Mono | 400, 500, 600 |

Page H1s and hero numerics use Plus Jakarta 800. Card titles (`PageCard`, `ChartCard` title spans) use Plus Jakarta 700 (`font-semibold`). Sidebar nav labels use Plus Jakarta (`font-display`). Inter is reserved for 400-600 weights — never use Inter 700+ for hero content (it competes with Plus Jakarta).

---

## 4 · Spacing

A 4px base scale, named explicitly. No usage change from Tailwind defaults — the scale is documented for clarity and for non-Tailwind contexts.

| Token | px | Role |
|---|---|---|
| `space-1` | 4 | Icon-to-text gap, badge inner padding |
| `space-2` | 8 | Tight stacks (form field gap, inline groups) |
| `space-3` | 12 | Card inner element gap |
| `space-4` | 16 | Default card padding, mobile section gap |
| `space-5` | 20 | Roomy card padding (StatCard) |
| `space-6` | 24 | Spacious card padding, mobile page gutter |
| `space-8` | 32 | Desktop section gap, desktop page gutter |
| `space-12` | 48 | Hero block separation |
| `space-16` | 64 | Splash-page padding |

---

## 5 · Radii

| Token | px | Role |
|---|---|---|
| `radius-xs` | 4 | Tags, small chips, inline action affordances |
| `radius-sm` | 6 | Buttons, inputs, segmented controls |
| `radius-md` | 8 | Cards (default), dropdown menus, popovers |
| `radius-lg` | 14 | Stat cards, budget tiles, content panels |
| `radius-2xl` | 24 | Hero cards (Overview top card), large modals, splash containers |
| `radius-pill` | 999 | Badges, status pills, period chips, progress bars |

The icon container (`.cache-icon`) uses `border-radius: 22%` — a percentage-based radius so it scales with the icon's size (16px through 1024px).

---

## 6 · Elevation

Five tiers. Most surfaces use `elev-none` (a single 1px border on `--color-background`). Brand-glow tiers are used sparingly — 3–5 places in the whole application — because that's what makes them feel special when they appear.

| Token | Box-shadow | Use |
|---|---|---|
| `elev-none` | (none, border only) | Default card |
| `elev-xs` | `0 0 0 1px var(--border), 0 2px 6px rgba(0,0,0,.3)` | Hover on interactive cards |
| `elev-md` | `0 0 0 1px var(--border), 0 8px 24px rgba(0,0,0,.5)` | Dialogs, dropdowns, popovers, toast notifications |
| `elev-glow-teal` | `0 0 0 1px rgba(0,212,170,.18), 0 0 36px -8px rgba(0,212,170,.28)` | "On-track" health cards, completed goal cards |
| `elev-glow-warm` | `0 0 0 1px rgba(251,146,60,.14), 0 0 48px -10px rgba(251,146,60,.34)` | Hero card on Overview, splash container |

**The brand glow rule:** at most one warm glow and one teal glow visible on screen at a time. If a page would have two warm-glow cards (e.g., a hero + a "biggest spend" callout), demote one to `elev-none` and let the hero be the sole warm moment.

---

## 7 · Components

### 7.1 Buttons

CVA-based with six variants and five sizes.

| Variant | Use |
|---|---|
| `default` | Primary action. Teal background, dark text. The most common button. |
| `hero` | Splash, empty-state CTA, "Get started". Full spectrum gradient background with hover sweep animation. Used 2–4 places in the entire app. |
| `destructive` | Delete, sign out, remove. Red `#FF453A` background. |
| `outline` | Cancel, secondary actions. Transparent with `border-foreground/20`. |
| `ghost` | View all, dropdown trigger, low-emphasis. Transparent, hover to `bg-foreground/5`. **Never** hover to teal. |
| `link` | Inline text-style action. Teal foreground, underline on hover. |

Sizes:

| Size | Height | Padding | Use |
|---|---|---|---|
| `xs` | 28px | 10px | Inline edit/delete buttons in dense rows |
| `sm` | 34px | 12px | Toolbar buttons, secondary actions |
| `default` | 40px | 16px | Standard buttons |
| `lg` | 46px | 22px | Primary CTAs, hero CTAs |
| `icon` | 36×36 | — | Icon-only buttons (settings cog, close, more) |

**Ghost-button bug fix:** today's ghost variant hovers to `bg-accent text-accent-foreground` which paints the button teal. New ghost variant hovers to `bg-foreground/5 text-foreground` — a quiet darken, no colour shift.

### 7.2 Form fields

Unified around the `.input-field` utility class. The Radix `<Input>` wrapper is retired (or made a thin wrapper over the utility class) — one way to style an input, always.

- **Resting:** `bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground`
- **Focus:** `border-foreground ring-1 ring-foreground/20` — subtle but visible
- **Error:** `border-destructive/40` — combined with `text-destructive` helper text below the field
- **Disabled:** `opacity-50 cursor-not-allowed`

`.select-field` keeps the SVG chevron approach (white chevron, 50% opacity, no colour shift on hover).

### 7.3 Badges

CVA-based with the original four variants (`default`, `secondary`, `destructive`, `outline`) plus a new `tone` prop that maps to spectrum colours.

| Tone | Background tint | Text colour | Border tint |
|---|---|---|---|
| `saved` | `#00D4AA` @ 13% | `#00D4AA` | `#00D4AA` @ 25% |
| `calm` | `#34D399` @ 13% | `#34D399` | `#34D399` @ 25% |
| `active` | `#FBBF24` @ 13% | `#FBBF24` | `#FBBF24` @ 25% |
| `notable` | `#FB923C` @ 13% | `#FB923C` | `#FB923C` @ 25% |
| `warm` | `#FF6B6B` @ 13% | `#FF6B6B` | `#FF6B6B` @ 25% |

Replaces ad-hoc inline colour classes for category pills, source labels, and status pills.

### 7.4 Status dots

A new quieter pattern for status that doesn't need full pill weight (recurring detection, subscription marker, "on track" label):

```html
<span class="status">
  <span class="dot d-teal"></span>
  On track
</span>
```

Where `.dot` is a 6×6 rounded pill in the spectrum colour, and the text is normal-weight body. Use status dots when stacked or repeated — they scale visually better than pills.

### 7.5 Cards

Three reusable wrappers + two new highlights:

| Component | Use | Token |
|---|---|---|
| `<PageCard>` | Content, tables, lists, SVG visuals | `radius-md`, `elev-none` |
| `<ChartCard>` | Recharts charts (edge-to-edge content) | `radius-md`, `elev-none` |
| `<StatCard>` | Compact KPI display | `radius-lg`, `elev-none`, variant maps to expense/income/neutral |
| `<HeroCard>` **(new)** | Overview's top card — the hero numeric | `radius-2xl`, `elev-glow-warm`, radial-tint background + gradient hairline along top edge |
| `<HighlightCard>` **(new)** | Goal-completed callout, on-track health card, savings streak | `radius-lg`, `elev-glow-teal`, teal-tinted left-edge radial wash |

All five accept `title`, optional `action` (right-aligned in header), and `children`. `className` forwards to the root for one-off overrides.

### 7.6 Chart conventions

All Recharts configuration centralised in `src/lib/chartTheme.ts`. Never inline chart props.

| Export | Use |
|---|---|
| `CHART_TOOLTIP_STYLE` | `<Tooltip contentStyle={CHART_TOOLTIP_STYLE}>` — card background, 1px border, 13px font |
| `CHART_AXIS_PROPS` | Spread onto every `<XAxis>` and `<YAxis>` — 11px muted tick, no tickLine/axisLine |
| `CHART_CURSOR_BAR` | `<Tooltip cursor={CHART_CURSOR_BAR}>` on BarCharts — `#1C1C22` fill |
| `CHART_CURSOR_LINE` | `<Tooltip cursor={CHART_CURSOR_LINE}>` on LineCharts — `#2A2A3F` 1px stroke |
| `CHART_LEGEND_STYLE` | `<Legend wrapperStyle={CHART_LEGEND_STYLE}>` — 12px muted |
| `COLOR_TEAL` | `#00D4AA` — primary chart accent (trend lines, current-period bars) |
| `COLOR_MUTED_BAR` | `#3A3A46` — previous-period bars |
| `SPECTRUM_PALETTE` | 10-colour category palette (see §2.4) — donut/pie chart fills |

---

## 8 · Voice

> Matter-of-fact, slightly knowing, lightly warm. A friend who happens to be precise with money. Confident but not cocky. Never cheerleader. Never apologetic.

### 8.1 cashe says

- "Captured." (not "Successfully added!")
- "Spend something. We'll handle the math."
- "On track. $113/day average."
- "FairPrice — third visit this week."
- "Drop in a transaction. The categoriser will figure it out."
- "11 days out from goal. You'll get there."
- "Spending picked up — $74 at Shopee this morning."
- "Sign in." (not "Welcome back!")
- "112% of budget — Shopping's running warm."

### 8.2 cashe never says

- "Successfully created!" / "Welcome back!" / "Awesome!" / "You did it!"
- "Let's get started" / "Hey there" / any greeting that wastes a line
- "Uh oh, something went wrong" — too cute for a finance product
- "We couldn't process that. Please try again." — passive, jargon-y
- Emojis in microcopy. (Category icons are emoji — that's fine. Microcopy emojis — no.)
- Exclamation marks. (One allowed per page maximum, and only for genuine celebration. The hook "cash, caught." uses a period, not an exclamation.)

### 8.3 Copy migrations

| Today | New |
|---|---|
| "Loading…" | "Catching up…" |
| "Successfully saved" | "Saved" |
| "No transactions yet" | "Nothing captured this period." |
| "Failed to load" | "Couldn't load this — try refreshing." |
| "Are you sure you want to delete?" | "Delete this? It's gone for good." |
| "Welcome to Cashe!" | "cashe = cash + cache. Drop in a transaction." |
| "Add Transaction" (button) | "Add Transaction" — kept; titlecase on action labels is fine |

### 8.4 Casing rules

- **Brand name in product copy:** lowercase `cashe` (always).
- **Brand name in formal documentation / legal:** lowercase `cashe` (same).
- **Headings:** sentence case, not title case. ("Where the dollars go." — not "Where The Dollars Go.")
- **Action labels (buttons):** title case. ("Add Transaction", "Sign In", "Delete".)
- **Eyebrow labels (mono):** uppercase with letter-spacing. ("THIS MONTH · DAY 11 OF 30".)
- **Tagline:** all lowercase. ("cash, caught.")

---

## 9 · Iconography

### 9.1 Library

[lucide-react](https://lucide.dev) for all UI icons. No alternative library, no custom replacement, no mixing with heroicons / phosphor / feather.

Custom icons exist only for **source labels** (DBS, UOB, Apple Wallet, Cash) — tiny 12-14px SVG glyphs in `src/web/frontend/src/components/icons/sources.tsx`. Everything else is lucide.

### 9.2 Stroke weight

`1.5` (overridden from lucide's default of 2). Gives a quieter, more editorial feel that pairs with Plus Jakarta headings.

Override at the icon-component level — never per-instance. Every lucide icon in the app uses 1.5 stroke. (Single line override in the Tailwind / wrapper config.)

### 9.3 Sizes — three only

| Class | Size | Use |
|---|---|---|
| `w-3.5 h-3.5` | 14px | Inline actions in dense rows (edit/delete on transaction rows) |
| `w-4 h-4` | 16px | Standard buttons, form field affixes, badge prefixes |
| `w-5 h-5` | 20px | Navigation, primary CTAs, larger toolbar buttons |

No `w-6` (24px) or larger. If a brand icon needs to be bigger (empty-state illustration, splash), it goes through the brand mark (icon `$` in cache or full wordmark), not lucide.

### 9.4 Colour rules

| Context | Colour |
|---|---|
| Default | `text-muted` |
| Destructive action (delete, error) | `text-destructive` — never `text-muted` on hover |
| "On track" / saved / completed | `text-teal` (when semantic) |
| "Notable" alert | `text-tangerine` |
| "Warm" / over-budget alert | `text-coral` |
| Inside a teal element | `text-foreground` or `text-background` (whichever has contrast) |

**Never** use `text-accent` for destructive intent. (The bug that motivated [AGENTS.md](../AGENTS.md) getting written.)

### 9.5 Persistence rule

Edit/delete icon buttons are **always visible** — never hidden behind `opacity-0 group-hover:opacity-100`. Discoverability over minimalism. From AGENTS.md, restated:

```tsx
<Button variant="ghost" size="icon" className={size}>
  <Pencil className="w-3.5 h-3.5" />
</Button>
<Button variant="ghost" size="icon" className={`${size} text-destructive`}>
  <Trash2 className="w-3.5 h-3.5" />
</Button>
```

Always `Button` (never bare `<button>`). Always `variant="ghost" size="icon"`. Always `text-destructive` on delete. Always persistent.

---

## 10 · Token reference

A flat table of every token defined in this document, for IDE autocomplete reference and for the `@theme` block in `index.css`.

```css
@theme {
  /* Brand */
  --color-teal:       #00D4AA;
  --color-mint:       #34D399;
  --color-honey:      #FBBF24;
  --color-tangerine:  #FB923C;
  --color-coral:      #FF6B6B;

  /* System */
  --color-background:        #0B0B14;
  --color-card:              #161624;
  --color-card-elev:         #1B1B2C;
  --color-border:            #2A2A3F;
  --color-foreground:        #EEEAF5;
  --color-muted:             #7A7488;
  --color-destructive:       #FF453A;
  --color-destructive-foreground: #FFFFFF;

  /* Semantic aliases */
  --color-success:  var(--color-teal);
  --color-warning:  var(--color-honey);
  --color-info:     var(--color-mint);

  /* Type */
  --font-display: 'Plus Jakarta Sans', system-ui, sans-serif;
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', 'SF Mono', monospace;

  /* Radii */
  --radius-xs:   4px;
  --radius-sm:   6px;
  --radius-md:   8px;
  --radius-lg:   14px;
  --radius-2xl:  24px;
  --radius-pill: 9999px;

  /* Elevation */
  --elev-xs:         0 0 0 1px var(--color-border), 0 2px 6px rgba(0,0,0,.3);
  --elev-md:         0 0 0 1px var(--color-border), 0 8px 24px rgba(0,0,0,.5);
  --elev-glow-teal:  0 0 0 1px rgba(0,212,170,.18), 0 0 36px -8px rgba(0,212,170,.28);
  --elev-glow-warm:  0 0 0 1px rgba(251,146,60,.14), 0 0 48px -10px rgba(251,146,60,.34);

  /* Radix UI compatibility tokens — required by Radix primitives, not design tokens */
  --color-popover:            #1B1B2C;   /* = card-elev */
  --color-popover-foreground: #EEEAF5;   /* = foreground */
  --color-accent:             #EEEAF5;   /* Radix hover-state; not the brand accent */
  --color-accent-foreground:  #EEEAF5;
  --color-input:              #2A2A3F;   /* = border */
  --color-ring:               #00D4AA;   /* = teal — focus ring */
  --color-card-hover:         #1C1C22;   /* bar-chart cursor fill */

  /* Gradients (defined inline, not as CSS custom properties — gradients on var() are non-trivial) */
  /* See §2.3 for the three signature gradients */
}
```

---

## 11 · Out of scope (what this doc does not cover)

- **Page layouts.** Per-page grid templates, card placements, and information hierarchy live in the application redesign spec.
- **Backend / API.** This is a pure design language doc. No data model, no endpoints, no parser specs.
- **Telegram bot UI.** Telegram has its own constraints; only the bot's *copy* needs to follow the voice rules here.
- **Animation implementation.** Spring presets live in [`src/web/frontend/src/lib/animations.tsx`](../src/web/frontend/src/lib/animations.tsx); the rules for *when and how* to use them are in §14.

---

## 12 · States

Every data surface has four possible states: loading, empty, error, loaded. The first three each have exactly one pattern. No page invents its own.

### 12.1 Loading — skeletons

- **Primitive:** `<Skeleton>` (`src/components/ui/skeleton.tsx`) — `bg-foreground/10 animate-pulse rounded-md`, sized by the caller.
- Skeletons **mirror the shape of the content they replace** — rows for lists, blocks for charts, rings for rings. Never a spinner, never a bare pulse rectangle where structure is known.
- Skeletons carry no copy. The text "Catching up…" appears only on full-screen boots (splash), in-shell route loads, and infinite-scroll footers — styled as a Tier A mono eyebrow (`font-mono text-xs uppercase tracking-[0.22em] text-muted`) for the first two, `text-xs text-muted` for footers.

### 12.2 Empty

- **Anatomy:** one voice-conformant line (`text-sm text-muted`, centered, `py-8`–`py-12`) plus at most one CTA (`default` button) when there is a single obvious next action.
- No illustrations, no oversized icons (§9.3 still applies). The copy carries the moment: "Nothing captured this period."
- Empty is not an error — never show Retry on an empty state.

### 12.3 Error

- **Recoverable load failure:** the `<LoadFailed>` pattern (`src/components/ui/LoadFailed.tsx`) — "Couldn't load this — try refreshing." (`text-sm text-muted`) + ghost `Retry` button. Used wherever a page-level query fails.
- **Field/form errors:** `text-sm text-destructive`, inline below the field or submit button (unchanged rule, restated for completeness).
- **Mutation failures after an optimistic update:** rollback the UI, then toast (§13). The interface never lies silently.

---

## 13 · Feedback — toasts

The voice's signature line — "Captured." — finally has a home.

### 13.1 Surface

- One toast at a time. A new toast **replaces** the current one; toasts never stack.
- Position: bottom-center above the tab bar on mobile (`bottom-20`), bottom-right on desktop (`bottom-6 right-6`).
- Style: `bg-card-elev border border-border shadow-elev-md rounded-md px-4 py-2.5 text-sm text-foreground`. `role="status" aria-live="polite"`.
- Auto-dismiss after 3s. No close button. At most one inline action (e.g. Undo), rendered `text-teal`.

### 13.2 When to toast

| Situation | Toast? | Copy |
|---|---|---|
| Mutation whose result is no longer visible in place (form closed, row left the screen) | Yes | "Captured." / "Saved." / "Deleted." |
| Optimistic rollback (the UI just snapped back) | Yes | "Couldn't save — reverted." / "Couldn't delete — restored." |
| Mutation whose result is visible right where the user is looking | No | the change *is* the feedback |
| Navigation, background refetch, polling | Never | — |

Voice rules apply (§8): past-tense, period, no exclamation marks, no "Successfully".

---

## 14 · Motion

Source of truth for presets: [`src/lib/animations.tsx`](../src/web/frontend/src/lib/animations.tsx).

### 14.1 Presets

| Export | Spring / timing | Use |
|---|---|---|
| `springs.gentle` | 200 / 25 | Default. Page entrances, list items, card reveals |
| `springs.snappy` | 350 / 30 | Spatial chrome — detail panels, drawers, sheets |
| `springs.bouncy` | 400 / 20 | Celebration only (goal completed). ≤1 place per page |
| `pageVariants` | gentle in, 0.12s ease-in out | Route transitions (AppShell) |
| `fadeUpVariants` | gentle in, 0.12s ease-in out | Form expands, card entrances |
| `slideInRightVariants` | snappy in, 0.15s ease-in out | Right-side detail panels |
| `slideUpVariants` | snappy in, 0.2s ease-in out | Bottom drawers (mobile) |
| `staggerContainer/ItemVariants` | 0.04s children | Lists — cap staggering at 10 items (`STAGGER_LIMIT`) |
| `AnimatedCurrency` | 0.7s ease-out count-up | Hero numerics only — one count-up per page |

### 14.2 Rules

- Motion expresses **state change or spatial continuity** — never decoration. No idle loops, no attention-seeking pulses (the skeleton pulse is the one exception, and it means "working").
- Entrances spring; exits are fast fades (0.1–0.2s ease-in). Leaving must always be quicker than arriving.
- **Reduced motion:** every page-level or repeating animation gates on `useReducedMotion` — the pattern in `AppShell.tsx` is canonical. New animated surfaces must do the same.

---

## 15 · Accessibility

- **Contrast:** `--color-foreground` on `--color-background` is ~15:1. `--color-muted` (`#7A7488`) on background is ~4.5:1 — the AA floor. Rules: never introduce text colour dimmer than `muted`; `muted` body copy is 12px (`text-xs`) minimum. The 11px mono eyebrows compensate with uppercase, tracking, and weight, and must label — not carry — primary information.
- **Focus:** every interactive element shows `focus-visible:ring-2 ring-ring` (teal). Never `outline-none` without a focus-visible replacement. (The Button CVA already complies — match it.)
- **Touch targets:** ≥36px effective target on touch viewports. Bump with responsive padding (`py-2 md:py-1`), never by changing the desktop design.
- **Icon-only buttons** always carry `title` and `aria-label`.
- **Reduced motion:** see §14.2.

---

## 16 · Money & numbers

A finance app's most-repeated UI element is a number. One grammar, everywhere:

- **All monetary values go through `formatCurrency`** (`src/lib/utils.ts` — Intl `en-SG`, 2 decimals). Never `toFixed` + `"$"` string concatenation.
- **Whole-dollar contexts** (dense summaries like "$1,200 of $5,000") use `formatCurrencyWhole` — same Intl formatter with 0 fraction digits. The choice is per-surface, not per-value: a surface shows either all-cents or all-whole.
- **SGD renders a bare `$`** (Intl en-SG default). Foreign currencies render their own symbol/code via Intl; rows show the **original** currency, while all summaries use the SGD-converted value (`amount × exchange_rate` — backend rule, restated).
- **Signs:** expenses are unsigned — spending is the default story. Income takes a `+` prefix and `text-success`. A minus sign appears only for true reversals/refunds.
- **Hero numerics** use `AnimatedCurrency` (§14) and keep cents.
- **Percentages** round to whole (`toFixed(0)` + `%`).
- Amounts in rows, tables, and KPIs are `font-mono` (§3.1).


## Next experience navigation (opt-in)

`home_briefing_enabled` now selects Home, Activity, Plan, and Explore in the sidebar and phone tabs. Settings and capture review live in the profile menu; Review is also linked from Home and Activity. Classic navigation remains available by turning off “New experience” in Settings. Old transaction, finance, analytics, and merchant URLs redirect with their suffix, query, and fragment intact. `/overview` retains the classic dashboard for comparison.

Home and Explore use natural page scrolling. Activity retains independently scrolling list/detail panels; opening a detail keeps the parent mounted to preserve filters and drafts. Explore groups the existing analytics and merchant reports, whose financial calculations still await migration to shared spending facts. Plan opens a naturally scrolling upcoming-charge timeline with 14/30/90-day windows, estimated and unknown amounts, and schedule-review links. Inline prediction edits use labeled date/SGD amount fields, preserve failed forms, and omit unchanged rounded values. Dismissal has an explicit confirmation explaining that it does not cancel the provider. Existing matching and finance tools remain at /plan/manage. The timeline contains recorded pending schedules; future-cycle expansion, confirmation metadata, and the planned forecast remain incomplete. The four primary navigation targets and profile controls have a 44px minimum hit area. Browser/device accessibility checks remain pending.


## Appearance preferences

The application follows the system light/dark preference by default. Profile → Appearance offers System, Light, and Dark in both navigation modes. Only the appearance preference is stored locally (`cashe-appearance`); it contains no financial data. Theme changes update context and tokens without remounting forms.

Dark muted text is now `#A8A1B5`. Light surfaces use background `#F6F5F8`, card `#FFFFFF`, foreground `#201C2C`, muted `#625C70`, and interactive teal `#007A63`. Brand gradients retain their spectrum and use dark `--color-on-brand` text. Primary and muted tokens meet 4.5:1 against neutral background/card/elevated surfaces in both themes; this is not a whole-interface accessibility certification. Category colors, opacity variants, charts, enlarged text, and device layouts still require rendered review.

Charts consume `useChartTheme()` from `lib/chartTheme.ts`: axis, tooltip, cursor, legend, tracks, and text use centralized explicit hex colors for each theme. Never hardcode those colors in chart components. Framer Motion follows reduced-motion preference globally; CSS animations and transitions are suppressed when requested.
