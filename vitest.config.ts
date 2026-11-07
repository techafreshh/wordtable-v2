// Vitest unit suite (issue #23) — TS-only includes so a stray tsc-emitted
// `*.test.js` beside sources can never double-run a suite; e2e specs live
// under `tests/e2e/` (Playwright `testMatch`) and stay excluded here, as does
// the dead `dist-server/` tsc outDir.
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // TS-only globs: emitted `.js` siblings of `*.test.ts` files are invisible.
    include: ['tests/**/*.test.ts'],
    // Keep vitest defaults, plus e2e (Playwright-owned) and the dead outDir.
    exclude: [...defaultExclude, 'tests/e2e/**', '**/dist-server/**'],
  },
})
