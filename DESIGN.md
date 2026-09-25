---
name: cashe
description: cash, caught — a self-hosted finance dashboard rendered as a dark, spectrum-driven fintech instrument
colors:
  teal: "#00D4AA"
  mint: "#34D399"
  honey: "#FBBF24"
  tangerine: "#FB923C"
  coral: "#FF6B6B"
  background: "#0B0B14"
  card: "#161624"
  card-elev: "#1B1B2C"
  card-hover: "#1C1C22"
  border: "#2A2A3F"
  foreground: "#EEEAF5"
  muted: "#A8A1B5"
  destructive: "#FF453A"
  on-brand: "#0B0B14"
  primary: "{colors.teal}"
  success: "{colors.teal}"
  warning: "{colors.honey}"
  info: "{colors.mint}"
  background-light: "#F6F5F8"
  card-light: "#FFFFFF"
  card-hover-light: "#EDEAF2"
  border-light: "#D9D5E1"
  foreground-light: "#201C2C"
  muted-light: "#625C70"
  teal-light: "#007A63"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontWeight: 800
    letterSpacing: "-0.045em"
    lineHeight: 0.9
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.9375rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.22em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "14px"
  2xl: "24px"
  pill: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "linear-gradient(135deg, {colors.teal} 0%, {colors.mint} 25%, {colors.honey} 50%, {colors.tangerine} 75%, {colors.coral} 100%)"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  card-page:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-hero:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.2xl}"
    padding: "32px"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
---

# Design System: cashe

## Overview

**Creative North Star: "The Spectrum Instrument"**

cashe reads as a precise, dark-mode financial instrument, not a cheerful budgeting app. The whole system runs on one governing idea: a five-stop cool-to-warm spectrum (teal → mint → honey → tangerine → coral) that encodes financial temperature everywhere a value needs meaning — teal-side means "good news, on track, saved"; coral-side means "this is where the money is going, over pace, alert." It is deliberately never a stoplight binary. Position along the spectrum, not a fixed palette of red/yellow/green, is the semantic unit.

The base surface is near-black ink (`#0B0B14`) with a very faint cool tilt, kept almost entirely flat — most cards carry no shadow at all, just a 1px border. Brand warmth is rationed: gradient fills and glow elevation appear in three to five places per screen at most, so when they do appear (hero numerics, the primary CTA, an "on track" health card) they read as genuinely special rather than decorative wallpaper. Three type families do three distinct jobs — Plus Jakarta Sans carries personality wherever something is being *named* (headings, card titles, the wordmark), Inter carries plain-legibility body and interactive chrome, and JetBrains Mono flags "this is data" (eyebrow labels, stat labels, timestamps, IDs). The voice is matter-of-fact and lightly warm — "Captured." not "Successfully added!" — because this is a private financial instrument for a small, trusted circle of people, not a consumer app performing enthusiasm at a stranger.

**Key Characteristics:**
- A five-color semantic spectrum (never a red/green binary) drives every status, badge, chart, and category color in the system.
- Near-black flat surfaces at rest; glow elevation and gradient fills are rationed to a handful of moments per screen so they stay meaningful.
- Three typefaces, three jobs: Plus Jakarta (naming/personality), Inter (body/clarity), JetBrains Mono (data/precision).
- Matter-of-fact, unexclamatory voice — periods, not exclamation marks; "Captured." not "Success!"

## Colors

Dark is the default and primary experience; a light theme exists as a faithful token swap, not a separate design.

### Primary
- **Teal** (`#00D4AA`): brand anchor. "Saved / on-track" semantic, the wordmark's "ca" and "he", primary buttons' gradient origin, focus rings, chart primary accent.

### Secondary — The Cashe Spectrum
Five anchor colors, ordered cool → warm, each carrying a semantic role. The position along this line *is* the meaning.
- **Mint** (`#34D399`): CALM · under pace.
- **Honey** (`#FBBF24`): ACTIVE · neutral spending.
- **Tangerine** (`#FB923C`): NOTABLE · attention.
- **Coral** (`#FF6B6B`): WARM · over pace · alert.

