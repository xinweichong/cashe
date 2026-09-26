import { defineConfig, devices } from '@playwright/test';

// This config exists for the model's own visual verification of shared UI
// primitives (see src/dev/DevPreviewPage.tsx), not as a product E2E suite —
// there is no authenticated-journey coverage here. It never touches the real
// backend/auth; the dev server serves DevPreviewPage entirely client-side.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.output',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5183 --strictPort',
    url: 'http://localhost:5183',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
