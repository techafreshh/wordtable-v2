// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

import { Game, GameStatus, type GameEndReason } from './game'
import { BOARD_SIZE, parseSquare } from './board'
import {
  validateMove,
  type BoardCell,
  type BoardGrid,
  type Lexicon,
  type Placement,
} from './rules'
import type { Tile } from './bag'

// One tile the player commits to a square. `square` accepts `H8` algebra
// (letter- or digit-first, case-tolerant) or raw `{row, col}` coordinates.
// Blanks are addressed by face `'?'` with `as` giving the played letter.
export interface PlaceSpec {
  square: string | { row: number; col: number }
  face: string
  as?: string
}

export type PlaceOk = {
  ok: true
  points: number
  words: string[]
  bingo: boolean
  turn: number
  scores: number[]
}
export type PassOk = { ok: true; turn: number; scores: number[] }
export type ExchangeOk = { ok: true; turn: number; scores: number[]; rack: Tile[] }
export type RecallOk = { ok: true; recalled: number; rack: Tile[] }
export type ShuffleOk = { ok: true; rack: Tile[] }
export type ChatOk = { ok: true; seat: number; from: string; text: string; ts: number }
export type RematchOk = { ok: true; turn: number; scores: number[]; bagRemaining: number }
export type IntentFail = { ok: false; reason: string; word?: string }

export type IntentResult =
  | PlaceOk
  | PassOk
  | ExchangeOk
  | RecallOk
  | ShuffleOk
  | ChatOk
  | RematchOk
  | IntentFail

export type LocalEventType =
  | 'placed'
  | 'passed'
  | 'exchanged'
  | 'recalled'
  | 'shuffled'
  | 'chat'
  | 'ended'
  | 'rematch'

export interface LocalEvent {
  type: LocalEventType
  seat: number
  turn: number
  scores: number[]
  points?: number
  words?: string[]
  text?: string
  from?: string
  endReason?: GameEndReason | null
  winner?: number | null
}

export interface ChatMessage {
  seat: number
  from: string
  text: string
  ts: number
}

export interface LocalSnapshot {
  names: string[]
  turn: number
  scores: number[]
  status: GameStatus
  endReason: GameEndReason | null
  winner: number | null
  scorelessStreak: number
  racks: Tile[][]
  bagRemaining: number
  board: BoardGrid
  chat: ChatMessage[]
}

// Thin intent entrypoint over the Game state machine. Turn, scoring, endings
// and the bag live in Game; the facade owns the board grid, rack-ownership
// checks, the lexicon predicate, the chat log, the event history and a
// minimal emitter. recall/shuffle/chat never advance the turn.
export class LocalGame {
  readonly game: Game
  readonly names: string[]
  private _board: BoardGrid
  private isWord: Lexicon
  private chatLog: ChatMessage[] = []
  private _history: LocalEvent[] = []
  private listeners = new Map<LocalEventType, Set<(e: LocalEvent) => void>>()
  private rng: () => number

  constructor(names: string[], seed = 1, isWord: Lexicon = () => false) {
    this.names = names.map((n) => n.slice(0, 16))
    this.game = new Game(names.length, seed)
    this.rng = mulberry32(seed)
    this.isWord = isWord
    this._board = emptyBoard()
  }

  get history(): LocalEvent[] {
    return this._history.map((e) => ({ ...e, scores: [...e.scores] }))
  }

