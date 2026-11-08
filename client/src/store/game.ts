// Placement store — client-side pending tiles for the rack (issue #7)
// plus the offline commit path (issue #8). Pending/recall/provisional
// scoring mirror the vanilla-zustand shape of store/ui.ts. Commits validate
// pending placements against the shared engine with the bundled SOWPODS
// lexicon and write them onto the local board grid, so an illegal word is
// refused with the engine's own NOT_IN_LEXICON reason + word payload.

import { createStore } from 'zustand/vanilla'
import { BOARD_SIZE, parseSquare, toAlgebra } from '../../../shared/engine/board'
import {
  validateMove,
  type BoardCell,
  type BoardGrid,
  type Placement,
  type RuleReason,
} from '../../../shared/engine/rules'
import { TileBag, type Tile } from '../../../shared/engine/bag'
import { isLegalWord } from './lexicon'

export interface PendingTile {
  id: number
  face: string
  isBlank: boolean
  // Designated letter for a blank (A-Z). Absent until the picker resolves.
  blankAs?: string
  sq: string
}

export type CommitResult =
  | { ok: true; points: number; words: string[] }
  | { ok: false; reason: RuleReason | 'EMPTY_MOVE'; word?: string }

// Authoritative snapshot projection (issue #14): the fields the server's
// `viewFor`/`boardTilesFor` fan out on every `state_sync` broadcast.
// `board_tiles` entries carry algebra (`square`) or `{row,col}` plus
// `letter`/`blank`; `rack` faces use '?' for blanks.
export interface StateSyncSnapshot {
  board_tiles?: unknown
  rack?: unknown
  [key: string]: unknown
}

interface GameStoreState {
  rack: Tile[]
  pending: PendingTile[]
  selectedRack: number | null
  provScore: number
  provWords: string[]
  // Committed board grid plus the last commit's highlight/score chips.
  board: BoardGrid
  lastMove: string[]
  lastScore: number | null
  setRack: (faces: string[]) => void
  selectRack: (index: number | null) => void
  placeTile: (rackIndex: number, sq: string) => boolean
  // Blank-aware placement: blanks require an A-Z designation up front so
  // the UI never parks an undesignated pending blank.
  placeTileAs: (rackIndex: number, sq: string, letter?: string) => boolean
  designateBlank: (pendingId: number, letter: string) => boolean
  returnTile: (pendingId: number) => void
  recall: () => void
  shuffle: () => void
  reset: () => void
  // Online projection (issue #14): rebuild board + rack from the
  // server's authoritative snapshot (see StateSyncSnapshot above).
  applyStateSync: (snapshot: StateSyncSnapshot) => void
  // Leave an online room: drop the authoritative board/rack.
  syncFromSession: (board: BoardGrid, rack: Tile[]) => void
  resetOnline: () => void
  // Validate pending against the lexicon; on success write the board, mark
  // lastMove and refill the rack, on refusal (except BLANK_NO_LETTER)
  // slide the tiles back to the rack.
  commit: () => CommitResult
}

let nextPendingId = 0
let bag = new TileBag(1)

// full SOWPODS list is fetched as a static asset after boot instead of
// inlined (see the ./lexicon import above). The embedded fallback only
// covers early commits; it deliberately excludes XYZQ-style tokens.
export { isLegalWord }

function emptyGrid(): BoardGrid {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array<BoardCell | null>(BOARD_SIZE).fill(null),
  )
}

function toPlacements(pending: PendingTile[]): Placement[] {
  return pending.map((p) => {
    const { row, col } = parseSquare(p.sq)
    if (p.isBlank) {
      return { row, col, tile: { face: '?', isBlank: true, blankAs: p.blankAs ?? '' } }
    }
    return { row, col, tile: { face: p.face, isBlank: false } }
  })
}

