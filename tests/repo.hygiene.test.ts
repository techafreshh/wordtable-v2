import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const REPO_ROOT = new URL('../', import.meta.url)
const GITIGNORE = new URL('../.gitignore', import.meta.url)
const TESTS_TSCONFIG = new URL('./tsconfig.json', import.meta.url)
const SHARED_TSCONFIG = new URL('../shared/tsconfig.json', import.meta.url)
const SERVER_TSCONFIG = new URL('../server/tsconfig.json', import.meta.url)
const CLIENT_TSCONFIG = new URL('../client/tsconfig.json', import.meta.url)
const VITEST_CONFIG = new URL('../vitest.config.ts', import.meta.url)

const SCAN_ROOTS = ['client', 'server', 'shared', 'tests']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-server', '.git'])
const ARTIFACT_RE = /\.(js|d\.ts|tsbuildinfo)$/
// Issue #40: gitignored `*.test.js` doubles beside `*.test.ts` originals
// would double-collect every client suite, so shadow doubles get their own matcher.
const SHADOW_RE = /\.test\.js$/

function walk(relativeDir: string, out: string[]): void {
  const dirUrl = new URL(`${relativeDir}/`, REPO_ROOT)
  for (const entry of readdirSync(dirUrl)) {
    if (SKIP_DIRS.has(entry)) continue
    const entryUrl = new URL(`${relativeDir}/${entry}`, REPO_ROOT)
    const st = statSync(entryUrl)
    if (st.isDirectory()) {
      walk(`${relativeDir}/${entry}`, out)
    } else if (ARTIFACT_RE.test(entry)) {
      out.push(`${relativeDir}/${entry}`)
    }
  }
}

function read(url: URL): string {
  return readFileSync(url, 'utf8')
}

// Issue #40: mirrors `walk` exactly (same skip set, no fixture
// special-casing) but matches only `*.test.js` shadow doubles.
function walkShadows(relativeDir: string, out: string[]): void {
  const dirUrl = new URL(`${relativeDir}/`, REPO_ROOT)
  for (const entry of readdirSync(dirUrl)) {
    if (SKIP_DIRS.has(entry)) continue
    const entryUrl = new URL(`${relativeDir}/${entry}`, REPO_ROOT)
    const st = statSync(entryUrl)
    if (st.isDirectory()) {
      walkShadows(`${relativeDir}/${entry}`, out)
    } else if (SHADOW_RE.test(entry)) {
      out.push(`${relativeDir}/${entry}`)
    }
  }
}

describe('repo hygiene: no tsc-emitted artifacts beside sources', () => {
  it('has zero .js / .d.ts / .tsbuildinfo files beside sources', () => {
    const found: string[] = []
    for (const root of SCAN_ROOTS) {
      walk(root, found)
    }
    expect(found).toEqual([])
  })

  it('does not blanket-ignore *.js or *.d.ts in .gitignore', () => {
    const lines = read(GITIGNORE).split('\n').map((l) => l.trim())
    expect(lines).not.toContain('*.js')
    expect(lines).not.toContain('*.d.ts')
  })

  it('pins noEmit in tests/ and shared/ tsconfigs', () => {
    const tests = JSON.parse(read(TESTS_TSCONFIG)) as { compilerOptions?: Record<string, unknown> }
    const shared = JSON.parse(read(SHARED_TSCONFIG)) as { compilerOptions?: Record<string, unknown> }
    const server = JSON.parse(read(SERVER_TSCONFIG)) as { compilerOptions?: Record<string, unknown> }
    const client = JSON.parse(read(CLIENT_TSCONFIG)) as { compilerOptions?: Record<string, unknown> }
    expect(tests.compilerOptions?.['noEmit']).toBe(true)
    expect(shared.compilerOptions?.['noEmit']).toBe(true)
    expect(server.compilerOptions?.['noEmit']).toBe(true)
    expect(client.compilerOptions?.['noEmit']).toBe(true)
  })

  it('scopes vitest to TS-only test globs', () => {
    const config = read(VITEST_CONFIG)
    expect(config).toContain('tests/**/*.test.ts')
    expect(config).toContain('dist-server')
  })
})

describe('test duplication: each suite executes exactly once (issue #40)', () => {
  it('has zero *.test.js shadows under tests/', () => {
    const shadows: string[] = []
    walkShadows('tests', shadows)
    expect(shadows).toEqual([])
  })

  it('keeps the vitest include array TS-only', () => {
    // Scoped to the include array on purpose: comments elsewhere in
    // vitest.config.ts legitimately name `*.test.js` (the stray-emission
    // guard), so a whole-file `not.toContain` would fail on a clean tree.
    const config = read(VITEST_CONFIG)
    const match = config.match(/include:\s*\[([\s\S]*?)\]/)
    expect(match).not.toBeNull()
    const block = match?.[1] ?? ''
    const entries = [...block.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.endsWith('.test.ts')).toBe(true)
      expect(entry).not.toContain('.js')
    }
  })
})