  on(type: LocalEventType, fn: (e: LocalEvent) => void): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn)
    return () => this.off(type, fn)
  }

  off(type: LocalEventType, fn?: (e: LocalEvent) => void): void {
    if (fn === undefined) {
      this.listeners.delete(type)
      return
    }
    this.listeners.get(type)?.delete(fn)
  }

  place(seat: number, specs: PlaceSpec[]): IntentResult {
    if (this.game.status !== GameStatus.PLAYING) {
      return { ok: false, reason: 'BAD_STATE' }
    }
    if (seat !== this.game.turn) return { ok: false, reason: 'NOT_YOUR_TURN' }
    let resolved: { placement: Placement; index: number }[] | null
    try {
      resolved = this.resolveSpecs(seat, specs)
    } catch {
      return { ok: false, reason: 'BAD_TILES' }
    }
    if (resolved === null) return { ok: false, reason: 'BAD_TILES' }
    const placements = resolved.map((r) => r.placement)
    const check = validateMove(this._board, placements, this.isWord)
    if (!check.ok) return { ok: false, reason: check.reason, word: check.word }
    for (const p of placements) {
      const letter = p.tile.isBlank
        ? (p.tile.blankAs ?? '').trim().toUpperCase()
        : p.tile.face.trim().toUpperCase()
      this._board[p.row][p.col] = { letter, blank: p.tile.isBlank }
    }
    const indices = resolved.map((r) => r.index)
    const committed = this.game.scoreMove(seat, indices, check.score)
    if (!committed.ok) {
      for (const p of placements) this._board[p.row][p.col] = null
      return { ok: false, reason: committed.reason }
    }
    this.emit({
      type: 'placed',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
      points: check.score,
      words: [...check.words],
    })
    this.maybeEmitEnded(seat)
    return {
      ok: true,
      points: check.score,
      words: [...check.words],
      bingo: check.bingo,
      turn: this.game.turn,
      scores: [...this.game.scores],
    }
  }

  pass(seat: number): IntentResult {
    const result = this.game.pass(seat)
    if (!result.ok) return { ok: false, reason: result.reason }
    this.emit({
      type: 'passed',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
    })
    this.maybeEmitEnded(seat)
    return { ok: true, turn: this.game.turn, scores: [...this.game.scores] }
  }

  exchange(seat: number, faces: string[] | number): IntentResult {
    if (this.game.status !== GameStatus.PLAYING) {
      return { ok: false, reason: 'BAD_STATE' }
    }
    if (seat !== this.game.turn) return { ok: false, reason: 'NOT_YOUR_TURN' }
    // Game.exchange swaps the front of the rack, so rotate the requested
    // faces to the front; restore the order if delegation refuses.
    const rack = this.game.racks[seat]
    const before = [...rack]
    let count: number
    if (typeof faces === 'number') {
      count = faces
    } else {
      const indices = this.matchFaces(seat, faces)
      if (indices === null) return { ok: false, reason: 'BAD_TILES' }
      count = indices.length
      const matched = indices.map((i) => rack[i])
      const rest = rack.filter((_, i) => !indices.includes(i))
      rack.splice(0, rack.length, ...matched, ...rest)
    }
    const result = this.game.exchange(seat, count)
    if (!result.ok) {
      rack.splice(0, rack.length, ...before)
      return { ok: false, reason: result.reason }
    }
    this.emit({
      type: 'exchanged',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
    })
    this.maybeEmitEnded(seat)
    return {
      ok: true,
      turn: this.game.turn,
      scores: [...this.game.scores],
      rack: copyRack(this.game.racks[seat]),
    }
  }

  recall(seat: number): IntentResult {
    if (!this.validSeat(seat)) return { ok: false, reason: 'BAD_STATE' }
    const rack = copyRack(this.game.racks[seat])
    this.emit({
      type: 'recalled',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
    })
    return { ok: true, recalled: 0, rack }
  }

  shuffle(seat: number): IntentResult {
    if (!this.validSeat(seat)) return { ok: false, reason: 'BAD_STATE' }
    const rack = this.game.racks[seat]
    for (let i = rack.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[rack[i], rack[j]] = [rack[j], rack[i]]
    }
    const copy = copyRack(rack)
    this.emit({
      type: 'shuffled',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
    })
    return { ok: true, rack: copy }
  }

  chat(seat: number, text: string): IntentResult {
    if (!this.validSeat(seat)) return { ok: false, reason: 'BAD_STATE' }
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') return { ok: false, reason: 'BAD_TEXT' }
    const message: ChatMessage = {
      seat,
      from: this.names[seat],
      text: trimmed.slice(0, 200),
      ts: Date.now(),
    }
    this.chatLog.push(message)
    this.emit({
      type: 'chat',
      seat,
      turn: this.game.turn,
      scores: [...this.game.scores],
      text: message.text,
      from: message.from,
    })
    return { ok: true, seat, from: message.from, text: message.text, ts: message.ts }
  }

  rematch(): IntentResult {
    this.game.rematch()
    this._board = emptyBoard()
    this.emit({
      type: 'rematch',
      seat: -1,
      turn: this.game.turn,
      scores: [...this.game.scores],
    })
    return {
      ok: true,
      turn: this.game.turn,
      scores: [...this.game.scores],
      bagRemaining: this.game.bagRemaining(),
    }
  }

  getState(): LocalSnapshot {
    return {
      names: [...this.names],
      turn: this.game.turn,
      scores: [...this.game.scores],
      status: this.game.status,
      endReason: this.game.endReason,
      winner: this.game.winner,
      scorelessStreak: this.game.scorelessStreak,
      racks: this.game.racks.map(copyRack),
      bagRemaining: this.game.bagRemaining(),
      board: this._board.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
      chat: this.chatLog.map((m) => ({ ...m })),
    }
  }

  private validSeat(seat: number): boolean {
    return Number.isInteger(seat) && seat >= 0 && seat < this.game.numPlayers
  }

  // Match requested faces to unused rack indices in order. `'?'` addresses a
  // blank; any other face matches a same-letter tile. Returns null on miss.
  private matchFaces(seat: number, faces: string[]): number[] | null {
    const rack = this.game.racks[seat]
    const used = new Array<boolean>(rack.length).fill(false)
    const indices: number[] = []
    for (const raw of faces) {
      const face = String(raw).trim().toUpperCase()
      let found = -1
      for (let i = 0; i < rack.length; i++) {
        if (used[i]) continue
        const tile = rack[i]
        if (face === '?') {
          if (tile.isBlank) {
            found = i
            break
          }
        } else if (!tile.isBlank && tile.face.toUpperCase() === face) {
          found = i
          break
        }
      }
      if (found < 0) return null
      used[found] = true
      indices.push(found)
    }
    return indices
  }

  private resolveSpecs(
    seat: number,
    specs: PlaceSpec[],
  ): { placement: Placement; index: number }[] | null {
    const indices = this.matchFaces(
      seat,
      specs.map((s) => s.face),
    )
    if (indices === null) return null
    return specs.map((spec, k) => {
      const tile = this.game.racks[seat][indices[k]]
      const coord =
        typeof spec.square === 'string' ? parseSquare(spec.square) : spec.square
      const placement: Placement = tile.isBlank
        ? {
            row: coord.row,
            col: coord.col,
            tile: {
              face: '?',
              isBlank: true,
              blankAs: (spec.as ?? '').trim().toUpperCase(),
            },
          }
        : {
            row: coord.row,
            col: coord.col,
            tile: { face: tile.face.toUpperCase(), isBlank: false },
          }
      return { placement, index: indices[k] }
    })
  }

  private maybeEmitEnded(seat: number): void {
    if (this.game.status === GameStatus.ENDED) {
      this.emit({
        type: 'ended',
        seat,
        turn: this.game.turn,
        scores: [...this.game.scores],
        endReason: this.game.endReason,
        winner: this.game.winner,
      })
    }
  }

  private emit(event: LocalEvent): void {
    this._history.push(event)
    const listeners = this.listeners.get(event.type)
    if (listeners) {
      for (const fn of [...listeners]) fn(event)
    }
  }
}

function emptyBoard(): BoardGrid {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array<BoardCell | null>(BOARD_SIZE).fill(null),
  )
}

function copyRack(rack: Tile[]): Tile[] {
  return rack.map((t) => ({ ...t }))
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
