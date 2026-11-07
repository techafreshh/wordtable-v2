import { describe, it, expect } from 'vitest'
import { Dictionary } from '../shared/engine/dictionary'
import { playSoakGame } from './soak'

describe('seeded bot-vs-bot soak (fast wrapper)', () => {
  it('plays 2 games with zero illegal states and rule endings, deterministically', async () => {
    const dict = await Dictionary.loadFromFile()
    const isWord = (word: string): boolean => dict.isWord(word)
    const first = [playSoakGame(0, 42, isWord), playSoakGame(1, 42, isWord)]
    expect(first.length).toBe(2)
    for (const r of first) {
      expect(r.illegal).toBe(0)
      expect(r.endReason === 'SIX_SCORELESS' || r.endReason === 'BAG_EMPTY_OUT').toBe(true)
    }
    const second = [playSoakGame(0, 42, isWord), playSoakGame(1, 42, isWord)]
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  }, 90000)
})
