import { describe, it, expect } from 'vitest'
import { LocalGame, type ChatOk, type PlaceSpec, type RecallOk } from '../shared/engine/local'
import { Dictionary } from '../shared/engine/dictionary'
import { validateMove, type BoardGrid } from '../shared/engine/rules'
import type { Tile } from '../shared/engine/bag'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function faceOf(tile: Tile): string {
  return tile.isBlank ? '?' : tile.face
}

// Brute-force a legal move through the validateMove oracle: center-covering
// pairs on an empty board, single tiles on anchor squares afterwards. Blanks
// expand over A-Z designations. Returns place-ready specs or null.
function findLegalMove(
  board: BoardGrid,
  rack: Tile[],
  isWord: (w: string) => boolean,
): PlaceSpec[] | null {
  let empty = true
  for (let r = 0; r < 15 && empty; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] !== null) {
        empty = false
        break
      }
    }
  }

  const variants = (tile: Tile): { tile: Tile; as?: string }[] => {
    if (!tile.isBlank) return [{ tile }]
    return LETTERS.split('').map((letter) => ({
      tile: { face: '?', isBlank: true, blankAs: letter },
      as: letter,
    }))
  }

  const attempt = (
    cells: { row: number; col: number }[],
    tiles: Tile[],
    designated: (string | undefined)[],
  ): PlaceSpec[] | null => {
    const placements = cells.map((cell, k) => ({ row: cell.row, col: cell.col, tile: tiles[k] }))
    const check = validateMove(board, placements, isWord)
    if (!check.ok) return null
    return cells.map((cell, k) => ({
      square: { row: cell.row, col: cell.col },
      face: '?',
      as: designated[k],
    }))
  }

  if (empty) {
    const pairs: { row: number; col: number }[][] = [
      [
        { row: 7, col: 6 },
        { row: 7, col: 7 },
      ],
      [
        { row: 7, col: 7 },
        { row: 7, col: 8 },
      ],
      [
        { row: 6, col: 7 },
        { row: 7, col: 7 },
      ],
      [
        { row: 7, col: 7 },
        { row: 8, col: 7 },
      ],
    ]
    for (const cells of pairs) {
      for (let i = 0; i < rack.length; i++) {
        for (let j = 0; j < rack.length; j++) {
          if (i === j) continue
          for (const vi of variants(rack[i])) {
            for (const vj of variants(rack[j])) {
              const specs = attempt(
                cells,
                [vi.tile, vj.tile],
                [vi.as, vj.as],
              )
              if (specs) {
                return specs.map((spec, k) => ({
                  ...spec,
                  face: faceOf(k === 0 ? rack[i] : rack[j]),
                }))
              }
            }
          }
        }
      }
    }
    return null
  }

  const occupied = (row: number, col: number): boolean =>
    row >= 0 && row < 15 && col >= 0 && col < 15 && board[row][col] !== null
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] !== null) continue
      if (
        !occupied(r - 1, c) &&
        !occupied(r + 1, c) &&
        !occupied(r, c - 1) &&
        !occupied(r, c + 1)
      ) {
        continue
      }
      for (const tile of rack) {
        for (const v of variants(tile)) {
          const placements = [{ row: r, col: c, tile: v.tile }]
          const check = validateMove(board, placements, isWord)
          if (check.ok) {
            return [{ square: { row: r, col: c }, face: faceOf(tile), as: v.as }]
          }
        }
      }
    }
  }
  return null
}

