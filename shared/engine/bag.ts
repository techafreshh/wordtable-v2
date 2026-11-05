// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

export type TileFace = string // "A".."Z" or "?" (blank)

export interface Tile {
  face: TileFace
  isBlank: boolean
  blankAs?: string // when a blank is placed, the letter it represents
}

// Official 100-tile Scrabble distribution: letter -> (count, value)
export const TILE_DISTRIBUTION: Record<string, { count: number; value: number }> = {
  A: { count: 9, value: 1 },
  B: { count: 2, value: 3 },
  C: { count: 2, value: 3 },
  D: { count: 4, value: 2 },
  E: { count: 12, value: 1 },
  F: { count: 2, value: 4 },
  G: { count: 3, value: 2 },
  H: { count: 2, value: 4 },
  I: { count: 9, value: 1 },
  J: { count: 1, value: 8 },
  K: { count: 1, value: 5 },
  L: { count: 4, value: 1 },
  M: { count: 2, value: 3 },
  N: { count: 6, value: 1 },
  O: { count: 8, value: 1 },
  P: { count: 2, value: 3 },
  Q: { count: 1, value: 10 },
  R: { count: 6, value: 1 },
  S: { count: 4, value: 1 },
  T: { count: 6, value: 1 },
  U: { count: 4, value: 1 },
  V: { count: 2, value: 4 },
  W: { count: 2, value: 4 },
  X: { count: 1, value: 8 },
  Y: { count: 2, value: 4 },
  Z: { count: 1, value: 10 },
  '?': { count: 2, value: 0 },
}

export function tileValue(tile: Tile): number {
  if (tile.isBlank) return 0
  const entry = TILE_DISTRIBUTION[tile.face]
  if (!entry) throw new Error(`tileValue: unknown face ${tile.face}`)
  return entry.value
}

export class TileBag {
  private tiles: Tile[] = []

  constructor(seed: number) {
    const rng = mulberry32(seed)
    const pool: Tile[] = []
    for (const [letter, { count }] of Object.entries(TILE_DISTRIBUTION)) {
      for (let i = 0; i < count; i++) {
        pool.push(letter === '?' ? { face: '?', isBlank: true } : { face: letter, isBlank: false })
      }
    }
    // Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    this.tiles = pool
  }

  draw(n: number): Tile[] {
    return this.tiles.splice(0, Math.min(n, this.tiles.length))
  }

  remaining(): number {
    return this.tiles.length
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
