// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

import { TileBag, tileValue, type Tile } from './bag'

export const RACK_SIZE = 7

export enum GameStatus {
  PLAYING = 'PLAYING',
  ENDED = 'ENDED',
}

export enum GameEndReason {
  SIX_SCORELESS = 'SIX_SCORELESS',
  BAG_EMPTY_OUT = 'BAG_EMPTY_OUT',
}

export type GameActionResult = { ok: true } | { ok: false; reason: string }

export class Game {
  readonly numPlayers: number
  private seed: number
  private _bag: TileBag
  status: GameStatus = GameStatus.PLAYING
  endReason: GameEndReason | null = null
  scores: number[] = []
  turn = 0
  racks: Tile[][] = []
  scorelessStreak = 0
  winner: number | null = null

  constructor(numPlayers: number, seed = 1) {
    if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 4) {
      throw new RangeError(`Game: numPlayers must be 2-4, got ${numPlayers}`)
    }
    this.numPlayers = numPlayers
    this.seed = seed
    this._bag = new TileBag(seed)
    this.deal()
  }

  get bag(): TileBag {
    return this._bag
  }

  bagRemaining(): number {
    return this._bag.remaining()
  }

  pass(seat: number): GameActionResult {
    if (this.status !== GameStatus.PLAYING) return { ok: false, reason: 'BAD_STATE' }
    if (seat !== this.turn) return { ok: false, reason: 'NOT_YOUR_TURN' }
    this.scorelessStreak += 1
    if (this.scorelessStreak >= 6) {
      this.finishSixScoreless()
      return { ok: true }
    }
    this.turn = (seat + 1) % this.numPlayers
    return { ok: true }
  }

  exchange(seat: number, count: number): GameActionResult {
    if (this.status !== GameStatus.PLAYING) return { ok: false, reason: 'BAD_STATE' }
    if (seat !== this.turn) return { ok: false, reason: 'NOT_YOUR_TURN' }
    if (!Number.isInteger(count) || count < 1 || count > this.racks[seat].length) {
      return { ok: false, reason: 'BAD_STATE' }
    }
    if (this._bag.remaining() < 7) return { ok: false, reason: 'EXCHANGE_GATE' }
    const replacements = this._bag.draw(count)
    const old = this.racks[seat].splice(0, count)
    this.racks[seat].push(...replacements)
    this._bag.returnTiles(old)
    this.scorelessStreak += 1
    if (this.scorelessStreak >= 6) {
      this.finishSixScoreless()
      return { ok: true }
    }
    this.turn = (seat + 1) % this.numPlayers
    return { ok: true }
  }

  scoreMove(seat: number, indices: number[], points: number): GameActionResult {
    if (this.status !== GameStatus.PLAYING) return { ok: false, reason: 'BAD_STATE' }
    if (seat !== this.turn) return { ok: false, reason: 'NOT_YOUR_TURN' }
    const rack = this.racks[seat]
    const ordered = [...new Set(indices)].sort((a, b) => b - a)
    for (const i of ordered) {
      if (!Number.isInteger(i) || i < 0 || i >= rack.length) {
        return { ok: false, reason: 'BAD_STATE' }
      }
    }
    for (const i of ordered) rack.splice(i, 1)
    this.scores[seat] += points
    if (points > 0) this.scorelessStreak = 0
    else this.scorelessStreak += 1
    const need = RACK_SIZE - rack.length
    if (need > 0) rack.push(...this._bag.draw(need))
    if (this._bag.remaining() === 0 && this.racks[seat].length === 0) {
      this.finishBagEmptyOut(seat)
      return { ok: true }
    }
    if (this.scorelessStreak >= 6) {
      this.finishSixScoreless()
      return { ok: true }
    }
    this.turn = (seat + 1) % this.numPlayers
    return { ok: true }
  }

  rematch(): void {
    this._bag = new TileBag(this.seed)
    this.deal()
  }

  private deal(): void {
    this.scores = Array<number>(this.numPlayers).fill(0)
    this.racks = []
    for (let s = 0; s < this.numPlayers; s++) {
      this.racks.push(this._bag.draw(RACK_SIZE))
    }
    this.turn = 0
    this.scorelessStreak = 0
    this.winner = null
    this.endReason = null
    this.status = GameStatus.PLAYING
  }

  private finishSixScoreless(): void {
    for (let s = 0; s < this.numPlayers; s++) {
      this.scores[s] -= rackFaceValue(this.racks[s])
    }
    this.winner = null
    this.status = GameStatus.ENDED
    this.endReason = GameEndReason.SIX_SCORELESS
  }

  private finishBagEmptyOut(winner: number): void {
    let bonus = 0
    for (let s = 0; s < this.numPlayers; s++) {
      if (s === winner) continue
      const penalty = rackFaceValue(this.racks[s])
      this.scores[s] -= penalty
      bonus += penalty
    }
    this.scores[winner] += bonus
    this.winner = winner
    this.status = GameStatus.ENDED
    this.endReason = GameEndReason.BAG_EMPTY_OUT
  }
}

function rackFaceValue(rack: Tile[]): number {
  let sum = 0
  for (const tile of rack) sum += tileValue(tile)
  return sum
}
