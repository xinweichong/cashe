import { test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { mockAuthenticatedActivity, mockAuthenticatedExplore, mockAuthenticatedHome, mockAuthenticatedPlan } from '../fixtures/mocks';

// Cold-load cost per route on the production bundle, under 4x CPU throttling
// (a rough mid-range-phone proxy). Each route runs RUNS times in a fresh
// context with the HTTP cache cold; medians are written to
// e2e/perf/results.json. Mocked API responses return immediately, so these
// numbers are frontend cost only — not end-to-end latency.

const RUNS = 5;
const CPU_THROTTLE = 4;

type Sample = { ready: number; lcp: number; tbt: number; jsKB: number };

const ROUTES: { name: string; path: string; mock: (p: Page) => Promise<void>; ready: (p: Page) => Promise<unknown> }[] = [
  { name: 'home', path: '/', mock: mockAuthenticatedHome, ready: (p) => p.getByText(/^Through /).waitFor() },
  { name: 'activity', path: '/activity', mock: mockAuthenticatedActivity, ready: (p) => p.locator('#tx-row-1').waitFor() },
  { name: 'explore', path: '/explore', mock: mockAuthenticatedExplore, ready: (p) => p.locator('.recharts-line').first().waitFor() },
  { name: 'plan', path: '/plan', mock: mockAuthenticatedPlan, ready: (p) => p.getByText('Upcoming timeline').waitFor() },
];

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function measure(page: Page, path: string, ready: (p: Page) => Promise<unknown>): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: number; __longTasks: number[] };
    w.__lcp = 0;
    w.__longTasks = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__longTasks.push(e.duration); })
      .observe({ type: 'longtask', buffered: true });
  });
  const start = Date.now();
  await page.goto(path, { waitUntil: 'commit' });
  await ready(page);
  const readyMs = Date.now() - start;
  await page.waitForTimeout(500); // let LCP settle after content is ready
  return page.evaluate((ready) => {
    const w = window as unknown as { __lcp: number; __longTasks: number[] };
    const tbt = w.__longTasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0);
    const js = performance.getEntriesByType('resource')
      .filter((e) => (e as PerformanceResourceTiming).initiatorType === 'script' || e.name.endsWith('.js'))
      .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || (e as PerformanceResourceTiming).encodedBodySize || 0), 0);
    return { ready, lcp: Math.round(w.__lcp), tbt: Math.round(tbt), jsKB: Math.round(js / 1024) };
  }, readyMs);
}

test('cold route load medians (production bundle, 4x CPU throttle, mocked API)', async ({ browser }) => {
  const results: Record<string, Sample & { runs: number }> = {};
  for (const route of ROUTES) {
    const samples: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await route.mock(page);
      samples.push(await measure(page, route.path, route.ready));
      await context.close();
    }
    results[route.name] = {
      runs: RUNS,
      ready: median(samples.map((s) => s.ready)),
      lcp: median(samples.map((s) => s.lcp)),
      tbt: median(samples.map((s) => s.tbt)),
      jsKB: median(samples.map((s) => s.jsKB)),
    };
  }
  mkdirSync('e2e/perf', { recursive: true });
  writeFileSync('e2e/perf/results.json', JSON.stringify({ cpuThrottle: CPU_THROTTLE, viewport: '390x844', results }, null, 2));
  console.table(results);
});
