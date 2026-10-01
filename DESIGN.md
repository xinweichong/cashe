---
name: cashe
description: cash, caught — a self-hosted money app with Apple-native structure and one spectrum card per screen
colors:
  teal: "#00D4AA"
  mint: "#34D399"
  honey: "#FBBF24"
  tangerine: "#FB923C"
  coral: "#FF6B6B"
  background: "#0B0B14"
  card: "#161624"
  card-elev: "#1B1B2C"
  foreground: "#EEEAF5"
  muted: "#A8A1B5"
  destructive: "#FF453A"
  on-brand: "#0B0B14"
  on-teal: "#0B0B14"
  separator: "color-mix(in srgb, #EEEAF5 10%, transparent)"
  fill-press: "color-mix(in srgb, #EEEAF5 8%, transparent)"
  fill-hover: "color-mix(in srgb, #EEEAF5 5%, transparent)"
  chrome: "color-mix(in srgb, #161624 66%, transparent)"
  success: "{colors.teal}"
  warning: "{colors.honey}"
  info: "{colors.mint}"
  background-light: "#F6F5F8"
  card-light: "#FFFFFF"
  foreground-light: "#201C2C"
  muted-light: "#625C70"
  teal-light: "#007A63"
  on-teal-light: "#FFFFFF"
  chrome-light: "color-mix(in srgb, #FFFFFF 72%, transparent)"
typography:
  large-title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  money:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  control: "10px"
  inset: "12px"
  group: "18px"
  hero: "22px"
  capsule: "26px"
  pill: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
  row-touch: "44px"
  row-pointer: "36px"
components:
  list-group:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.group}"
  list-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    padding: "8px 12px"
    height: "44px"
  list-row-selected:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.inset}"
  spectrum-card:
    backgroundColor: "linear-gradient(135deg, #00D4AA 0%, #34D399 25%, #FBBF24 50%, #FB923C 75%, #FF6B6B 100%)"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.hero}"
    padding: "14px 16px"
  input-field:
    backgroundColor: "{colors.fill-press}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  button-primary:
    backgroundColor: "linear-gradient(135deg, #00D4AA 0%, #34D399 25%, #FBBF24 50%, #FB923C 75%, #FF6B6B 100%)"
    textColor: "{colors.on-brand}"
    rounded: "6px"
    padding: "0 16px"
    height: "40px"
  toolbar-action:
    backgroundColor: "transparent"
    textColor: "{colors.teal}"
    typography: "{typography.body}"
    rounded: "8px"
    height: "44px"
  tab-bar:
    backgroundColor: "{colors.chrome}"
    rounded: "{rounded.capsule}"
    padding: "6px"
---

# Design System: cashe

## Overview

**Creative North Star: "The Spectrum Wallet"**

Calm, native and exact: an iOS-feeling money app where grouped lists carry the facts and colour is rationed to one spectrum card and the data itself. cashe borrows the structure and behaviour of Apple's Human Interface Guidelines: large titles, grouped inset lists, a frosted tab bar and sidebar, details that push on a phone and sit beside the list on larger screens, task sheets, swipe actions and context menus. It does not borrow Apple's look. The brand is the five-stop cool-to-warm spectrum, and it appears in two places: once per screen as a Wallet-style card at the top of a tab, and wherever data needs meaning (category colours, chart marks, status dots).

Anti-references: dashboard-template glow cards, mono "terminal" eyebrow labels above headings, stoplight red/yellow/green status, and every block styled as a card.

