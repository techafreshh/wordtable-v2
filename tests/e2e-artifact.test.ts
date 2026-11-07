// E2e artifact guard (issue #65) — the Playwright walk must boot the
// release artifact (`node dist/server.js`), never the tsx dev server, so
// CI covers the bundled layout path instead of only manual smoke.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const PACKAGE_JSON = new URL('../package.json', import.meta.url)
const PLAYWRIGHT_CONFIG = new URL('../playwright.config.ts', import.meta.url)

describe('e2e boots the release artifact (issue #65)', () => {
  it('serve:e2e runs node dist/server.js on :4101, not tsx', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const script = pkg.scripts?.['serve:e2e'] ?? ''
    expect(script).toContain('dist/server.js')
    expect(script).toContain('4101')
    expect(script).not.toContain('tsx')
  })

  it('playwright webServer boots via serve:e2e, not tsx server/src/ws.ts', () => {
    const config = readFileSync(PLAYWRIGHT_CONFIG, 'utf8')
    expect(config).toContain('serve:e2e')
    expect(config).not.toContain('tsx server/src/ws.ts')
  })
})
