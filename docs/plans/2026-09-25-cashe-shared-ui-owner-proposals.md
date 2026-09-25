# Shared UI owner proposals (approval required)

Status: proposals only. Nothing here is implemented. Each item needs explicit approval under AGENTS.md's gate before code is written. The IDs refer to the [production-polish surface audit](2026-09-17-cashe-production-experience-polish.md). Every proposal reuses existing tokens, spacing, radii and motion; none adds a colour, font or animation system.

Checked for every owner: rest, hover, focus-visible (the §15 teal ring), selected, disabled, pending where relevant, light and dark themes, a 44px effective touch target, and reduced motion (no transition beyond `--dur-fast`). Each migration keeps the consumer's data, events and URL behaviour unchanged. The `uiInventory` test's native-button allowlist shrinks as each consumer migrates.

## P1 — `ChoiceChip` (U04)

**Why composition is insufficient:** `Button` is a command, `Badge` is read-only, and `Tabs` switch panels. Filters and choices need a pressed/selected state with category identity. Four families currently re-implement this: Activity filters (mono uppercase, inline hex styles), TransactionDetail's quick category picker, Explore's category pills and Merchant tag toggles (`Badge` wrapped in `<button>`).

**API:** `<ChoiceChip selected onSelectedChange={fn} tone?="neutral" | "warning" categoryColor?={hex} disabled>{label}</ChoiceChip>`. It renders a native `<button type="button" aria-pressed>`. For single-choice groups, callers wrap chips in `role="radiogroup"` and the chip takes `role="radio"` and `aria-checked` through a `mode="radio"` prop.

**Look:** Activity's pill, which is the audit's reference, with readable sentence-case 12px text instead of 9–10px mono caps. `rounded-pill`, `px-3`, `min-h-9` visible height with a 44px hit area. Neutral colours use `foreground` on `card-hover` when selected and `muted`/`border` at rest. Category colour mixes through the tokens (`color-mix` at 13% fill and 25% border), not hex suffixes.

**Consumers:** TransactionFilters (6), TransactionDetail QuickCategoryPicker, ExplorePatternsPage category choice, MerchantProfile and MerchantsPage tags. It never mutates on select without the consumer's existing confirmation or pending behaviour.

## P2 — `SegmentedChoice` (U06)

**Why:** TransactionForm's Expense/Income control is a form value, not a panel switch (`Tabs`) and not a command (`Button`). It currently overrides ghost Buttons into a filled segment.

**API:** `<SegmentedChoice name value onValueChange options={[{value,label}]} aria-label />`. It renders native radio inputs styled as segments, which keeps form semantics and arrow-key behaviour.

**Look:** the `TabsList` container recipe (card-hover track, `rounded-sm`), with the selected segment using the same teal 13%/25% active treatment as `TabsTrigger` so there is one selection language.

**Consumers:** the TransactionForm type field. It may also cover Overview's classic day/week/month period chips if you want that included.

## P3 — `Switch` (U07)

**Why:** Settings feature toggles and Finance's trip auto-assign toggle duplicate a 40×20 track and thumb plus `.toggle-on`. Finance lacks `role="switch"` and `aria-checked`.

**API:** `<Switch checked onCheckedChange aria-label disabled pending />`. It renders `button role="switch" aria-checked` inside a 44px hit area; `pending` shows the existing disabled opacity and blocks repeat toggles.

**Look:** the current Settings switch, unchanged: the spectrum `.toggle-on` fill when on, `foreground/20` when off, a white thumb and a `--dur-fast` translate. `.toggle-on` moves into the owner.

**Consumers:** SettingsPage (6 toggles) and FinancePage TripRow.

## P4 — `StatusDot` plus a `CategoryAvatar` detail size (U09)

**Why:** design-language §7.4 documents a 6px status dot that does not exist, so legends and markers use ad-hoc 6, 8 and 10px dots. TransactionDetail draws its own 40px category tile.

**API:** `<StatusDot tone?={BadgeTone} color?={categoryHex} label? />` is a 6px dot with an optional readable label. It is decorative when a label is present and `aria-hidden` otherwise. `CategoryAvatar` gains `size="detail"` (40px, same glyph rules).

**Consumers:** the Home and Explore selected-category dots, the Plan composition legend, the SubscriptionsSection status and the TransactionDetail header. Chart marks and calendar occupancy dots stay as they are.

## P5 — `SelectableRow` (U13)

**Why:** CategoryDonut legend rows, SubscriptionsSection schedule rows and TransactionDetail's purchase-candidate rows share one pattern: a full-width `<button>` row with a selected tint. `CategoryChangeBarRow` already owns its own chart row and stays.

**API:** `<SelectableRow selected onSelect leading? trailing?>{content}</SelectableRow>`. It is a `button` with `aria-pressed` and never contains nested interactive children.

**Look:** the `ActivityRowShell` hover and selected tint (`foreground/5` at rest on hover, `foreground/10` when selected), `rounded-md`, `px-3 py-2.5`.

**Consumers:** the CategoryDonut legend (parent and member rows), SubscriptionsSection rows and TransactionDetail candidates. Merchant tables keep table semantics.

## P6 — `ProgressBar` (U18)

**Why:** Finance's budget and goal bars, Overview's budget and goal tracks and Analytics' goal progress repeat a track and fill with different heights and colours.

**API:** `<ProgressBar value max label tone?="auto"|BadgeTone />`. It renders `role="progressbar"` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. It supports overflow above 100% (the fill caps visually and the label states the overage).

**Look:** a 6px track on `foreground/10` with `rounded-pill` and the fill in the Badge tone colour.

**Consumers:** budget and goal progress only. ProgressRing, Plan's forecast composition strip and MerchantTable ranking bars are different data and stay separate.

## P7 — `CategoryPicker` icon and colour (U19)

**Why:** Settings duplicates the icon grid and colour swatches in its create and edit dialogs. The selected colour uses a white border, which is invisible in light theme.

**API:** `<CategoryIconPicker value onChange />` and `<CategoryColorPicker value onChange taken={string[]} />`, both `role="radiogroup"` with a 44px hit area per option. Taken colours stay non-interactive, with a text explanation.

**Look:** the selected state uses the §15 ring colour instead of white, so it works in both themes. Otherwise it keeps the existing sizes.

**Consumers:** SettingsPage create and edit category.

Plan's calendar and week-strip cells keep one shared in-file recipe and do not get a new public DateButton primitive.
