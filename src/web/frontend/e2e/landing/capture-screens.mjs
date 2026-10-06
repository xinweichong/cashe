// Captures the app screens shown in the landing page's product tour, from
// the showcase server's invented data (scripts/showcase_server.py):
//   npm run build && python3 -m scripts.showcase_server --port 8766 &
//   node e2e/landing/capture-screens.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:8766';
const OUT = new URL('../../src/landing/screens/', import.meta.url).pathname;
const SCREENS = [['home', '/'], ['activity', '/activity'], ['plan', '/plan'], ['explore', '/explore']];

const browser = await chromium.launch();
// Chromium's canvas encodes WebP, so no image library is needed.
const encoder = await browser.newPage();
const toWebp = async (png) => Buffer.from((await encoder.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/webp', 0.8);
}, png.toString('base64'))).split(',')[1], 'base64');
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.request.post(`${BASE}/api/login`, { data: { username: 'journey', password: 'journey-password' } });
  for (const [name, path] of SCREENS) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    // Early in a month the health score is still "too early", so show the Over time chart.
    if (name === 'explore') await page.getByRole('button', { name: /Over time/ }).click();
    await page.waitForTimeout(600);
    writeFileSync(`${OUT}${name}-${theme}.webp`, await toWebp(await page.screenshot()));
  }
  await context.close();
}
await browser.close();
