import { Link } from 'react-router-dom';
import { ArrowDown, Eye, Lock, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CasheWordmark } from '@/components/ui/Brand';
import { BackgroundPaths } from './kokonut/BackgroundPaths';
import { DynamicText } from './kokonut/DynamicText';
import { ProductTour } from './ProductTour';

// Public landing page: what signed-out visitors see at `/` (approved
// 2026-10-06 as a separate marketing surface; nothing in src/landing may be
// imported by the app, see eslint.config.js). Sign in goes to /login.
export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Opaque rather than frosted: a backdrop blur re-renders whatever scrolls
          under it on every frame, which a 120Hz screen shows as judder. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 md:px-8">
          <Link to="/"><CasheWordmark size={22} /></Link>
          <Button asChild size="sm"><Link to="/login">Sign In</Link></Button>
        </div>
      </header>
      <main>
        <Hero />
        <ProductTour />
        <Privacy />
        <Closing />
      </main>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted md:px-8">
          <span>cashe · a privacy-first spending tracker</span>
          <nav aria-label="Legal" className="flex gap-4">
            <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/privacy">Privacy</Link>
            <Link className="inline-flex min-h-11 items-center hover:text-foreground" to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const SOURCES = ['DBS PayLah!', 'UOB alerts', 'Apple Pay', 'Telegram', 'everywhere you pay'];

function Hero() {
  return (
    <section className="relative isolate flex min-h-[calc(100svh-3.5rem)] items-center overflow-hidden">
      <BackgroundPaths />
      {/* Keeps the lines out from under the words. */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_50%,var(--color-background)_35%,transparent_100%)]" />
      {/* No entrance fade: the headline is the largest paint, and the lines already move. */}
      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-7xl">
          Your spending,<br />written down for you.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted md:text-lg">
          cashe captures purchases as they happen, sorts them, and shows where every number came from.
        </p>
        <p className="mt-6 font-display text-lg font-bold md:text-2xl">
          Captured from{' '}
          <span className="text-teal"><DynamicText words={SOURCES} label="DBS PayLah!, UOB alerts, Apple Pay and Telegram" /></span>
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg"><Link to="/login">Sign In</Link></Button>
          <Button asChild size="lg" variant="outline"><a href="#tour">See How It Works <ArrowDown /></a></Button>
        </div>
        <p className="mt-4 text-xs text-muted">Accounts are by invitation.</p>
      </div>
    </section>
  );
}

const PRINCIPLES = [
  { icon: Lock, title: 'Self-hosted', body: 'cashe runs on its own server. Each person gets a separate database. No advertising, and data is never sold.' },
  { icon: Mail, title: 'Gmail, carefully', body: 'It reads only alerts from the bank senders it is set up for, and never changes your inbox.' },
  { icon: Eye, title: 'Shows its working', body: 'Every total links to the transactions behind it. Anything uncertain is labelled, not hidden.' },
  { icon: Sparkles, title: 'AI is optional', body: 'Plain-language Telegram entries and daily reads stay off unless the server owner turns them on.' },
];

function Privacy() {
  return (
    <section aria-labelledby="privacy-title" className="mx-auto max-w-5xl px-4 py-20 md:px-8 md:py-28">
      <h2 id="privacy-title" className="font-display text-2xl font-extrabold tracking-tight md:text-4xl">Private by design</h2>
      <p className="mt-3 max-w-prose text-muted md:text-lg">Money data is personal. cashe is built so it stays yours.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {PRINCIPLES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-group bg-card p-5 shadow-elev-md">
            <Icon aria-hidden className="h-5 w-5 text-teal" />
            <h3 className="mt-3 font-display text-lg font-bold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        Read the <Link className="text-teal underline" to="/privacy">privacy policy</Link> and <Link className="text-teal underline" to="/terms">terms</Link>.
      </p>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-4 pb-20 md:px-8 md:pb-28">
      <div className="spectrum-fill mx-auto max-w-5xl rounded-hero px-6 py-12 text-center md:py-16">
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-5xl">Stop typing in receipts.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm font-medium opacity-85 md:text-base">Sign in to see this month, already written down.</p>
        <Button asChild size="lg" variant="outline" className="mt-6 border-on-brand/40 bg-transparent text-on-brand hover:bg-on-brand/10">
          <Link to="/login">Sign In</Link>
        </Button>
      </div>
    </section>
  );
}
