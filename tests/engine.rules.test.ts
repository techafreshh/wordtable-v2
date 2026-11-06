import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOARD_SIZE,
  validateMove,
  type BoardGrid,
  type Lexicon,
  type Placement,
  type Tile,
} from '../shared/engine/index'

function T(face: string): Tile {
  return { face, isBlank: false }
}

function B(blankAs: string): Tile {
  return { face: '?', isBlank: true, blankAs }
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

// Horizontal by default; set horizontal=false for a vertical run starting at (row, col).
function tiles(row: number, col: number, letters: string, horizontal = true): Placement[] {
  return [...letters].map((face, i) => ({
    row: horizontal ? row : row + i,
    col: horizontal ? col + i : col,
    tile: T(face),
  }))
}

function lexiconOf(...words: string[]): Lexicon {
  const set = new Set(words.map((w) => w.toUpperCase()))
  return (word: string) => set.has(word.toUpperCase())
}

const HELLO: Array<[number, number, string, boolean?]> = [
  [7, 7, 'H'],
  [7, 8, 'E'],
  [7, 9, 'L'],
  [7, 10, 'L'],
  [7, 11, 'O'],
]

describe('engine.rules', () => {
  it('scores HELLO across the center STAR as 18', () => {
    const result = validateMove(emptyBoard(), tiles(7, 7, 'HELLO'), lexiconOf('HELLO'))
    expect(result).toEqual({ ok: true, score: 18, words: ['HELLO'], bingo: false })
  })

  it('rejects an off-center first move with FIRST_MOVE_STAR', () => {
    const result = validateMove(emptyBoard(), tiles(7, 0, 'HELLO'), lexiconOf('HELLO'))
    expect(result).toEqual({ ok: false, reason: 'FIRST_MOVE_STAR' })
  })

  it('reports the offending word for XYZQ', () => {
    const result = validateMove(emptyBoard(), tiles(7, 7, 'XYZQ'), lexiconOf('HELLO'))
    expect(result).toEqual({ ok: false, reason: 'NOT_IN_LEXICON', word: 'XYZQ' })
  })

  it('scores a blank-as-Z STAR tile as 0 for a total of 4', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: B('Z') },
      { row: 7, col: 8, tile: T('O') },
      { row: 7, col: 9, tile: T('O') },
    ]
    const result = validateMove(emptyBoard(), placements, lexiconOf('ZOO'))
    expect(result).toEqual({ ok: true, score: 4, words: ['ZOO'], bingo: false })
  })

  it('awards the 50-point bingo on a 7-tile first move', () => {
    // TESTING on D8-J8: T on the STAR, every other square plain.
    const result = validateMove(emptyBoard(), tiles(7, 4, 'TESTING'), lexiconOf('TESTING'))
    expect(result).toEqual({ ok: true, score: 66, words: ['TESTING'], bingo: true })
  })

  it('rejects a gapped run with NOT_CONTIGUOUS', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: T('H') },
      { row: 7, col: 9, tile: T('E') },
    ]
    const result = validateMove(emptyBoard(), placements, lexiconOf('HE'))
    expect(result).toEqual({ ok: false, reason: 'NOT_CONTIGUOUS' })
  })

  it('rejects a non-touching later move with NOT_CONNECTED', () => {
    const result = validateMove(boardWith(HELLO), tiles(0, 0, 'HI'), lexiconOf('HI', 'HELLO'))
    expect(result).toEqual({ ok: false, reason: 'NOT_CONNECTED' })
  })

  it('rejects out-of-bounds placements with OUT_OF_BOUNDS', () => {
    const result = validateMove(
      emptyBoard(),
      [{ row: 15, col: 7, tile: T('A') }],
      lexiconOf('A'),
    )
    expect(result).toEqual({ ok: false, reason: 'OUT_OF_BOUNDS' })
  })

  it('rejects placement on an occupied square with TILE_CONFLICT', () => {
    const result = validateMove(
      boardWith(HELLO),
      [{ row: 7, col: 8, tile: T('X') }],
      lexiconOf('X', 'HELLO'),
    )
    expect(result).toEqual({ ok: false, reason: 'TILE_CONFLICT' })
  })

  it('sums the main word and a valid cross word', () => {
    // Board A on I7; CAT on C8-E8 crosses it as AT on the T.
    const board = boardWith([[6, 8, 'A']])
    const result = validateMove(board, tiles(7, 6, 'CAT'), lexiconOf('CAT', 'AT'))
    expect(result).toEqual({ ok: true, score: 12, words: ['CAT', 'AT'], bingo: false })
  })

  it('returns the invalid cross word, not the valid main word', () => {
    const board = boardWith([[6, 8, 'A']])
    const result = validateMove(board, tiles(7, 6, 'CAT'), lexiconOf('CAT'))
    expect(result).toEqual({ ok: false, reason: 'NOT_IN_LEXICON', word: 'AT' })
  })

  it('scores the consumed center at face value on replay', () => {
    // A on H7 above the HELLO H forms AH; the STAR must not double again.
    const result = validateMove(
      boardWith(HELLO),
      [{ row: 6, col: 7, tile: T('A') }],
      lexiconOf('AH', 'HELLO'),
    )
    expect(result).toEqual({ ok: true, score: 5, words: ['AH'], bingo: false })
  })

  it('scores a blank on a double-letter square as 0', () => {
    // HELL + blank-as-O; the O sits on the L8 double letter.
    const placements: Placement[] = [
      { row: 7, col: 7, tile: T('H') },
      { row: 7, col: 8, tile: T('E') },
      { row: 7, col: 9, tile: T('L') },
      { row: 7, col: 10, tile: T('L') },
      { row: 7, col: 11, tile: B('O') },
    ]
    const result = validateMove(emptyBoard(), placements, lexiconOf('HELLO'))
    expect(result).toEqual({ ok: true, score: 14, words: ['HELLO'], bingo: false })
  })

  it('validates through the real SOWPODS file', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const text = readFileSync(join(here, '../dictionaries/sowpods.txt'), 'utf8')
    const words = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
      const w = line.trim().toUpperCase()
      if (w !== '' && /^[A-Z]+$/.test(w)) words.add(w)
    }
    const isWord: Lexicon = (word: string) => words.has(word.toUpperCase())
    expect(words.has('HELLO')).toBe(true)
    expect(words.has('XYZQ')).toBe(false)
    expect(validateMove(emptyBoard(), tiles(7, 7, 'HELLO'), isWord)).toEqual({
      ok: true,
      score: 18,
      words: ['HELLO'],
      bingo: false,
    })
    expect(validateMove(emptyBoard(), tiles(7, 7, 'XYZQ'), isWord)).toEqual({
      ok: false,
      reason: 'NOT_IN_LEXICON',
      word: 'XYZQ',
    })
  })

  it('rejects an empty move with EMPTY_MOVE', () => {
    expect(validateMove(emptyBoard(), [], lexiconOf('HELLO'))).toEqual({
      ok: false,
      reason: 'EMPTY_MOVE',
    })
  })

  it('rejects duplicate squares in one move with TILE_CONFLICT', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: T('H') },
      { row: 7, col: 7, tile: T('E') },
    ]
    expect(validateMove(emptyBoard(), placements, lexiconOf('HE'))).toEqual({
      ok: false,
      reason: 'TILE_CONFLICT',
    })
  })

  it('rejects a non-letter face with TILE_CONFLICT', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: T('A') },
      { row: 7, col: 8, tile: T('1') },
    ]
    expect(validateMove(emptyBoard(), placements, lexiconOf('A1'))).toEqual({
      ok: false,
      reason: 'TILE_CONFLICT',
    })
  })

  it('rejects a blank without a designation with BLANK_NO_LETTER', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: { face: '?', isBlank: true } },
      { row: 7, col: 8, tile: T('O') },
    ]
    expect(validateMove(emptyBoard(), placements, lexiconOf('ZO'))).toEqual({
      ok: false,
      reason: 'BLANK_NO_LETTER',
    })
  })

  it('rejects a blank with a non-letter designation with TILE_CONFLICT', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: B('1') },
      { row: 7, col: 8, tile: T('O') },
    ]
    expect(validateMove(emptyBoard(), placements, lexiconOf('ZO'))).toEqual({
      ok: false,
      reason: 'TILE_CONFLICT',
    })
  })

  it('rejects a diagonal placement with NOT_CONTIGUOUS', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: T('H') },
      { row: 8, col: 8, tile: T('I') },
    ]
    expect(validateMove(emptyBoard(), placements, lexiconOf('HI'))).toEqual({
      ok: false,
      reason: 'NOT_CONTIGUOUS',
    })
  })

  it('rejects a single-tile first move with FIRST_MOVE_STAR', () => {
    const result = validateMove(
      emptyBoard(),
      [{ row: 7, col: 7, tile: T('H') }],
      lexiconOf('H'),
    )
    expect(result).toEqual({ ok: false, reason: 'FIRST_MOVE_STAR' })
  })

  it('normalizes lowercase faces before lexicon lookup', () => {
    const result = validateMove(emptyBoard(), tiles(7, 7, 'hello'), lexiconOf('HELLO'))
    expect(result).toEqual({ ok: true, score: 18, words: ['HELLO'], bingo: false })
  })

  it('normalizes a lowercase blank designation', () => {
    const placements: Placement[] = [
      { row: 7, col: 7, tile: B('z') },
      { row: 7, col: 8, tile: T('O') },
      { row: 7, col: 9, tile: T('O') },
    ]
    const result = validateMove(emptyBoard(), placements, lexiconOf('ZOO'))
    expect(result).toEqual({ ok: true, score: 4, words: ['ZOO'], bingo: false })
  })

  it('reports no bingo for a 6-tile first move', () => {
    // ORANGE on F8-K8: A on the STAR, every other square plain.
    const result = validateMove(emptyBoard(), tiles(7, 5, 'ORANGE'), lexiconOf('ORANGE'))
    expect(result).toEqual({ ok: true, score: 14, words: ['ORANGE'], bingo: false })
  })

  it('stacks triple-word, double-letter and bingo on one later move', () => {
    // ABCDEFGH down column H through the HELLO H: A lands on the H1
    // triple-word, D lands on the H4 double letter, 7 new tiles bingo.
    const result = validateMove(
      boardWith(HELLO),
      tiles(0, 7, 'ABCDEFG', false),
      lexiconOf('ABCDEFGH'),
    )
    expect(result).toEqual({ ok: true, score: 116, words: ['ABCDEFGH'], bingo: true })
  })

  it('checks the main word before any cross word', () => {
    const board = boardWith([[6, 8, 'A']])
    const result = validateMove(board, tiles(7, 6, 'CAT'), lexiconOf())
    expect(result).toEqual({ ok: false, reason: 'NOT_IN_LEXICON', word: 'CAT' })
  })

  it('treats a diagonal-only touch as NOT_CONNECTED', () => {
    const result = validateMove(boardWith(HELLO), tiles(6, 5, 'HI'), lexiconOf('HI'))
    expect(result).toEqual({ ok: false, reason: 'NOT_CONNECTED' })
  })

  it('conflicts on an occupied square even when the letter matches', () => {
    const result = validateMove(
      boardWith(HELLO),
      [{ row: 7, col: 7, tile: T('H') }],
      lexiconOf('H', 'HELLO'),
    )
    expect(result).toEqual({ ok: false, reason: 'TILE_CONFLICT' })
  })
})
