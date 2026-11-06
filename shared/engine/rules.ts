// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

import { BOARD_SIZE, premiumAt } from './board'
import { TILE_DISTRIBUTION, tileValue, type Tile } from './bag'

export interface Placement {
  row: number
  col: number
  tile: Tile
}

export interface BoardCell {
  letter: string
  blank: boolean
}

export type BoardGrid = (BoardCell | null)[][]

export type Lexicon = (word: string) => boolean

export type RuleReason =
  | 'EMPTY_MOVE'
  | 'OUT_OF_BOUNDS'
  | 'TILE_CONFLICT'
  | 'NOT_CONTIGUOUS'
  | 'FIRST_MOVE_STAR'
  | 'NOT_CONNECTED'
  | 'NOT_IN_LEXICON'
  | 'BLANK_NO_LETTER'

export type ValidateResult =
  | { ok: true; score: number; words: string[]; bingo: boolean }
  | { ok: false; reason: RuleReason; word?: string }

// H8 algebra: row 7, col 7 is the center STAR on a 15x15 board.
const CENTER = (BOARD_SIZE - 1) / 2

function keyOf(row: number, col: number): string {
  return `${row},${col}`
}

function isOnBoard(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  )
}

function cellOccupied(board: BoardGrid, row: number, col: number): boolean {
  if (!isOnBoard(row, col)) return false
  return board[row][col] != null
}

// Uppercase A-Z letter this tile plays, or null when it plays nothing usable.
// Blanks play their `blankAs` designation; every other tile plays its face.
function effectiveLetter(tile: Tile): string | null {
  const raw = tile.isBlank ? (tile.blankAs ?? '') : tile.face
  const letter = raw.trim().toUpperCase()
  return /^[A-Z]$/.test(letter) ? letter : null
}

interface PlacedSquare {
  row: number
  col: number
  letter: string
  blank: boolean
  isNew: boolean
  tile: Tile | null
}

function faceValue(letter: string): number {
  return TILE_DISTRIBUTION[letter]?.value ?? 0
}