### Neutral
- **Background** (`#0B0B14`): page canvas — deep ink, slight cool tilt. Light theme: `#F6F5F8`.
- **Card** (`#161624`): default card surface. Light theme: `#FFFFFF`.
- **Card Elevated** (`#1B1B2C`): dialogs, dropdowns, popovers, toasts. Light theme: `#FFFFFF` (differentiated by shadow, not fill).
- **Card Hover** (`#1C1C22`): hover fill and bar-chart cursor. Light theme: `#EDEAF2`.
- **Border** (`#2A2A3F`): all borders and dividers, dark theme's only elevation cue at rest. Light theme: `#D9D5E1`.
- **Foreground** (`#EEEAF5`): primary text, ~15:1 on background. Light theme: `#201C2C`.
- **Muted** (`#A8A1B5`): secondary text, axis ticks, eyebrow labels — holds the AA 4.5:1 floor against background; never go dimmer. Light theme: `#625C70`.
- **Destructive** (`#FF453A`): delete actions, errors, the one "stop" semantic outside the spectrum — reserved because "delete" needs a color that never appears in normal spending semantics.

### Named Rules
**The Spectrum-Not-Stoplight Rule.** Status is never red/yellow/green. It is a position on the five-stop teal→coral spectrum, because spending health is a gradient, not a pass/fail.

**The Rationed Glow Rule.** At most one warm glow and one teal glow visible on screen at a time. If a page would produce two warm-glow cards, demote one to flat (`elev-none`) and let a single hero carry the warmth.

### Gradients
- **Full Spectrum** (`linear-gradient(135deg, #00D4AA 0%, #34D399 25%, #FBBF24 50%, #FB923C 75%, #FF6B6B 100%)`): the signature "whole brand" fill — primary buttons, splash, hero CTAs, empty states.
- **Spending Sub-Gradient, deep** (`linear-gradient(135deg, #D97706 0%, #EA580C 50%, #DC2626 100%)`): the wordmark's "$", used wherever the gradient must read clearly against the teal anchor.
- **Spending Sub-Gradient, soft** (`linear-gradient(135deg, #FBBF24 0%, #FB923C 50%, #FF6B6B 100%)`): hero numerics sitting directly on `background`, where the deep version would feel too saturated.
- **App-Shell Wash (B2)**: the full-spectrum diagonal at ~20% opacity as a fixed background behind the authenticated app shell — atmosphere, not statement; card surfaces stay visually elevated above it.

### Category & tint system
Ten category colors sampled along the spectrum drive the donut chart, category pills, and transaction-row tinting (`#00D4AA #2DD4BF #34D399 #84CC16 #EAB308 #FBBF24 #F97316 #FB923C #FB7185 #FF6B6B`). For "tinted row" surfaces, a category's own color is reused at three opacities via hex-suffix: `0D` (5%, row resting background), `1A` (10%, row hover), `33` (20%, icon pill background) — never a separate tint palette.

## Typography

**Display Font:** Plus Jakarta Sans (weights 400/500/700/800)
**Body Font:** Inter (weights 400/500/600/700)
**Label/Mono Font:** JetBrains Mono (weights 400/500/600)

**Character:** Plus Jakarta carries the brand's friendly-confident personality at every level that *names* something (page titles, card titles, the wordmark, sidebar nav labels). Inter is reserved purely for clarity — body copy, buttons, form fields — and is never pushed past weight 600 for hero content, so it never competes with Plus Jakarta. JetBrains Mono flags precision: anywhere the UI is saying "this is data" rather than "this is prose."

### Hierarchy
- **Display / Hero numerics** (800, 49–77px, line-height 0.92–0.95, letter-spacing -0.04 to -0.05em): the soft spending gradient as a text-clip fill. One per page, animated with a count-up. Overview total, Analytics summary.
- **Headline / Page H1** (800, 31px): top-level page titles.
- **Title / Card titles** (700, 20px): `PageCard`/`ChartCard` title spans, section sub-headings.
- **Body** (400–500, 14–16px, line-height 1.55–1.65): paragraphs, form fields, button labels.
- **Mono Eyebrow, Tier A — full** (600, 12px, `tracking-[0.22em]`, uppercase, muted): page kickers, HeroCard/HighlightCard titles, StatCard labels, standalone KPI labels ("INCOME · SPENT · SAVED").
- **Mono Eyebrow, Tier B — inline** (400, 12px, muted, no tracking): inline data descriptors that annotate a value without heading authority (budget period, goal deadline, connection status).

### Named Rules
**The Named-Thing Rule.** Plus Jakarta is reserved for anything that names a page, card, or section. Inter never carries a heading; Plus Jakarta never carries a paragraph.

