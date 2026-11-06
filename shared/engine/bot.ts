// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

import { BOARD_SIZE, premiumAt } from './board'
import { TILE_DISTRIBUTION, type Tile } from './bag'
import { validateMove, type BoardGrid, type Lexicon, type Placement } from './rules'

export interface BotOptions {
  seed?: number
  jitter?: number
}

export type BotMove =
  | { ok: true; placements: Placement[]; score: number; words: string[] }
  | { pass: true }

// Center star on a 15x15 board (H8 algebra: row 7, col 7).
const CENTER = (BOARD_SIZE - 1) / 2
const BLANK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Deterministic safety caps: enumeration order is fixed, so hitting a cap
// still returns a deterministic best-so-far (or pass) instead of stalling on
// adversarial inputs (e.g. an always-true lexicon with a blank-heavy rack).
const MAX_WORD_CHECKS = 2000000
const MAX_ORACLE_CALLS = 25000

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

const LETTER_VALUES: number[] = new Array<number>(91).fill(0)
for (const [face, { value }] of Object.entries(TILE_DISTRIBUTION)) {
  if (face.length === 1) LETTER_VALUES[face.charCodeAt(0)] = value
}

function faceValueOf(letter: string): number {
  return LETTER_VALUES[letter.charCodeAt(0)] || 0
}

// Premium multipliers split into letter and word parts, computed once.
const LETTER_MULT: number[][] = []
const WORD_MULT: number[][] = []
for (let r = 0; r < BOARD_SIZE; r++) {
  const lm: number[] = []
  const wm: number[] = []
  for (let c = 0; c < BOARD_SIZE; c++) {
    const premium = premiumAt(r, c)
    lm.push(premium === 'DL' ? 2 : premium === 'TL' ? 3 : 1)
    wm.push(premium === 'STAR' || premium === 'DW' ? 2 : premium === 'TW' ? 3 : 1)
  }
  LETTER_MULT.push(lm)
  WORD_MULT.push(wm)
}

interface Cell {
  row: number
  col: number
}