// Provisional chip (issue #85): pending validates against the live board,
// not an empty grid, so a second-word placement scores against committed
// tiles while the lexicon stays permissive (the commit path re-checks
// with the real lexicon). The board is passed in because the session
// table syncs it from the engine snapshot before every placement.
function provisional(
  board: BoardGrid,
  pending: PendingTile[],
): { score: number; words: string[] } {
  if (pending.length === 0) return { score: 0, words: [] }
  const result = validateMove(board, toPlacements(pending), () => true)
  if (!result.ok) return { score: 0, words: [] }
  return { score: result.score, words: [...result.words] }
}

function tileOf(face: string): Tile | null {
  const f = face.trim().toUpperCase()
  if (f === '?') return { face: '?', isBlank: true }
  if (/^[A-Z]$/.test(f)) return { face: f, isBlank: false }
  return null
}

// Display face: a designated blank shows its letter (still worth 0 —
// tileValue keys off isBlank), an undesignated blank shows '?'.
export function displayFace(tile: Pick<Tile, 'face' | 'isBlank'> & { blankAs?: string }): string {
  if (tile.isBlank) {
    const as = (tile.blankAs ?? '').trim().toUpperCase()
    return /^[A-Z]$/.test(as) ? as : '?'
  }
  return tile.face
}

// Committed board grid as an algebra→letter map for the Board renderer.
export function boardToTiles(board: BoardGrid): Record<string, string> {
  const tiles: Record<string, string> = {}
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board[row][col]
      if (cell !== null) tiles[toAlgebra(row, col)] = cell.letter
    }
  }
  return tiles
}

function normalizeSquare(sq: string): string | null {
  try {
    const { row, col } = parseSquare(sq)
    return toAlgebra(row, col)
  } catch {
    return null
  }
}

// Row/col pair (`{r,c}` aliases) checked without throwing, mirroring
// `parseSquare` bounds so hostile frames skip instead of crashing.
function rowColAlgebra(obj: Record<string, unknown>): string | null {
  const rowRaw = obj['row'] ?? obj['r']
  const colRaw = obj['col'] ?? obj['c']
  const row = typeof rowRaw === 'number' ? rowRaw : Number(rowRaw)
  const col = typeof colRaw === 'number' ? colRaw : Number(colRaw)
  if (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  ) {
    return toAlgebra(row, col)
  }
  return null
}

// Snapshot square (issue #14): algebra (`square`/`sq`, plain or nested)
// or a flat `{row,col}` pair, exactly as `boardTilesFor` emits.
function snapshotSquare(entry: Record<string, unknown>): string | null {
  const raw = entry['square'] ?? entry['sq']
  if (typeof raw === 'string') return normalizeSquare(raw)
  if (typeof raw === 'object' && raw !== null) {
    const nested = rowColAlgebra(raw as Record<string, unknown>)
    if (nested !== null) return nested
  }
  return rowColAlgebra(entry)
}

function cleanLetter(letter: string | undefined): string | null {
  if (letter === undefined) return null
  const l = letter.trim().toUpperCase()
  return /^[A-Z]$/.test(l) ? l : null
}

export function provScoreText(score: number): string {
  return `${score} pts`
}

