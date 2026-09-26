import { test } from '@playwright/test';
import { mockAuthenticatedActivity, mockAuthenticatedPlan } from '../fixtures/mocks';

// Diagnostic: which script chunks each route pulls on a cold load.
for (const [name, path, mock, ready] of [
  ['plan', '/plan', mockAuthenticatedPlan, 'Upcoming timeline'],
  ['activity', '/activity', mockAuthenticatedActivity, 'NUS The Deck'],
] as const) {
  test(`chunks loaded for ${name}`, async ({ page }) => {
    await mock(page);
    await page.goto(path);
    await page.getByText(ready).first().waitFor();
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((e) => e.name.endsWith('.js'))
      .map((e) => `${e.name.split('/').pop()} ${Math.round((e as PerformanceResourceTiming).transferSize / 1024)}KB @${Math.round(e.startTime)}ms`));
    const paint = await page.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return { fcp: Math.round(fcp ?? -1), dcl: Math.round(nav.domContentLoadedEventEnd) };
    });
    console.log(name, JSON.stringify(paint), '\n  ' + scripts.join('\n  '));
  });
}
