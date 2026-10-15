import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CasheWordmark } from '@/components/ui/Brand';
import { TAGLINE } from './content';
import { Capture } from './sections/Capture';
import { Evidence } from './sections/Evidence';
import { Hero } from './sections/Hero';
import { Private } from './sections/Private';
import { Setup } from './sections/Setup';
import { Tour } from './sections/Tour';
import { TourLink } from './sections/TourLink';

// Public landing page: what signed-out visitors see at `/` (approved
// 2026-10-06 as a separate marketing surface; nothing in src/landing may be
// imported by the app, see eslint.config.js). Sign in goes to /login.
// The tour (option C, scroll chapters) and the Oh My Days-style first screen
// were approved 2026-10-15.
export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only z-50 rounded-lg bg-teal px-4 py-3 font-semibold text-on-teal focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      {/* Opaque rather than frosted: a backdrop blur re-renders whatever scrolls
          under it on every frame, which a 120Hz screen shows as judder. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <Link to="/" className="-m-2 p-2" aria-label="cashe, home"><CasheWordmark size={22} /></Link>
          <nav aria-label="Main" className="flex items-center gap-2 sm:gap-6">
            <TourLink className="hidden min-h-11 items-center text-sm text-muted hover:text-foreground sm:inline-flex">How it works</TourLink>
            <Link to="/privacy" className="hidden min-h-11 items-center text-sm text-muted hover:text-foreground sm:inline-flex">Privacy</Link>
            <Button asChild size="sm"><Link to="/login">Sign In</Link></Button>
          </nav>
        </div>
      </header>
      <main id="main">
        <Hero />
        <Tour />
        <Capture />
        <Evidence />
        <Setup />
        <Private />
        <Closing />
      </main>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted md:px-8">
          <span>cashe · {TAGLINE} A privacy-first spending tracker.</span>
          <nav aria-label="Legal" className="flex gap-4">
            <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/privacy">Privacy</Link>
            <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Closing() {
  return (
    <section className="px-4 pb-20 pt-4 md:px-8 md:pb-28">
      <div className="spectrum-fill mx-auto max-w-6xl rounded-hero px-6 py-12 text-center md:py-16">
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-5xl">Stop typing in receipts.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm font-medium opacity-85 md:text-base">Sign in to see this month, already written down.</p>
        <Button asChild size="lg" variant="outline" className="mt-6 border-on-brand/40 bg-transparent text-on-brand hover:bg-on-brand/10">
          <Link to="/login">Sign In</Link>
        </Button>
      </div>
    </section>
  );
}
