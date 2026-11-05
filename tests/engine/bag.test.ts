import { describe, it, expect } from 'vitest'
import { TileBag, TILE_DISTRIBUTION } from '../../shared/engine/bag'

describe('TileBag', () => {
  it('ships the official 100-tile distribution', () => {
    const bag = new TileBag(1)
    expect(bag.remaining()).toBe(100)
    let total = 0
    for (const { count } of Object.values(TILE_DISTRIBUTION)) total += count
    expect(total).toBe(100)
  })

  it('is deterministic for a given seed', () => {
    const a = new TileBag(42).draw(7)
    const b = new TileBag(42).draw(7)
    expect(a).toEqual(b)
  })

  it('draw reduces the bag', () => {
    const bag = new TileBag(7)
    bag.draw(7)
    expect(bag.remaining()).toBe(93)
  })
})
