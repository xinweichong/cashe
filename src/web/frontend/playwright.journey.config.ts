import { defineConfig, devices } from '@playwright/test';

// Authenticated journeys against the real dashboard API and production
// bundle, on an isolated throwaway database with synthetic data
// (scripts/journey_server.py). No mocks, no config.yaml, no bot or poller.
// Build first (`npm run build`) so src/web/dist is current.
// Run: npm run test:journey
export default defineConfig({
  testDir: './e2e/journey',
  testMatch: '**/*.journey.ts',
  outputDir: './e2e/.output-journey',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:8765', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'cd ../../.. && python3 -m scripts.journey_server --port 8765 --data-dir /tmp/cashe-journey',
    url: 'http://127.0.0.1:8765/api/ping',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
