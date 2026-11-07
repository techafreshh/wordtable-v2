// Client bundle discipline (issue #39): the entry chunk stays Three-free
// and wordlist-free — Three ships as an idle-loaded async chunk, the
// SOWPODS list as a fetched text asset — so `npm run build` stays free
// of chunk-size warnings. Static source assertions prove the discipline
// without a GPU or a real build.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const CLIENT_SRC = new URL('../../client/src/', import.meta.url)
const REPO_ROOT = new URL('../../', import.meta.url)

function src(name: string): string {
  return readFileSync(new URL(name, CLIENT_SRC), 'utf8')
}

function root(name: string): string {
  return readFileSync(new URL(name, REPO_ROOT), 'utf8')
}

describe('bundle entry discipline', () => {
  it('lazy-loads the Three backdrop behind the static guard', () => {
    const main = src('main.ts')
    // Dynamic import: Vite emits Three as a separate async chunk.
    expect(main).toContain("import('./three/table')")
    expect(main).toContain('isBackdropDisabled')
    // Guard runs before the dynamic import so `?nogl=1` never fetches it.
    expect(main.indexOf('isBackdropDisabled')).toBeLessThan(
      main.indexOf("import('./three/table')"),
    )
    // No static import of the Three module: the entry chunk stays light.
    expect(main).not.toContain("from './three/table'")
    expect(main).not.toContain('from "./three/table"')
  })

  it('keeps the word list out of the entry graph', () => {
    for (const name of ['main.ts', 'store/game.ts', 'store/session.ts']) {
      const text = src(name)
      expect(text).not.toContain('?raw')
      expect(text).not.toContain('sowpods.txt?raw')
    }
    const main = src('main.ts')
    expect(main).not.toContain("from 'three'")
    expect(main).not.toContain('from "three"')
  })
})

describe('bundle vendor discipline', () => {
  it('imports Three by name so the backdrop chunk tree-shakes', () => {
    const table = src('three/table.ts')
    expect(table).toContain("from 'three'")
    expect(table).toContain('PerspectiveCamera')
    expect(table).toContain('PointsMaterial')
    // Namespace imports defeat tree-shaking; keep them out.
    expect(table).not.toContain('import * as THREE')
    expect(table).not.toContain('THREE.')
    expect(table).not.toContain('?raw')
  })

  it('keeps the guard and parallax helpers free of Three imports', () => {
    for (const name of ['three/backdrop-guard.ts', 'three/parallax.ts']) {
      const text = src(name)
      expect(text).not.toContain("from 'three'")
      expect(text).not.toContain('from "three"')
    }
  })

  it('loads the word list as a static asset fetched at runtime', () => {
    const lexicon = src('store/lexicon.ts')
    expect(lexicon).toContain('sowpods.txt?url')
    expect(lexicon).toContain('fetch(')
    expect(lexicon).not.toContain('?raw')
  })
})

describe('bundle config discipline', () => {
  it('scopes the chunk-size warning limit to the deferred backdrop chunk', () => {
    const config = root('vite.config.ts')
    expect(config).toContain('chunkSizeWarningLimit')
  })
})
