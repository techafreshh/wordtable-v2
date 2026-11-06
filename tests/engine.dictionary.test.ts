import { describe, it, expect } from 'vitest'
import { Dictionary } from '../shared/engine/dictionary'

describe('Dictionary', () => {
  it('loads the bundled SOWPODS list with >= 200000 words in under 3000ms', async () => {
    const start = Date.now()
    const dict = await Dictionary.loadFromFile('assets/sowpods.txt')
    const elapsed = Date.now() - start
    expect(dict.size).toBeGreaterThanOrEqual(200000)
    expect(elapsed).toBeLessThan(3000)
  }, 10000)

  it('validates known words and rejects non-words', async () => {
    const dict = await Dictionary.loadFromFile('assets/sowpods.txt')
    expect(dict.isWord('QUIXOTIC')).toBe(true)
    expect(dict.isWord('quixotic')).toBe(true)
    expect(dict.isWord('ZZZZZZZ')).toBe(false)
    expect(dict.isWord('')).toBe(false)
  }, 10000)

  it('resolves the default path without an explicit argument', async () => {
    const dict = await Dictionary.loadFromFile()
    expect(dict.size).toBeGreaterThanOrEqual(200000)
    expect(dict.isWord('QUIXOTIC')).toBe(true)
  }, 10000)

  it('builds from inline text with identical lookup semantics', () => {
    const dict = Dictionary.fromText('hello\nWORLD\n  \nquixotic\n')
    expect(dict.size).toBe(3)
    expect(dict.isWord('HELLO')).toBe(true)
    expect(dict.isWord('world')).toBe(true)
    expect(dict.isWord('QUIXOTIC')).toBe(true)
    expect(dict.isWord('missing')).toBe(false)
    expect(dict.isWord('')).toBe(false)
    expect(dict.isWord('ABC123')).toBe(false)
  })
})
