import { Link } from 'react-router-dom';
import { PRINCIPLES, QUESTIONS } from '../content';
import { BouncyAccordion } from '../vendor/beui/BouncyAccordion';

export function Private() {
  return (
    <section aria-labelledby="private-title" className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-28">
        <h2 id="private-title" className="max-w-[16ch] font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-[2.75rem]">
          Private by design.
        </h2>
        <dl className="mt-12 grid gap-x-12 md:grid-cols-2">
          {PRINCIPLES.map(p => (
            <div key={p.title} className="border-t border-border py-6">
              <dt className="font-display text-xl font-bold tracking-tight">{p.title}</dt>
              <dd className="mt-2 max-w-[48ch] text-base text-muted">{p.body}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-14 grid gap-8 md:grid-cols-12">
          <h3 className="font-display text-2xl font-bold tracking-tight md:col-span-4">Questions</h3>
          <div className="md:col-span-8">
            <BouncyAccordion items={QUESTIONS} className="divide-y divide-separator rounded-group shadow-elev-md" />
            <p className="mt-6 text-base text-muted">
              Everything stored, and why, is in the{' '}
              <Link className="font-medium text-teal underline decoration-teal/40 underline-offset-4 hover:decoration-teal" to="/privacy">privacy policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