export const gameStore = createStore<GameStoreState>()((set, get) => {
  function commitState(
    rack: Tile[],
    pending: PendingTile[],
    selectedRack: number | null,
  ): void {
    const { score, words } = provisional(get().board, pending)
    set({ rack, pending, selectedRack, provScore: score, provWords: words })
  }

  function insertTile(rackIndex: number, sq: string, blankAs?: string): boolean {
    const { rack, pending } = get()
    if (!Number.isInteger(rackIndex) || rackIndex < 0 || rackIndex >= rack.length) {
      return false
    }
    const norm = normalizeSquare(sq)
    if (norm === null) return false
    if (pending.some((p) => p.sq === norm)) return false
    const tile = rack[rackIndex]
    if (tile.isBlank) {
      // Legacy tap path parks undesignated blanks (issue #7); the Table
      // UI intercepts blanks before placeTile and only calls placeTileAs
      // once the picker resolves a letter, so gameplay never leaves an
      // undesignated pending blank behind.
      if (blankAs !== undefined && !/^[A-Z]$/.test(blankAs)) return false
    } else if (blankAs !== undefined) {
      return false
    }
    const entry: PendingTile = {
      id: nextPendingId++,
      face: tile.face,
      isBlank: tile.isBlank,
      sq: norm,
    }
    if (tile.isBlank && blankAs !== undefined) entry.blankAs = blankAs
    commitState(
      rack.filter((_, i) => i !== rackIndex),
      [...pending, entry],
      null,
    )
    return true
  }

  return {
    rack: [],
    pending: [],
    selectedRack: null,
    provScore: 0,
    provWords: [],
    board: emptyGrid(),
    lastMove: [],
    lastScore: null,

    setRack: (faces) => {
      const rack: Tile[] = []
      for (const face of faces.slice(0, 7)) {
        const tile = tileOf(face)
        if (tile) rack.push(tile)
      }
      commitState(rack, [], null)
    },

    selectRack: (index) => {
      if (index === null) {
        set({ selectedRack: null })
        return
      }
      const { rack } = get()
      if (!Number.isInteger(index) || index < 0 || index >= rack.length) return
      set({ selectedRack: index })
    },

    placeTile: (rackIndex, sq) => insertTile(rackIndex, sq),

    placeTileAs: (rackIndex, sq, letter) => {
      const { rack } = get()
      const tile = rack[rackIndex]
      if (!tile) return false
      if (!tile.isBlank) return letter === undefined ? insertTile(rackIndex, sq) : false
      const clean = cleanLetter(letter)
      if (clean === null) return false
      return insertTile(rackIndex, sq, clean)
    },

    designateBlank: (pendingId, letter) => {
      const clean = cleanLetter(letter)
      if (clean === null) return false
      const { rack, pending, selectedRack } = get()
      const found = pending.find((p) => p.id === pendingId)
      if (!found || !found.isBlank) return false
      commitState(
        rack,
        pending.map((p) => (p.id === pendingId ? { ...p, blankAs: clean } : p)),
        selectedRack,
      )
      return true
    },

    returnTile: (pendingId) => {
      const { rack, pending, selectedRack } = get()
      const found = pending.find((p) => p.id === pendingId)
      if (!found) return
      const returned: Tile = { face: found.face, isBlank: found.isBlank }
      commitState(
        [...rack, returned],
        pending.filter((p) => p.id !== pendingId),
        selectedRack,
      )
    },

    recall: () => {
      const { rack, pending } = get()
      if (pending.length === 0) {
        set({ selectedRack: null })
        return
      }
      // Pending is stored in placement order, so the rack regrows in the
      // order the tiles were placed.
      const returned: Tile[] = pending.map((p) => ({ face: p.face, isBlank: p.isBlank }))
      commitState([...rack, ...returned], [], null)
    },

    shuffle: () => {
      const { rack, pending, selectedRack, board } = get()
      const next = [...rack]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      const { score, words } = provisional(board, pending)
      set({
        rack: next,
        provScore: score,
        provWords: words,
        selectedRack:
          selectedRack !== null && selectedRack < next.length ? selectedRack : null,
      })
    },

    reset: () => {
      const { rack, pending } = get()
      const returned: Tile[] = pending.map((p) => ({ face: p.face, isBlank: p.isBlank }))
      bag = new TileBag(1)
      commitState([...rack, ...returned], [], null)
      set({ board: emptyGrid(), lastMove: [], lastScore: null })
    },

    // Online projection (issue #14): rebuild board + rack from the
    // server's authoritative `state_sync` snapshot. Unknown squares
    // and bad letters are skipped, never thrown. Server state wins,
    // so local pending predictions clear and highlight ownership
    // resets (`lastMove` = snapshot squares, `lastScore` = null).
    applyStateSync: (snapshot) => {
      const tiles = Array.isArray(snapshot.board_tiles)
        ? snapshot.board_tiles
        : []
      const grid = emptyGrid()
      const squares: string[] = []
      for (const entry of tiles) {
        if (typeof entry !== 'object' || entry === null) continue
        const sq = snapshotSquare(entry as Record<string, unknown>)
        if (sq === null) continue
        const rawLetter = (entry as Record<string, unknown>)['letter']
        const letter =
          typeof rawLetter === 'string' ? cleanLetter(rawLetter) : null
        if (letter === null) continue
        const { row, col } = parseSquare(sq)
        grid[row][col] = {
          letter,
          blank: (entry as Record<string, unknown>)['blank'] === true,
        }
        squares.push(sq)
      }
      const faces = Array.isArray(snapshot.rack) ? snapshot.rack : []
      const rack: Tile[] = []
      for (const face of faces) {
        if (typeof face === 'string') {
          const tile = tileOf(face)
          if (tile) rack.push(tile)
        } else if (typeof face === 'object' && face !== null) {
          const obj = face as Record<string, unknown>
          if (obj['isBlank'] === true || obj['face'] === '?') {
            rack.push({ face: '?', isBlank: true })
          } else if (typeof obj['face'] === 'string') {
            const tile = tileOf(obj['face'])
            if (tile) rack.push(tile)
          }
        }
      }
      set({
        board: grid,
        rack: rack.slice(0, 7),
        pending: [],
        selectedRack: null,
        provScore: 0,
        provWords: [],
        lastMove: squares,
        lastScore: null,
      })
    },

    // Session projection (issue #85): install the engine snapshot's board
    // and turn-seat rack as the placement scratch. Pending, selection and
    // the provisional chip clear (a turn change or commit leaves nothing
    // in flight); lastMove/lastScore are preserved so the caller can set
    // them from the commit result after syncing.
    syncFromSession: (board: BoardGrid, rack: Tile[]) => {
      const grid = board.map((row) =>
        row.map((cell) => (cell === null ? null : { ...cell })),
      )
      set({
        board: grid,
        rack: rack.slice(0, 7).map((t) => ({ ...t })),
        pending: [],
        selectedRack: null,
        provScore: 0,
        provWords: [],
      })
    },
    // Leave an online room: drop the authoritative board/rack without
    // touching the offline bag, so a later offline loop redeals fresh.
    resetOnline: () => {
      set({
        board: emptyGrid(),
        rack: [],
        pending: [],
        selectedRack: null,
        provScore: 0,
        provWords: [],
        lastMove: [],
        lastScore: null,
      })
    },

    commit: () => {
      const { rack, pending, board } = get()
      if (pending.length === 0) return { ok: false, reason: 'EMPTY_MOVE' }
      const check = validateMove(board, toPlacements(pending), isLegalWord)
      if (!check.ok) {
        // An undesignated blank is a picker problem, not a refusal: keep
        // the pending tiles so the picker can resolve them in place.
        if (check.reason === 'BLANK_NO_LETTER') {
          return { ok: false, reason: check.reason, word: check.word }
        }
        // Refused words slide back to the rack (recall), then the Table
        // layer shakes the rack and raises the toast.
        get().recall()
        return { ok: false, reason: check.reason, word: check.word }
      }
      const next = board.map((row) => row.slice())
      for (const p of pending) {
        const { row, col } = parseSquare(p.sq)
        const letter = p.isBlank ? (p.blankAs ?? '').trim().toUpperCase() : p.face
        next[row][col] = { letter, blank: p.isBlank }
      }
      const squares = pending.map((p) => p.sq)
      const refills = bag.draw(pending.length)
      set({
        board: next,
        lastMove: squares,
        lastScore: check.score,
        rack: [...rack, ...refills],
        pending: [],
        selectedRack: null,
        provScore: 0,
        provWords: [],
      })
      return { ok: true, points: check.score, words: [...check.words] }
    },
  }
})