export function validateMove(
  board: BoardGrid,
  placements: Placement[],
  isWord: Lexicon,
): ValidateResult {
  if (placements.length === 0) {
    return { ok: false, reason: 'EMPTY_MOVE' }
  }

  for (const p of placements) {
    if (!isOnBoard(p.row, p.col)) {
      return { ok: false, reason: 'OUT_OF_BOUNDS' }
    }
  }

  const seen = new Set<string>()
  for (const p of placements) {
    const key = keyOf(p.row, p.col)
    if (seen.has(key)) {
      return { ok: false, reason: 'TILE_CONFLICT' }
    }
    seen.add(key)
  }

  for (const p of placements) {
    if (board[p.row][p.col] != null) {
      return { ok: false, reason: 'TILE_CONFLICT' }
    }
    if (p.tile.isBlank && (p.tile.blankAs ?? '').trim() === '') {
      return { ok: false, reason: 'BLANK_NO_LETTER' }
    }
    if (effectiveLetter(p.tile) === null) {
      return { ok: false, reason: 'TILE_CONFLICT' }
    }
  }

  const first = placements[0]
  const sameRow = placements.every((p) => p.row === first.row)
  const sameCol = placements.every((p) => p.col === first.col)
  if (!sameRow && !sameCol) {
    return { ok: false, reason: 'NOT_CONTIGUOUS' }
  }

  const placedKeys = new Set(placements.map((p) => keyOf(p.row, p.col)))

  // A lone tile has no line of its own: run it along whichever axis already
  // holds a neighbour (horizontal wins ties); an isolated tile defaults to
  // horizontal and fails later as a 1-letter NOT_IN_LEXICON word.
  let horizontal: boolean
  if (placements.length === 1) {
    const hasHorizontalNeighbour =
      cellOccupied(board, first.row, first.col - 1) ||
      cellOccupied(board, first.row, first.col + 1)
    const hasVerticalNeighbour =
      cellOccupied(board, first.row - 1, first.col) ||
      cellOccupied(board, first.row + 1, first.col)
    horizontal = hasHorizontalNeighbour || !hasVerticalNeighbour
  } else {
    horizontal = sameRow
  }

  if (placements.length > 1) {
    if (horizontal) {
      const cols = placements.map((p) => p.col)
      const lo = Math.min(...cols)
      const hi = Math.max(...cols)
      for (let c = lo; c <= hi; c++) {
        if (!placedKeys.has(keyOf(first.row, c)) && board[first.row][c] == null) {
          return { ok: false, reason: 'NOT_CONTIGUOUS' }
        }
      }
    } else {
      const rows = placements.map((p) => p.row)
      const lo = Math.min(...rows)
      const hi = Math.max(...rows)
      for (let r = lo; r <= hi; r++) {
        if (!placedKeys.has(keyOf(r, first.col)) && board[r][first.col] == null) {
          return { ok: false, reason: 'NOT_CONTIGUOUS' }
        }
      }
    }
  }

  let boardEmpty = true
  for (let r = 0; r < BOARD_SIZE && boardEmpty; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] != null) {
        boardEmpty = false
        break
      }
    }
  }

  if (boardEmpty) {
    const coversCenter = placements.some((p) => p.row === CENTER && p.col === CENTER)
    if (!coversCenter || placements.length < 2) {
      return { ok: false, reason: 'FIRST_MOVE_STAR' }
    }
  } else {
    let connected = placements.some(
      (p) =>
        cellOccupied(board, p.row - 1, p.col) ||
        cellOccupied(board, p.row + 1, p.col) ||
        cellOccupied(board, p.row, p.col - 1) ||
        cellOccupied(board, p.row, p.col + 1),
    )
    if (!connected && placements.length > 1) {
      // A run bridged across existing tiles touches the board mid-word.
      if (horizontal) {
        const cols = placements.map((p) => p.col)
        const lo = Math.min(...cols)
        const hi = Math.max(...cols)
        for (let c = lo; c <= hi && !connected; c++) {
          connected = board[first.row][c] != null
        }
      } else {
        const rows = placements.map((p) => p.row)
        const lo = Math.min(...rows)
        const hi = Math.max(...rows)
        for (let r = lo; r <= hi && !connected; r++) {
          connected = board[r][first.col] != null
        }
      }
    }
    if (!connected) {
      return { ok: false, reason: 'NOT_CONNECTED' }
    }
  }

  function squareAt(row: number, col: number): PlacedSquare | null {
    const placed = placedKeys.has(keyOf(row, col))
      ? placements.find((p) => p.row === row && p.col === col)
      : undefined
    if (placed !== undefined && placed !== null) {
      const tile = placed.tile
      const letter = effectiveLetter(tile)
      // Null is unreachable: every tile passed validation above.
      if (letter === null) return null
      return { row, col, letter, blank: tile.isBlank, isNew: true, tile }
    }
    if (!isOnBoard(row, col)) return null
    const cell = board[row][col]
    if (cell == null) return null
    return {
      row,
      col,
      letter: cell.letter.trim().toUpperCase(),
      blank: cell.blank,
      isNew: false,
      tile: null,
    }
  }

  function readRun(row: number, col: number, runHorizontal: boolean): PlacedSquare[] {
    const dr = runHorizontal ? 0 : 1
    const dc = runHorizontal ? 1 : 0
    let r = row
    let c = col
    while (squareAt(r - dr, c - dc) !== null) {
      r -= dr
      c -= dc
    }
    const run: PlacedSquare[] = []
    for (;;) {
      const sq = squareAt(r, c)
      if (sq === null) break
      run.push(sq)
      r += dr
      c += dc
    }
    return run
  }

  const mainRun = readRun(first.row, first.col, horizontal)
  const mainWord = mainRun.map((sq) => sq.letter).join('')

  const candidates: { text: string; squares: PlacedSquare[] }[] = []
  if (mainRun.length >= 2) {
    candidates.push({ text: mainWord, squares: mainRun })
  }
  for (const p of placements) {
    const cross = readRun(p.row, p.col, !horizontal)
    if (cross.length >= 2) {
      candidates.push({ text: cross.map((sq) => sq.letter).join(''), squares: cross })
    }
  }

  if (candidates.length === 0) {
    return { ok: false, reason: 'NOT_IN_LEXICON', word: mainWord }
  }
  for (const candidate of candidates) {
    if (!isWord(candidate.text)) {
      return { ok: false, reason: 'NOT_IN_LEXICON', word: candidate.text }
    }
  }

  let score = 0
  for (const candidate of candidates) {
    let letters = 0
    let multiplier = 1
    for (const sq of candidate.squares) {
      let value: number
      if (sq.blank) {
        // Blanks are always worth 0, even on a letter premium ...
        value = 0
      } else if (sq.tile !== null) {
        // Score the normalized letter: validation accepts lowercase faces,
        // but tileValue only knows the uppercase distribution keys.
        value = tileValue({ ...sq.tile, face: sq.letter })
        const premium = premiumAt(sq.row, sq.col)
        if (premium === 'DL') value *= 2
        else if (premium === 'TL') value *= 3
      } else {
        value = faceValue(sq.letter)
      }
      letters += value
      // ... but a blank on a word premium still multiplies the word.
      // Consumed premiums on existing tiles never score twice.
      if (sq.isNew) {
        const premium = premiumAt(sq.row, sq.col)
        if (premium === 'STAR' || premium === 'DW') multiplier *= 2
        else if (premium === 'TW') multiplier *= 3
      }
    }
    score += letters * multiplier
  }
  const bingo = placements.length === 7
  if (bingo) score += 50
  return { ok: true, score, words: candidates.map((c) => c.text), bingo }
}
