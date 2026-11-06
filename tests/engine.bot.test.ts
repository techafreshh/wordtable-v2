import { describe, it, expect } from 'vitest'
import {
  BOARD_SIZE,
  Dictionary,
  generateBotMove,
  validateMove,
  type BoardGrid,
  type Lexicon,
  type Tile,
} from '../shared/engine/index'

function T(face: string): Tile {
  return { face, isBlank: false }
}

function emptyBoard(): BoardGrid {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array<BoardGrid[number][number]>(BOARD_SIZE).fill(null),
  )
}

function boardWith(entries: Array<[number, number, string, boolean?]>): BoardGrid {
  const board = emptyBoard()
  for (const [r, c, letter, blank] of entries) {
    board[r][c] = { letter, blank: blank ?? false }
  }
  return board
}

function lexiconOf(...words: string[]): Lexicon {
  const set = new Set(words.map((w) => w.toUpperCase()))
  return (word: string) => set.has(word.toUpperCase())
}

async function sowpods(): Promise<Lexicon> {
  const dict = await Dictionary.loadFromFile('dictionaries/sowpods.txt')
  return (word: string) => dict.isWord(word)
}

const HELLO: Array<[number, number, string, boolean?]> = [
  [7, 7, 'H'],
  [7, 8, 'E'],
  [7, 9, 'L'],
  [7, 10, 'L'],
  [7, 11, 'O'],
]

// A richer mid-game spread: HELLO crossed by an AH hook with an S extension.
const CROSS: Array<[number, number, string, boolean?]> = [
  ...HELLO,
  [6, 7, 'A'],
  [7, 12, 'S'],
]

describe('engine.bot', () => {
  it('finds a scoring move on the HELLO mid-game board that validates via rules.ts', async () => {
    const isWord = await sowpods()
    const board = boardWith(HELLO)
    // The A-hook (A above the HELLO H forming AH) guarantees at least one
    // legal move with the real SOWPODS lexicon; the greedy search finds a
    // 7-tile bingo through it.
    const rack: Tile[] = ['A', 'E', 'I', 'S', 'T', 'R', 'N'].map(T)
    const before = JSON.stringify(rack)
    const result = generateBotMove(board, rack, isWord, { seed: 7 })
    if ('pass' in result) expect.unreachable('expected a scoring move')
    expect(result.score).toBeGreaterThan(0)
    expect(result.placements.length).toBeGreaterThan(0)
    const check = validateMove(board, result.placements, isWord)
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.score).toBe(result.score)
    expect([...check.words].sort()).toEqual([...result.words].sort())
    // Blanks always carry an uppercase A-Z designation.
    for (const p of result.placements) {
      if (p.tile.isBlank) expect(p.tile.blankAs).toMatch(/^[A-Z]$/)
    }
    // The generator never mutates the input rack.
    expect(JSON.stringify(rack)).toBe(before)
  })

  it('passes with ZZZZZZZ against a hostile lexicon', () => {
    const board = boardWith(HELLO)
    const rack = ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'].map(T)
    const result = generateBotMove(board, rack, lexiconOf(), { seed: 7 })
    expect(result).toEqual({ pass: true })
  })

  it('picks the unique best move on a tiny fixture', () => {
    // Only AH validates, so greedy selection is fully determined: A above
    // the HELLO H scores 1 + 4 with no premiums in play.
    const result = generateBotMove(boardWith(HELLO), [T('A')], lexiconOf('AH'), { seed: 3 })
    expect(result).toEqual({
      ok: true,
      placements: [{ row: 6, col: 7, tile: { face: 'A', isBlank: false } }],
      score: 5,
      words: ['AH'],
    })
  })

  it('plays a blank for 0 points with an uppercase designation', () => {
    const result = generateBotMove(
      boardWith(HELLO),
      [{ face: '?', isBlank: true }],
      lexiconOf('AH'),
      { seed: 3 },
    )
    expect(result).toEqual({
      ok: true,
      placements: [{ row: 6, col: 7, tile: { face: '?', isBlank: true, blankAs: 'A' } }],
      score: 4,
      words: ['AH'],
    })
  })

  it('returns byte-identical placements for the same seed', async () => {
    const isWord = await sowpods()
    const board = boardWith(CROSS)
    const rack: Tile[] = ['A', 'E', 'I', 'S', 'T', 'R'].map(T)
    const first = generateBotMove(board, rack, isWord, { seed: 42 })
    const second = generateBotMove(board, rack, isWord, { seed: 42 })
    expect('pass' in first).toBe(false)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('plays each mid-game move in under 300ms', async () => {
    const isWord = await sowpods()
    const board = boardWith(CROSS)
    const rack: Tile[] = ['A', 'E', 'I', 'S', 'T', 'R'].map(T)
    const start = Date.now()
    const result = generateBotMove(board, rack, isWord, { seed: 7 })
    const elapsed = Date.now() - start
    console.log(`bot move: ${elapsed}ms`)
    expect('pass' in result).toBe(false)
    expect(elapsed).toBeLessThan(300)
  })
})