## Layout

A 4px base spacing scale (`space-1` = 4px through `space-16` = 64px), documented explicitly even though it maps onto Tailwind defaults, so non-Tailwind contexts (native shells, Telegram-adjacent surfaces) stay consistent. Card padding is `space-4` (16px) by default, `space-5`/`space-6` for roomier stat and hero surfaces. Desktop section and page gutters step up to `space-8` (32px); mobile stays at `space-4`–`space-6`. Hero blocks get `space-12` (48px) separation; splash screens get the full `space-16` (64px).

The app shell is a fixed sidebar (desktop) / bottom tab bar (mobile) around a scrolling content area, with the B2 spectrum wash as a fixed atmospheric background behind translucent, backdrop-blurred chrome (`bg-card/80 backdrop-blur-sm`) so the wash bleeds through. Six primary surfaces (Overview, Transactions, Analytics, Finance, Merchants, Settings) plus a newer opt-in navigation set (Home, Activity, Plan, Explore) share the same shell and token system.

## Elevation & Depth

Cashe is flat by default and treats elevation as a scarce, meaningful signal rather than a universal card treatment. Most surfaces use `elev-none` — a single 1px border on the background color, no shadow at all. Real box-shadow elevation is reserved for genuinely floating surfaces (dialogs, dropdowns, toasts) and for the rationed brand-glow tiers, which appear in only three to five places across the whole app.

### Shadow Vocabulary
- **elev-none** (border only, no shadow): the default for nearly every card.
- **elev-xs** (`0 0 0 1px var(--border), 0 2px 6px rgba(0,0,0,.3)`): hover state on interactive cards.
- **elev-md** (`0 0 0 1px var(--border), 0 8px 24px rgba(0,0,0,.5)`): dialogs, dropdowns, popovers, toasts.
- **elev-glow-teal** (`0 0 0 1px rgba(0,212,170,.18), 0 0 36px -8px rgba(0,212,170,.28)`): "on-track" health cards, completed goal cards.
- **elev-glow-warm** (`0 0 0 1px rgba(251,146,60,.14), 0 0 48px -10px rgba(251,146,60,.34)`): the Overview hero card, the splash container.

### Named Rules
**The Rationed Glow Rule** (see Colors) governs elevation as much as color: glow is a spotlight, not ambient texture.

## Shapes

Six radius steps, each tied to a specific role rather than a free scale: `radius-xs` (4px) for tags and small chips; `radius-sm` (6px) for buttons, inputs, and segmented controls; `radius-md` (8px) for default cards, dropdowns, and popovers; `radius-lg` (14px) for stat cards, budget tiles, and content panels; `radius-2xl` (24px) for hero cards and large modals; `radius-pill` (9999px) for badges, status pills, period chips, and progress bars. The brand icon container is the one percentage-based exception, at `border-radius: 22%`, so the squircle silhouette scales correctly from a 16px favicon to a 1024px app icon.

### Named Rules
**The Role-Bound Radius Rule.** A radius value signals what kind of surface it is (control vs. card vs. hero vs. pill) — never mix radii within a role for visual variety.

## Components

### Buttons
- **Shape:** `radius-sm` (6px), heights of 36px (`sm`), 40px (`default`), 44px (`lg`), 40×40 (`icon`).
- **Primary (`default`):** the full-spectrum gradient fill (`btn-gradient`, animated background-position shift on hover), `text-on-brand`, bold weight. Reserved for the single main command on a screen.
- **Outline:** background/input-border, neutral hover — cancel/secondary actions.
- **Ghost:** transparent, hovers to `foreground/5` — **never** to teal. Used for "view all," dropdown triggers, low-emphasis actions.
- **Destructive:** solid destructive-token fill — confirming irreversible actions only.
- **Link:** `text-teal` with underline-on-hover, for inline text-style commands.
- All variants share `active:scale-[0.97]` press feedback and a `focus-visible:ring-2 ring-ring ring-offset-2` focus ring.

### Cards
Five shared surface roles, never improvised per page:
- **PageCard** — general content, tables, lists (`radius-md`, `elev-none`).
- **ChartCard** — edge-to-edge Recharts container (`radius-md`, `elev-none`).
- **StatCard** — compact KPI display (`radius-lg`, `elev-none`).
- **HeroCard** — the single hero numeric surface per page (`radius-2xl`, warm glow, a radial tint plus a gradient hairline accent).
- **HighlightCard** — the one supported "positive outcome" callout (`radius-lg`, teal glow, left-edge wash via `color-mix` on the teal token).

