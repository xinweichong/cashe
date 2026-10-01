import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// Approved shared owner (P3, HIG alignment 2026-10-01): the navigation bar.
// A tab root shows a large title under a clear bar; once the large title
// scrolls under the bar, the bar turns frosted and shows the title inline.
// A pushed page shows an inline title and a back button labelled with its
// parent. The large title is the page's h1; the inline copy is aria-hidden
// so the heading is announced once.

interface NavBarProps {
  title: ReactNode;
  /** Tab roots only. */
  large?: boolean;
  /** Pushed pages: where back returns to. */
  back?: { label: string; to?: string; onClick?: () => void };
  trailing?: ReactNode;
  className?: string;
}

const BAR_HEIGHT = 44;

export function NavBar({ title, large = false, back, trailing, className }: NavBarProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(!large);

  useEffect(() => {
    const el = titleRef.current;
    if (!large || !el || typeof IntersectionObserver === 'undefined') return;
    // Collapsed once the large title has fully passed under the bar.
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: `-${BAR_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [large]);

  const backContent = back && (
    <>
      <ChevronLeft aria-hidden className="h-5 w-5 -ml-1" />
      <span className="truncate">{back.label}</span>
    </>
  );
  const backClass = 'pressable inline-flex min-h-11 max-w-full items-center gap-0.5 rounded-[8px] pr-2 text-base text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <>
      <header
        data-collapsed={collapsed || undefined}
        className={cn(
          'sticky top-0 z-30 grid h-11 grid-cols-[1fr_auto_1fr] items-center px-2 transition-[background-color,border-color] duration-[var(--dur-fast)]',
          'border-b-[0.5px] border-transparent data-[collapsed]:chrome-frosted data-[collapsed]:border-separator',
          className,
        )}
      >
        <div className="flex min-w-0 items-center">
          {back && (back.to
            ? <Link to={back.to} className={backClass}>{backContent}</Link>
            : <button type="button" onClick={back.onClick} className={backClass}>{backContent}</button>)}
        </div>
        {large
          ? <span aria-hidden className={cn('truncate text-headline font-semibold transition-opacity duration-[var(--dur-fast)]', collapsed ? 'opacity-100' : 'opacity-0')}>{title}</span>
          : <h1 className="truncate text-headline font-semibold">{title}</h1>}
        <div className="flex min-w-0 items-center justify-end gap-1">{trailing}</div>
      </header>
      {large && (
        <h1 ref={titleRef} className="px-4 pb-2 font-display text-large-title font-extrabold tracking-[-0.02em] text-balance">
          {title}
        </h1>
      )}
    </>
  );
}
