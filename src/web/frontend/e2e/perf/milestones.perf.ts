import { test } from '@playwright/test';
import { mockAuthenticatedPlan } from '../fixtures/mocks';

// Diagnostic: in-page timestamps for boot milestones on a cold Plan load.
test('boot milestones (plan, 4x throttle)', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await mockAuthenticatedPlan(page);
  const apiTimes: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiTimes.push(`${r.url().split('/api/')[1]}`); });
  await page.addInitScript(() => {
    const marks: Record<string, number> = {};
    (window as unknown as { __marks: Record<string, number> }).__marks = marks;
    const check = () => {
      const t = performance.now();
      if (!marks.splash && document.body?.innerText.includes('Catching up')) marks.splash = t;
      if (!marks.shell && document.querySelector('nav')) marks.shell = t;
      if (!marks.heading && document.body?.innerText.includes("See what's coming")) marks.heading = t;
      if (!marks.agenda && document.body?.innerText.includes('Upcoming timeline')) marks.agenda = t;
      if (!marks.agenda) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.goto('/plan');
  await page.getByText('Upcoming timeline').waitFor();
  const marks = await page.evaluate(() => (window as unknown as { __marks: Record<string, number> }).__marks);
  const api = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/api/') || e.name.endsWith('.js'))
    .map((e) => `${e.name.includes('/api/') ? e.name.split('/api/')[1] : e.name.split('/').pop()} start@${Math.round(e.startTime)} end@${Math.round(e.responseEnd)}`));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v)]))));
  console.log(api.join('\n'));
});