// Seeded greedy-crossword move generator. Enumerates every placement window
// touching an anchor square (empty squares adjacent to existing tiles, or the
// center star region on an empty board) in a fixed row-major order, fills
// empty cells with ordered rack-tile permutations (blanks expanded A-Z),
// pre-filters on Lexicon hits for the main word and every cross word, scores
// survivors exactly like validateMove, and ranks them by score plus seeded
// jitter. The winner is confirmed with the validateMove oracle (which also
// supplies the reported score/words); returns { pass: true } when nothing
// validates. Never mutates board/rack.
export function generateBotMove(
  board: BoardGrid,
  rack: Tile[],
  isWord: Lexicon,
  opts?: BotOptions,
): BotMove {
  const seed = opts?.seed ?? 1
  const jitterAmp = opts?.jitter ?? 2.0
  const rng = mulberry32(seed)
  const count = rack.length
  if (count === 0) return { pass: true }

  // Normalized rack snapshot; the caller's tiles are never touched.
  const rackLetter: string[] = new Array<string>(count)
  const rackBlank: boolean[] = new Array<boolean>(count)
  const rackUsable: boolean[] = new Array<boolean>(count)
  let usableTiles = 0
  for (let i = 0; i < count; i++) {
    const tile = rack[i]
    if (tile.isBlank || tile.face === '?') {
      rackLetter[i] = '?'
      rackBlank[i] = true
      rackUsable[i] = true
      usableTiles++
    } else {
      const face = tile.face.trim().toUpperCase()
      if (/^[A-Z]$/.test(face)) {
        rackLetter[i] = face
        rackBlank[i] = false
        rackUsable[i] = true
        usableTiles++
      } else {
        rackLetter[i] = ''
        rackBlank[i] = false
        rackUsable[i] = false
      }
    }
  }
  if (usableTiles === 0) return { pass: true }

  // Board occupancy plus normalized letters/blank flags for fast run reads.
  const occupied: boolean[][] = []
  const letters: string[][] = []
  const blanks: boolean[][] = []
  let empty = true
  for (let r = 0; r < BOARD_SIZE; r++) {
    const occRow: boolean[] = []
    const letRow: string[] = []
    const blankRow: boolean[] = []
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c]
      occRow.push(cell != null)
      letRow.push(cell == null ? '' : cell.letter.trim().toUpperCase())
      blankRow.push(cell == null ? false : cell.blank)
      if (cell != null) empty = false
    }
    occupied.push(occRow)
    letters.push(letRow)
    blanks.push(blankRow)
  }

  // Per-row/per-column occupancy and anchor prefix sums for O(1) window
  // filtering. Anchors are empty squares orthogonally adjacent to tiles; on
  // an empty board the star region stands in.
  const occRowPrefix: number[][] = []
  const anchorRowPrefix: number[][] = []
  for (let r = 0; r < BOARD_SIZE; r++) {
    const o: number[] = new Array<number>(BOARD_SIZE + 1)
    const a: number[] = new Array<number>(BOARD_SIZE + 1)
    o[0] = 0
    a[0] = 0
    for (let c = 0; c < BOARD_SIZE; c++) {
      o[c + 1] = o[c] + (occupied[r][c] ? 1 : 0)
      let anchor = 0
      if (!occupied[r][c]) {
        if (empty) {
          anchor =
            (r === CENTER - 1 && c === CENTER) ||
            (r === CENTER && c >= CENTER - 1 && c <= CENTER + 1) ||
            (r === CENTER + 1 && c === CENTER)
              ? 1
              : 0
        } else if (
          (r > 0 && occupied[r - 1][c]) ||
          (r + 1 < BOARD_SIZE && occupied[r + 1][c]) ||
          (c > 0 && occupied[r][c - 1]) ||
          (c + 1 < BOARD_SIZE && occupied[r][c + 1])
        ) {
          anchor = 1
        }
      }
      a[c + 1] = a[c] + anchor
    }
    occRowPrefix.push(o)
    anchorRowPrefix.push(a)
  }
  const occColPrefix: number[][] = []
  const anchorColPrefix: number[][] = []
  for (let c = 0; c < BOARD_SIZE; c++) {
    const o: number[] = new Array<number>(BOARD_SIZE + 1)
    const a: number[] = new Array<number>(BOARD_SIZE + 1)
    o[0] = 0
    a[0] = 0
    for (let r = 0; r < BOARD_SIZE; r++) {
      o[r + 1] = o[r] + (occupied[r][c] ? 1 : 0)
      a[r + 1] = a[r] + (anchorRowPrefix[r][c + 1] - anchorRowPrefix[r][c])
    }
    occColPrefix.push(o)
    anchorColPrefix.push(a)
  }

  interface Candidate {
    ranked: number
    cells: Cell[]
    faces: { letter: string; blank: boolean }[]
  }
  // Bounded leaderboard: every proposed candidate draws jitter in
  // enumeration order, but only the top few are retained for the final
  // oracle confirmation (the gates below already enforce every other
  // legality rule, so the leader confirms on the first call).
  const top: Candidate[] = []
  let wordChecks = 0
  let oracleCalls = 0
  let capped = false

  // Counts one Lexicon probe against the budget; checks the word only when it
  // is long enough to matter. Returns false when the candidate is dead.
  const noteWord = (word: string, len: number): boolean => {
    if (len < 2) return true
    wordChecks++
    if (wordChecks > MAX_WORD_CHECKS) {
      capped = true
      return false
    }
    return isWord(word)
  }

  const propose = (
    cells: Cell[],
    faces: { letter: string; blank: boolean }[],
    cheapScore: number,
  ): void => {
    // Line-based enumeration visits every placement window exactly once, so
    // duplicates cannot arise. Jitter is ranking-only: one seeded draw per
    // valid candidate in enumeration order.
    const jitter = (rng() * 2 - 1) * jitterAmp
    const ranked = cheapScore + jitter
    const candidate: Candidate = { ranked, cells, faces }
    if (top.length < 8) {
      let at = top.length
      while (at > 0 && top[at - 1].ranked < ranked) at--
      top.splice(at, 0, candidate)
      return
    }
    if (ranked <= top[top.length - 1].ranked) return
    let at = top.length - 1
    while (at > 0 && top[at - 1].ranked < ranked) at--
    top.splice(at, 0, candidate)
    top.length = 8
  }

  // Perpendicular cross through one placed cell. A window's cells share a
  // single row (or column), so the cross run holds exactly this new tile
  // plus bordering board letters. A cross word exists exactly when an
  // orthogonally adjacent board cell is occupied, so callers gate on that
  // O(1) check and only then pay for this scan. Scores exactly like
  // validateMove: blanks are worth 0 (but still trigger word premiums),
  // letter premiums apply to the new tile only, existing tiles at face value.
  const crossWordScore = (
    row: number,
    col: number,
    horizontal: boolean,
    letter: string,
    blank: boolean,
  ): { word: string; score: number } => {
    let prefix = ''
    let suffix = ''
    let lettersTotal = 0
    if (horizontal) {
      for (let r = row - 1; r >= 0 && occupied[r][col]; r--) {
        prefix = letters[r][col] + prefix
        lettersTotal += blanks[r][col] ? 0 : faceValueOf(letters[r][col])
      }
      for (let r = row + 1; r < BOARD_SIZE && occupied[r][col]; r++) {
        suffix += letters[r][col]
        lettersTotal += blanks[r][col] ? 0 : faceValueOf(letters[r][col])
      }
    } else {
      for (let c = col - 1; c >= 0 && occupied[row][c]; c--) {
        prefix = letters[row][c] + prefix
        lettersTotal += blanks[row][c] ? 0 : faceValueOf(letters[row][c])
      }
      for (let c = col + 1; c < BOARD_SIZE && occupied[row][c]; c++) {
        suffix += letters[row][c]
        lettersTotal += blanks[row][c] ? 0 : faceValueOf(letters[row][c])
      }
    }
    lettersTotal += blank ? 0 : faceValueOf(letter) * LETTER_MULT[row][col]
    return { word: `${prefix}${letter}${suffix}`, score: lettersTotal * WORD_MULT[row][col] }
  }

  const hasCross = (row: number, col: number, horizontal: boolean): boolean => {
    if (horizontal) {
      return (row > 0 && occupied[row - 1][col]) || (row + 1 < BOARD_SIZE && occupied[row + 1][col])
    }
    return (col > 0 && occupied[row][col - 1]) || (col + 1 < BOARD_SIZE && occupied[row][col + 1])
  }

  // Single empty cell: the oracle may score it along either axis (it picks
  // the axis with a neighbour), so gate and score both runs. Called once per
  // cell from the horizontal pass.
  const processSingle = (row: number, col: number): void => {
    const scoreBoth = (letter: string, blank: boolean): number | null => {
      let score = 0
      let formed = false
      if (hasCross(row, col, false)) {
        formed = true
        const cross = crossWordScore(row, col, false, letter, blank)
        if (!noteWord(cross.word, cross.word.length)) return null
        score += cross.score
      }
      if (hasCross(row, col, true)) {
        formed = true
        const cross = crossWordScore(row, col, true, letter, blank)
        if (!noteWord(cross.word, cross.word.length)) return null
        score += cross.score
      }
      return formed ? score : null
    }
    for (let i = 0; i < count; i++) {
      if (capped) return
      if (!rackUsable[i]) continue
      if (!rackBlank[i]) {
        const score = scoreBoth(rackLetter[i], false)
        if (score === null) continue
        propose([{ row, col }], [{ letter: rackLetter[i], blank: false }], score)
      } else {
        for (let li = 0; li < BLANK_LETTERS.length; li++) {
          if (capped) return
          const letter = BLANK_LETTERS[li]
          const score = scoreBoth(letter, true)
          if (score === null) continue
          propose([{ row, col }], [{ letter, blank: true }], score)
        }
      }
    }
  }

  // Multi-cell window [start, end] along one line. The oracle scores the full
  // occupied-extended [runStart, runEnd] as the main word, so pre-filter on
  // exactly that run (plus every perpendicular cross, string-gated first)
  // before paying for the exact score and the proposal.
  const processWindow = (
    horizontal: boolean,
    fixed: number,
    runStart: number,
    runEnd: number,
    emptyAt: number[],
  ): void => {
    const k = emptyAt.length
    const rowOf = (pos: number): number => (horizontal ? fixed : pos)
    const colOf = (pos: number): number => (horizontal ? pos : fixed)
    const chars: string[] = new Array<string>(runEnd - runStart + 1)
    const order = new Array<number>(k)
    const used = new Array<boolean>(count).fill(false)
    const placedLetter = new Array<string>(k)
    for (let i = runStart; i <= runEnd; i++) {
      const r = rowOf(i)
      const c = colOf(i)
      chars[i - runStart] = occupied[r][c] ? letters[r][c] : ''
    }

    const mainScore = (): number => {
      let lettersTotal = 0
      let multiplier = 1
      for (let i = runStart; i <= runEnd; i++) {
        const r = rowOf(i)
        const c = colOf(i)
        if (occupied[r][c]) {
          lettersTotal += blanks[r][c] ? 0 : faceValueOf(letters[r][c])
        } else {
          const d = emptyIndex[i - runStart]
          const blank = rackBlank[order[d]]
          lettersTotal += blank ? 0 : faceValueOf(chars[i - runStart]) * LETTER_MULT[r][c]
          multiplier *= WORD_MULT[r][c]
        }
      }
      return lettersTotal * multiplier
    }

    // Maps each run offset to its assignment slot (-1 for board cells).
    const emptyIndex: number[] = new Array<number>(runEnd - runStart + 1)
    for (let d = 0; d < k; d++) emptyIndex[emptyAt[d] - runStart] = d

    // Scores the filled run plus all crosses; proposes on full validity.
    const scoreAndPropose = (): void => {
      for (let d = 0; d < k; d++) {
        placedLetter[d] = rackBlank[order[d]] ? chars[emptyAt[d] - runStart] : rackLetter[order[d]]
      }
      let score = mainScore()
      for (let d = 0; d < k; d++) {
        if (capped) return
        const r = rowOf(emptyAt[d])
        const c = colOf(emptyAt[d])
        if (!hasCross(r, c, horizontal)) continue
        const cross = crossWordScore(r, c, horizontal, placedLetter[d], rackBlank[order[d]])
        if (!noteWord(cross.word, cross.word.length)) return
        score += cross.score
      }
      if (k === 7) score += 50
      const cells: Cell[] = []
      const faces: { letter: string; blank: boolean }[] = []
      for (let d = 0; d < k; d++) {
        cells.push({ row: rowOf(emptyAt[d]), col: colOf(emptyAt[d]) })
        faces.push({ letter: placedLetter[d], blank: rackBlank[order[d]] })
      }
      propose(cells, faces, score)
    }

    const finish = (hasBlank: boolean): void => {
      for (let d = 0; d < k; d++) {
        if (!rackBlank[order[d]]) chars[emptyAt[d] - runStart] = rackLetter[order[d]]
        else chars[emptyAt[d] - runStart] = ''
      }
      if (!hasBlank) {
        const word = chars.join('')
        wordChecks++
        if (wordChecks > MAX_WORD_CHECKS) {
          capped = true
          return
        }
        if (!isWord(word)) return
        scoreAndPropose()
        return
      }
      const blankSlots: number[] = []
      for (let d = 0; d < k; d++) {
        if (rackBlank[order[d]]) blankSlots.push(d)
      }
      const expand = (slot: number): void => {
        if (capped) return
        if (slot === blankSlots.length) {
          const word = chars.join('')
          wordChecks++
          if (wordChecks > MAX_WORD_CHECKS) {
            capped = true
            return
          }
          if (!isWord(word)) return
          scoreAndPropose()
          return
        }
        const at = emptyAt[blankSlots[slot]] - runStart
        for (let li = 0; li < BLANK_LETTERS.length; li++) {
          if (capped) return
          chars[at] = BLANK_LETTERS[li]
          expand(slot + 1)
        }
        chars[at] = ''
      }
      expand(0)
    }

    const rec = (d: number, hasBlank: boolean): void => {
      if (capped) return
      if (d === k) {
        finish(hasBlank)
        return
      }
      for (let i = 0; i < count; i++) {
        if (capped) return
        if (used[i] || !rackUsable[i]) continue
        used[i] = true
        order[d] = i
        rec(d + 1, hasBlank || rackBlank[i])
        used[i] = false
      }
    }
    rec(0, false)
  }

  // Horizontal lines: every window has empty endpoints, at most `count` new
  // tiles, and covers at least one anchor (which also guarantees board
  // connection, since anchors touch existing tiles).
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (capped) break
    const occPrefix = occRowPrefix[r]
    const anchorPrefix = anchorRowPrefix[r]
    for (let s = 0; s < BOARD_SIZE; s++) {
      if (capped) break
      if (occupied[r][s]) continue
      for (let e = s; e < BOARD_SIZE; e++) {
        if (capped) break
        if (occupied[r][e]) continue
        const span = e - s + 1
        const k = span - (occPrefix[e + 1] - occPrefix[s])
        if (k === 0 || k > count) continue
        if (anchorPrefix[e + 1] - anchorPrefix[s] === 0) continue
        // First moves must cover the center star with at least two tiles.
        if (empty) {
          if (r !== CENTER || s > CENTER || e < CENTER || k < 2) continue
        }
        if (k === 1) {
          processSingle(r, s)
          continue
        }
        let runStart = s
        while (runStart > 0 && occupied[r][runStart - 1]) runStart--
        let runEnd = e
        while (runEnd + 1 < BOARD_SIZE && occupied[r][runEnd + 1]) runEnd++
        if (runEnd - runStart + 1 < 2) continue
        const emptyAt: number[] = []
        for (let i = s; i <= e; i++) {
          if (!occupied[r][i]) emptyAt.push(i)
        }
        processWindow(true, r, runStart, runEnd, emptyAt)
      }
    }
  }

  // Vertical lines. Singletons were already enumerated above (the single-cell
  // gate covers both axes), so only multi-cell windows run here.
  for (let c = 0; c < BOARD_SIZE; c++) {
    if (capped) break
    const occPrefix = occColPrefix[c]
    const anchorPrefix = anchorColPrefix[c]
    for (let s = 0; s < BOARD_SIZE; s++) {
      if (capped) break
      if (occupied[s][c]) continue
      for (let e = s; e < BOARD_SIZE; e++) {
        if (capped) break
        if (occupied[e][c]) continue
        const span = e - s + 1
        const k = span - (occPrefix[e + 1] - occPrefix[s])
        if (k <= 1 || k > count) continue
        if (anchorPrefix[e + 1] - anchorPrefix[s] === 0) continue
        if (empty) {
          if (c !== CENTER || s > CENTER || e < CENTER) continue
        }
        let runStart = s
        while (runStart > 0 && occupied[runStart - 1][c]) runStart--
        let runEnd = e
        while (runEnd + 1 < BOARD_SIZE && occupied[runEnd + 1][c]) runEnd++
        if (runEnd - runStart + 1 < 2) continue
        const emptyAt: number[] = []
        for (let i = s; i <= e; i++) {
          if (!occupied[i][c]) emptyAt.push(i)
        }
        processWindow(false, c, runStart, runEnd, emptyAt)
      }
    }
  }

  // Confirm in greedy-ranked order: the first oracle pass wins, so every
  // returned move carries the un-jittered validateMove score/words.
  for (const candidate of top) {
    oracleCalls++
    if (oracleCalls > MAX_ORACLE_CALLS) break
    const placements: Placement[] = candidate.cells.map((cell, p) => ({
      row: cell.row,
      col: cell.col,
      tile: candidate.faces[p].blank
        ? { face: '?', isBlank: true, blankAs: candidate.faces[p].letter }
        : { face: candidate.faces[p].letter, isBlank: false },
    }))
    const check = validateMove(board, placements, isWord)
    if (!check.ok) continue
    return { ok: true, placements, score: check.score, words: [...check.words] }
  }
  return { pass: true }
}
