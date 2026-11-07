import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLEAN_SCRIPT = join(REPO_ROOT, 'scripts', 'clean-dist.mjs')

function read(url: URL): string {
  return readFileSync(url, 'utf8')
}

describe('build hygiene: clean dist before build', () => {
  it('empties a fixture dir containing stale hashed assets', () => {
    const fixture = join(REPO_ROOT, 'tests', '.tmp-clean-fixture')
    const staleDir = join(fixture, 'assets')
    mkdirSync(staleDir, { recursive: true })
    writeFileSync(join(staleDir, 'stale-abc123.js'), '// stale\n')
    writeFileSync(join(fixture, 'stale-marker.txt'), 'stale\n')
    execFileSync('node', [CLEAN_SCRIPT, 'tests/.tmp-clean-fixture'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
    expect(existsSync(fixture)).toBe(false)
  })

  it('runs the clean script before the first vite build in the build chain', () => {
    const pkg = JSON.parse(read(new URL('../package.json', import.meta.url))) as {
      scripts?: Record<string, string>
    }
    const build = pkg.scripts?.['build'] ?? ''
    const cleanIdx = build.indexOf('scripts/clean-dist.mjs')
    const viteIdx = build.indexOf('vite build')
    expect(cleanIdx).toBeGreaterThanOrEqual(0)
    expect(viteIdx).toBeGreaterThanOrEqual(0)
    expect(cleanIdx).toBeLessThan(viteIdx)
    expect(pkg.scripts?.['clean']).toContain('scripts/clean-dist.mjs')
  })

  it('keeps emptyOutDir false in the server config so it preserves dist/client', () => {
    const config = read(new URL('../vite.server.config.ts', import.meta.url))
    expect(config).toContain('emptyOutDir: false')
  })
})
