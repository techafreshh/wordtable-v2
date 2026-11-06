// Client lexicon split (issue #45): the full SOWPODS list ships as a
// static text asset fetched after boot — never inlined into the entry
// chunk — with a synchronous fallback predicate until it arrives.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isLegalWord,
  isSessionWord,
  __upgradeLexiconForTests,
} from '../../client/src/store/lexicon'

const CLIENT_SRC = new URL('../../client/src/', import.meta.url)

function src(name: string): string {
  return readFileSync(new URL(name, CLIENT_SRC), 'utf8')
}

describe('lexicon fallback (pre-fetch)', () => {
  it('keeps probe words legal before the word list arrives', () => {
    expect(isLegalWord('HELLO')).toBe(true)
    expect(isLegalWord('hello')).toBe(true)
  })

  it('keeps XYZQ-style tokens illegal before the word list arrives', () => {
    expect(isLegalWord('XYZQ')).toBe(false)
  })

  it('refuses everything on the session path until the full list arrives', () => {
    expect(isSessionWord('HELLO')).toBe(false)
  })
})

describe('lexicon upgrade (word list fetched)', () => {
  it('swaps in the full list without changing refusals', () => {
    // The fetch path only accepts real-size lists (>1000 words), so
    // pad the synthetic list the same way a truncated fetch is refused.
    const words = ['HELLO', 'ZOO']
    for (let i = 0; i < 1200; i++) {
      let n = i
      let s = ''
      for (let k = 0; k < 3; k++) {
        s = String.fromCharCode(65 + (n % 26)) + s
        n = Math.floor(n / 26)
      }
      words.push(`Q${s}`)
    }
    __upgradeLexiconForTests(words.join('\n'))
    expect(isLegalWord('ZOO')).toBe(true)
    expect(isLegalWord('HELLO')).toBe(true)
    expect(isLegalWord('XYZQ')).toBe(false)
    expect(isSessionWord('ZOO')).toBe(true)
    expect(isSessionWord('XYZQ')).toBe(false)
  })
})

describe('lexicon sources', () => {
  it('keeps the word list out of the entry chunk modules', () => {
    for (const name of ['store/game.ts', 'store/session.ts']) {
      const text = src(name)
      expect(text).not.toContain('?raw')
      expect(text).not.toContain('sowpods.txt?raw')
    }
  })

  it('loads the word list as a static asset fetched at runtime', () => {
    const lexicon = src('store/lexicon.ts')
    expect(lexicon).toContain('sowpods.txt?url')
    expect(lexicon).toContain('fetch(')
    expect(lexicon).not.toContain('?raw')
  })
})
