# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are the operator (self-hoster) and a small circle of trusted people — partner, family, or friends — each running their own account on the operator's self-hosted instance. Every user's transactions are automatically captured from their own bank emails (DBS PayLah!, UOB PayNow, UOB Card) and Apple Wallet taps, so no one has to manually log spending. Multi-user support exists in the data model (per-user expense DBs + shared admin DB) but the audience stays small and personally known to the operator, not the general public.

## Product Purpose

cashe removes the friction that stops most people from tracking spending: it captures every transaction automatically instead of requiring manual entry. Beyond capture, it gives a complete financial picture — budgets, savings goals, financial health score, merchant intelligence, recurring-charge detection, and trip tracking — delivered through a Telegram bot (real-time alerts, guided commands, daily digest) and a React web dashboard (Overview, Transactions, Analytics, Finance, Merchants, Settings). Success means a user never has to open an app to log a transaction, yet always has an accurate, current view of their money.

## Positioning

"Cashe = cash + cache": cash you've spent, caught by the cache, silently and automatically. The mechanism a competitor can't truthfully copy: fully automatic capture from Gmail bank-alert parsing and Apple Wallet push, deduplicated across sources via `source_id`, landing in a database the user fully owns (self-hosted SQLite, no cloud vendor, no subscription, no telemetry). Most personal-finance apps require manual logging or hand data to a third-party cloud; cashe does neither.

## Operating Context

- Self-hosted by the operator on an Oracle Cloud Always Free ARM VM, exposed via Cloudflare Tunnel (no open inbound ports).
- Ingestion runs continuously and unattended: Gmail polling for DBS/UOB transaction emails, and an iOS Shortcut firing on every Apple Wallet tap to a webhook.
- Users interact primarily through the Telegram bot for real-time, low-friction moments (categorising a transaction, checking balance, guided edit/delete) and the React web dashboard for deeper review (analytics, budgets, goals, merchants, settings).
- Multi-currency transactions are common and are auto-converted to SGD via cached exchange rates with offline fallback.

## Capabilities and Constraints

- Single Python monolith process; FastAPI for webhooks and dashboard API; SQLite in WAL mode; React SPA (Vite) served from `dist/`, full PWA support.
- Multi-user: per-user expense databases plus a shared admin database.
- Auto-categorisation via keyword matching with learned, hot-reloading merchant overrides.
- Optional LLM layer (Gemini Flash) for anomaly explanations, natural-language Telegram entry, and daily AI insights — disabled entirely when no API key is configured; the product must degrade cleanly without it.
- No subscription, no third-party data sharing, no telemetry — this is a binding product constraint, not just current behavior.

## Brand Commitments

- Name is always lowercase: **cashe**. Portmanteau of cash + cache ("the cash you've spent, caught by the cache").
- Brand hook: **cash, caught.** Longer variant for marketing/hero copy: **every dollar seen, every dollar saved.**
- Wordmark **ca$he** (Plus Jakarta Sans ExtraBold, "$" in warm gradient replacing the "s") is the primary brand expression — used wherever space allows (sidebar, headers, footers, splash, README, marketing). Full spec lives in `docs/design-language.md`, which is authoritative for visual/brand-asset detail.
- Icon uses the "B1 spectrum-wash" background (teal → near-ink → orange/red diagonal gradient); adaptive foreground rules by context (wordmark vs. "$" glyph only) are documented in `docs/design-language.md`.

## Evidence on Hand

- `README.md` — full feature set, architecture diagram, quick-start.
- `AGENTS.md` — engineering/architecture context and agent working conventions.
- `docs/design-language.md` — standalone source of truth for brand and visual tokens (existing DESIGN.md-equivalent; not yet recorded under that filename).
- `CHANGELOG.md` — version history (currently 2.1.0).
- No fabricated testimonials, pricing, or customer claims exist or should be introduced; this is not a marketed product with external customers.

## Product Principles

1. Zero manual logging — every design and feature decision should preserve or deepen automatic capture, never reintroduce manual entry as the default path.
2. Ownership over convenience — data stays on the operator's own server; no design or integration choice should require routing user data through a third party.
3. Small, trusted audience — build for a handful of known users (operator + trusted people), not for public-scale onboarding, growth loops, or anonymous sign-up.
4. Two front doors, one truth — Telegram (fast, ambient) and the web dashboard (deep, visual) must stay consistent in the facts they show, even as their interaction styles differ.
5. Graceful degradation — optional intelligence (LLM layer, exchange rates, recurring detection) should fail quietly and safely, never blocking core capture or logging.
