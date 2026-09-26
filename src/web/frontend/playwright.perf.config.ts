import { defineConfig, devices } from '@playwright/test';

// Repeatable frontend performance measurement against the production bundle
// (`vite build` + `vite preview`), with the API mocked so results isolate
// bundle, parse and render cost from backend latency. Runs serially so
// iterations don't compete for CPU. This is Chromium emulation on the host
// machine, not a real-device measurement. Run: npm run test:perf
export default defineConfig({
  testDir: './e2e/perf',
  testMatch: '**/*.perf.ts',
  outputDir: './e2e/.output-perf',
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 600_000,
  use: {
    baseURL: 'http://localhost:5184',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 5184 --strictPort',
    url: 'http://localhost:5184',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
