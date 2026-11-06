import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const REPO_ROOT = new URL('../', import.meta.url)
const GITIGNORE = new URL('../.gitignore', import.meta.url)
const TESTS_TSCONFIG = new URL('./tsconfig.json', import.meta.url)
const SHARED_TSCONFIG = new URL('../shared/tsconfig.json', import.meta.url)

const SCAN_ROOTS = ['client', 'server', 'shared', 'tests']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-server', '.git'])
const ARTIFACT_RE = /\.(js|d\.ts|tsbuildinfo)$/

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
    expect(tests.compilerOptions?.['noEmit']).toBe(true)
    expect(shared.compilerOptions?.['noEmit']).toBe(true)
  })
})