### Inputs / Fields
- **Style:** background-fill, `border-border`, `radius-sm`, 16px text below the `md` breakpoint (avoids iOS Safari zoom-on-focus) dropping to 14px above it.
- **Focus:** `focus-visible:ring-2 ring-ring ring-offset-2` — the same global ring as buttons and every interactive element.
- **Error:** `aria-invalid="true"` → destructive border at 40% + destructive helper text below the field.
- **Disabled:** 50% opacity, `cursor-not-allowed`.
- Native `<select>` (`.select-field`) shares every state and adds a themed inline SVG chevron; it is preferred over a custom dropdown wherever native semantics suffice.

### Badges
Four structural variants (`default`, `secondary`, `destructive`, `outline`) plus a `tone` prop mapping to the five spectrum colors (`saved`/`calm`/`active`/`notable`/`warm`), each rendered as a 13%-opacity background tint, full-opacity text, and 25%-opacity border in the same hue. `tone` takes precedence over `variant`. A Badge is a label, never a control.

### Status dots
A quieter alternative to full badge weight for repeated/stacked status (recurring detection, "on track" markers): a 6×6px rounded dot in a spectrum color beside normal-weight text. Scales visually better than pills when several appear together.

### Toasts
One toast at a time — a new one replaces rather than stacks. `card-elev` surface, `elev-md`, `radius-md`, bottom-center on mobile (above the tab bar), bottom-right on desktop. Auto-dismiss at 3s, no close button, at most one inline action in `text-teal`. Reserved for mutations whose result is no longer visible in place; never for navigation or background refetches.

### Iconography
lucide-react exclusively, at a global 1.5 stroke weight (overridden once at the wrapper level, never per-instance) for a quieter, more editorial feel against Plus Jakarta headings. Exactly three sizes in use — 14px (dense inline row actions), 16px (standard buttons/fields/badges), 20px (navigation, primary CTAs) — with no 24px+ tier; anything bigger routes through the brand mark, not an icon. Default color is muted; destructive actions are always `text-destructive`, never dimmed to muted on hover.

### Named Rules
**The One Visual Owner Rule.** One visual role and interaction contract has exactly one shared component owner (e.g. all buttons through `button.tsx`, all category rows through `ActivityRowShell`/`CategoryAvatar`). A new page composes existing owners; introducing a parallel implementation of an existing role requires explicit approval first.

**The Persistent Action Rule.** Edit/delete icon buttons are always visible — never hidden behind `opacity-0 group-hover:opacity-100`. Discoverability beats minimalism here.

## Do's and Don'ts

### Do:
- **Do** encode status as a position on the teal→coral spectrum, never a red/yellow/green stoplight.
- **Do** keep cards flat (`elev-none`, border only) by default; reserve real shadow and glow for dialogs/toasts and the 3–5 rationed brand-glow moments per screen.
- **Do** route every monetary value through the shared currency formatter (never `toFixed` + string-concatenated `"$"`); expenses stay unsigned, income takes a `+` prefix in `text-success`.
- **Do** write copy in the established voice — matter-of-fact, past-tense confirmations ("Captured.", "Saved."), periods not exclamation marks (at most one exclamation per page, reserved for genuine celebration).
- **Do** gate every page-level or repeating animation on `useReducedMotion`.
- **Do** reuse the shared component owner for a visual role (buttons, badges, cards, chips) rather than composing new classes on a one-off element.

### Don't:
- **Don't** invent a new button, pill, field, or card variant by restyling an existing component's classes — extend the shared owner or get approval for a new primitive first.
- **Don't** use `text-accent` for destructive intent, or hover a destructive icon back to muted — it must stay `text-destructive` throughout its interactive states.
- **Don't** show more than one warm-glow and one teal-glow surface on screen at once.
- **Don't** use exclamation marks, greetings, or "Successfully X'd" phrasing anywhere in product copy.
- **Don't** stack toasts — a new toast always replaces the current one, never queues behind it.
- **Don't** introduce text color dimmer than `muted` (`#A8A1B5` dark / `#625C70` light), and never drop muted body copy below 12px.