**Key Characteristics:**
- One spectrum card per screen, only at the top of Home (month spending against budget), Plan (the month's projection) and Explore (health score).
- Grouped lists: square rows with inset hairlines inside an 18px group; on iPad and desktop the selected row is a 12px teal inset pill.
- Frosted chrome (tab bar capsule, sidebar, collapsed nav bar, toolbar) over a faint radial wash, falling back to solid when blur is unavailable or reduced transparency is requested.
- Plus Jakarta Sans names things, Inter says everything else, JetBrains Mono is for money only.
- A pressed state on everything tappable; rows are 44pt with touch and 36pt with a mouse.

## Colors

The theme follows the device. Dark sits on deep ink (`#0B0B14`), not pure black; light is a soft grey ground with white groups. Both are polished equally.

### Primary
- **Teal** (`#00D4AA`, light `#007A63`): the only accent for interactive things: text actions, the selected row and sidebar item, focus rings, links. Text on a teal fill uses on-teal (`#0B0B14` dark, `#FFFFFF` light).

### Secondary — The Cashe Spectrum
- **Mint** (`#34D399`), **Honey** (`#FBBF24`), **Tangerine** (`#FB923C`), **Coral** (`#FF6B6B`): with teal, the five stops of the spectrum. Position encodes meaning: cool is saved/on track, warm is where the money goes. Used as the spectrum card's fill, category colours and chart marks, never as a page or chrome colour.

### Neutral
- **Background**, **Card**, **Card Elevated**: page ground, group surface, sheets and menus.
- **Separator** (foreground 10%): hairlines between rows, drawn from the text start.
- **Fill Press / Fill Hover** (foreground 8% / 5%): the pressed and pointer-hover states, and the filled field background.
- **Chrome** (card 66%, white 72% in light): frosted bars, always paired with a 20px blur and a solid fallback.
- **Muted** (`#A8A1B5`, light `#625C70`): secondary text; holds 4.5:1 on every surface. Never go dimmer.
- **Destructive** (`#FF453A`): delete and stop only.

### Named Rules
**The One Spectrum Card Rule.** At most one spectrum card on a screen, and only at the top of a tab root. Detail pages, Activity, Settings, Review and Admin have none.

**The Spectrum-Not-Stoplight Rule.** Status is a position on the teal-to-coral spectrum, never a red/yellow/green binary.

## Typography

**Display Font:** Plus Jakarta Sans (700, 800)
**Body Font:** Inter (400–600)
**Money Font:** JetBrains Mono (500)

Plus Jakarta names things: the large title, group headings above lists, and hero numbers. Inter carries rows, body, controls and the inline nav or sheet title. JetBrains Mono appears only for money amounts, with tabular figures. Every size is in rem, so the in-app text size and browser zoom scale the whole page; at 200% list rows stack (title, then detail, then amount). Tab bar labels stay a fixed 11px, as on iOS.

### Hierarchy
- **Large title** (Plus Jakarta 800, 2rem): the tab root's title, collapsing into the frosted bar on scroll.
- **Group heading** (Plus Jakarta 700, 1.125–1.25rem, title case): above each grouped list.
- **Headline** (Inter 600, 1.0625rem): inline nav bar, toolbar and sheet titles.
- **Body** (Inter 400–500, 0.875rem): rows and paragraphs.
- **Caption** (Inter 400, 0.75rem, muted): row subtitles and group footers.
- **Money** (JetBrains Mono 500): amounts in rows and details; hero numbers use Plus Jakarta 800.

### Named Rules
**The No-Eyebrow Rule.** No mono uppercase kicker above a heading. The heading carries its own weight.

## Layout

Every page scrolls naturally under a `NavBar`, with content in a 16px gutter that shares an edge with the large title. A phone has a floating frosted tab bar (pages pad 80px to clear it). iPad and desktop have a frosted inset sidebar: an icon rail at `md`, expanded at `lg`, toggled with ⌘⌥S, holding Review and Settings under "You".

Lists with details use `ListDetail`: on a phone the detail is pushed over the still-mounted list (Back, browser Back, or an edge swipe in the home-screen app); on md+ it is a split view (a 22–24rem list column beside the detail: Activity, Merchants, Admin) or an inspector (the page stays full width and the detail opens as a 26rem column: Plan). The detail stays mounted across breakpoints. md+ lists follow Mac conventions: ↑/↓, ⌫ to delete with confirmation, Esc to close, ⌘F to search.

## Elevation & Depth

Content is flat: groups are filled surfaces with no border and no shadow. Depth comes from material and real offset shadows only where something floats: the tab bar capsule (`0 10px 30px -10px`), sheets, a row lifted by its context menu, dialogs and menus. Glow halos are retired.

### Named Rules
**The Material-Has-A-Reason Rule.** Frosted blur is used only where content scrolls beneath it (bars, sidebar), never as decoration.

## Shapes

Radii are tied to roles and stay in px (they do not scale with text): fields 10px, the selected inset pill 12px, groups 18px, the spectrum card and sheet tops 22px, the tab bar capsule 26px, badges and progress bars as pills. Rows inside a group are square; only the group's outer corners round. Category avatars are circles.

## Components

- **ListGroup / ListRow**: the grouped list and its rows (navigation, value, toggle, transaction, selected, disabled, destructive); rows stack at narrow container widths.
- **SpectrumCard**: label, meta, value, caption and an optional labelled progress bar; complete, partial (dashed bar) and estimated (no bar) states.
- **NavBar / Toolbar / ToolbarAction**: large-title and pushed-page bars; the pinned detail toolbar with teal text actions (strong for confirm, red for delete, a pending label while saving).
- **TaskSheet**: medium and large heights on a phone, a centred dialog on md+, Cancel / title / confirm in the header, and a discard prompt for unsaved input.
- **SwipeRow / RowMenu**: swipe actions (touch only) and the long-press or right-click menu; every action is also reachable from the detail page.
- **Segmented control**: Tabs and SegmentedChoice share one recessed track with a sliding raised thumb.
- **Fields**: filled 44pt fields with a 10px radius; the border appears only for an error.

**Component feel: native and quiet.** Teal text actions instead of outlined buttons in bars, filled fields instead of bordered boxes, square rows inside rounded groups. The gradient primary button is reserved for the single main command of a form.

## Do's and Don'ts

### Do:
- **Do** compose `ListGroup`/`ListRow`, `PageCard`, `NavBar`, `Toolbar`, `TaskSheet` and `ListDetail` for new screens.
- **Do** keep one spectrum card per screen, at the top of a tab root only.
- **Do** route every amount through the shared money formatter and set it in JetBrains Mono.
- **Do** give every tappable surface the `pressable` state and a 44pt touch target.
- **Do** verify new screens at 200% text, under Reduce Motion, and in both themes.

### Don't:
- **Don't** add glow shadows, gradient text, or a second spectrum card.
- **Don't** put a mono uppercase eyebrow above a heading.
- **Don't** use a bordered card where a grouped list fits, or nest cards.
- **Don't** make a swipe the only way to reach an action.
- **Don't** use blur where nothing scrolls beneath it.