describe('LocalGame facade', () => {
  it('exposes the place/pass/exchange/recall/shuffle/chat/rematch intents', () => {
    const game = new LocalGame(['A', 'B', 'C'])
    for (const method of [
      'place',
      'pass',
      'exchange',
      'recall',
      'shuffle',
      'chat',
      'rematch',
    ] as const) {
      expect(typeof game[method], method).toBe('function')
    }
    expect(typeof game.on).toBe('function')
    expect(typeof game.off).toBe('function')
    expect(Array.isArray(game.history)).toBe(true)
    expect(game.getState().turn).toBe(0)
  })

  it('truncates player names to 16 chars', () => {
    const game = new LocalGame(['0123456789abcdefGHI', 'B'])
    expect(game.getState().names[0]).toBe('0123456789abcdef')
    expect(game.getState().names[0].length).toBe(16)
  })

  it('rejects a wrong-seat intent with NOT_YOUR_TURN', () => {
    const game = new LocalGame(['A', 'B'])
    expect(game.place(1, [])).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' })
    expect(game.pass(1)).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' })
    expect(game.exchange(1, 1)).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' })
  })

  it('rejects place with tiles not owned as BAD_TILES', () => {
    const game = new LocalGame(['A', 'B'])
    const owned = new Set(game.getState().racks[0].map((t) => faceOf(t)))
    const missing = LETTERS.split('').find((l) => !owned.has(l)) ?? 'Q'
    const before = game.getState()
    const result = game.place(0, [{ square: 'H8', face: missing }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('BAD_TILES')
    expect(game.getState().turn).toBe(before.turn)
    expect(game.history.length).toBe(0)
  })

  it('rejects exchange below the 7-tile gate with EXCHANGE_GATE', () => {
    const game = new LocalGame(['A', 'B'])
    game.game.bag.draw(game.game.bag.remaining() - 6)
    expect(game.game.bagRemaining()).toBe(6)
    const seat = game.getState().turn
    const before = game.getState().racks[seat].map((t) => faceOf(t))
    const faces = game.getState().racks[seat].slice(0, 2).map(faceOf)
    const result = game.exchange(seat, faces)
    expect(result).toEqual({ ok: false, reason: 'EXCHANGE_GATE' })
    expect(game.getState().turn).toBe(seat)
    expect(game.getState().racks[seat].map((t) => faceOf(t))).toEqual(before)
  })

  it('ends ENDED/SIX_SCORELESS after 6 facade passes', () => {
    const game = new LocalGame(['A', 'B'])
    for (let i = 0; i < 6; i++) {
      expect(game.pass(game.getState().turn)).toEqual({
        ok: true,
        turn: game.getState().turn,
        scores: game.getState().scores,
      })
    }
    const state = game.getState()
    expect(state.status).toBe('ENDED')
    expect(state.endReason).toBe('SIX_SCORELESS')
    expect(game.pass(state.turn)).toEqual({ ok: false, reason: 'BAD_STATE' })
    expect(game.history.filter((e) => e.type === 'passed').length).toBe(6)
    expect(game.history[game.history.length - 1].type).toBe('ended')
  })

  it('rematch resets an ended game, clears the board and keeps chat', () => {
    const game = new LocalGame(['A', 'B'], 1, () => true)
    const rack = game.getState().racks[0]
    const solid = rack
      .map((tile, index) => ({ tile, index }))
      .filter((entry) => !entry.tile.isBlank)
    expect(solid.length).toBeGreaterThanOrEqual(2)
    const placed = game.place(0, [
      { square: 'H8', face: faceOf(solid[0].tile) },
      { square: 'I8', face: faceOf(solid[1].tile) },
    ])
    expect(placed.ok).toBe(true)
    expect(game.getState().board.flat().some((cell) => cell !== null)).toBe(true)
    expect(game.chat(0, 'hello').ok).toBe(true)
    for (let i = 0; i < 6; i++) game.pass(game.getState().turn)
    expect(game.getState().status).toBe('ENDED')
    const result = game.rematch()
    expect(result.ok).toBe(true)
    const state = game.getState()
    expect(state.status).toBe('PLAYING')
    expect(state.scores).toEqual([0, 0])
    expect(state.turn).toBe(0)
    expect(state.bagRemaining).toBe(100 - 7 * 2)
    for (const row of state.racks) expect(row.length).toBe(7)
    expect(state.board.flat().every((cell) => cell === null)).toBe(true)
    expect(state.chat.map((m) => m.text)).toEqual(['hello'])
    expect(game.history.some((e) => e.type === 'rematch')).toBe(true)
  })

  it('recall and shuffle return the rack without advancing the turn', () => {
    const game = new LocalGame(['A', 'B'])
    const turn = game.getState().turn
    const recalled = game.recall(turn)
    expect(recalled.ok).toBe(true)
    if (recalled.ok) {
      const ok = recalled as RecallOk
      expect(ok.recalled).toBe(0)
      expect(ok.rack.length).toBe(7)
    }
    const shuffled = game.shuffle(turn)
    expect(shuffled.ok).toBe(true)
    expect(game.getState().turn).toBe(turn)
    expect(game.getState().scorelessStreak).toBe(0)
    expect(game.history.map((e) => e.type)).toEqual(['recalled', 'shuffled'])
  })

  it('chat truncates to 200 chars and rejects blank text with BAD_TEXT', () => {
    const game = new LocalGame(['A', 'B'])
    expect(game.chat(0, '   ')).toEqual({ ok: false, reason: 'BAD_TEXT' })
    const long = 'x'.repeat(250)
    const result = game.chat(1, long)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ok = result as ChatOk
      expect(ok.text.length).toBe(200)
      expect(ok.from).toBe('B')
    }
    expect(game.getState().chat.length).toBe(1)
  })

  it('chat truncates emoji runs to 200 code points without splitting surrogate pairs', () => {
    const game = new LocalGame(['A', 'B'])
    const result = game.chat(0, '😀'.repeat(250))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ok = result as ChatOk
      expect(Array.from(ok.text)).toHaveLength(200)
      expect(ok.text).toBe('😀'.repeat(200))
    }
    expect(game.chat(0, '   ')).toEqual({ ok: false, reason: 'BAD_TEXT' })
    expect(game.getState().chat.length).toBe(1)
  })

  it('emits placed events to on() listeners and detaches with off()', () => {
    const game = new LocalGame(['A', 'B'], 1, () => true)
    const seen: string[] = []
    const off = game.on('placed', (e) => seen.push(e.type))
    const rack = game.getState().racks[0]
    const solid = rack.filter((t) => !t.isBlank)
    game.place(0, [
      { square: 'H8', face: faceOf(solid[0]) },
      { square: 'I8', face: faceOf(solid[1]) },
    ])
    expect(seen).toEqual(['placed'])
    off()
    game.chat(0, 'hi')
    game.pass(1)
    expect(seen).toEqual(['placed'])
  })

  it('runs a scripted 3-player game to >=10 plies with no illegal states', async () => {
    const dict = await Dictionary.loadFromFile('dictionaries/sowpods.txt')
    const isWord = (w: string): boolean => dict.isWord(w)
    const game = new LocalGame(['A', 'B', 'C'], 7, isWord)
    let scoringPlies = 0
    for (let step = 0; step < 500; step++) {
      const state = game.getState()
      if (state.status !== 'PLAYING' || scoringPlies >= 12) break
      const seat = state.turn
      const move = findLegalMove(state.board, state.racks[seat], isWord)
      if (move !== null) {
        const result = game.place(seat, move)
        expect(result.ok, `illegal place at step ${step}: ${JSON.stringify(result)}`).toBe(true)
        if (result.ok) scoringPlies += 1
      } else if (state.bagRemaining >= 7) {
        const result = game.exchange(
          seat,
          state.racks[seat].map(faceOf),
        )
        expect(
          result.ok,
          `illegal exchange at step ${step}: ${JSON.stringify(result)}`,
        ).toBe(true)
      } else {
        const result = game.pass(seat)
        expect(result.ok, `illegal pass at step ${step}: ${JSON.stringify(result)}`).toBe(true)
      }
    }
    expect(scoringPlies).toBeGreaterThanOrEqual(10)
    expect(game.history.length).toBeGreaterThanOrEqual(10)
    expect(
      game.history.filter((e) => e.type === 'placed').length,
    ).toBeGreaterThanOrEqual(10)
  }, 30000)
})
