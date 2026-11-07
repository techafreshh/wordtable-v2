// Playwright e2e (issue #19) — phone-viewport walks against the
// release artifact (single-port server `node dist/server.js --port 4101`
// via `npm run serve:e2e` on :4101): an offline tap-tap
// commit plus an online reload-resume across two browser contexts.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4101',
  },
  projects: [
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'npm run serve:e2e',
    url: 'http://127.0.0.1:4101/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      WORDTABLE_DEBUG: '1',
    },
  },
})
