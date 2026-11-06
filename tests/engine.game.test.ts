import { describe, it, expect } from 'vitest'
import { Game, GameStatus, GameEndReason, RACK_SIZE } from '../shared/engine/game'
import { tileValue } from '../shared/engine/bag'

describe('Game state machine', () => {
  it('rejects seat counts outside 2-4', () => {
    expect(() => new Game(1)).toThrow(RangeError)
    expect(() => new Game(5)).toThrow(RangeError)
  })

  it('deals 7 tiles per seat from a 100-tile bag', () => {
    const game = new Game(2, 1)
    expect(game.status).toBe(GameStatus.PLAYING)
    expect(game.endReason).toBeNull()
    expect(game.scores).toEqual([0, 0])
    expect(game.turn).toBe(0)
    expect(game.racks.length).toBe(2)
    for (const rack of game.racks) expect(rack.length).toBe(RACK_SIZE)
    expect(game.bagRemaining()).toBe(100 - 7 * 2)
  })

  it('ends ENDED/SIX_SCORELESS after 6 consecutive scoreless turns', () => {
    const game = new Game(2, 1)
    for (let i = 0; i < 6; i++) {
      expect(game.pass(game.turn)).toEqual({ ok: true })
    }
    expect(game.status).toBe(GameStatus.ENDED)
    expect(game.status).toBe('ENDED')
    expect(game.endReason).toBe(GameEndReason.SIX_SCORELESS)
    expect(game.endReason).toBe('SIX_SCORELESS')
  })

  it('deducts remaining tiles on SIX_SCORELESS with no winner', () => {
    const game = new Game(2, 1)
    game.scoreMove(0, [0], 12)
    const before0 = game.scores[0]
    const before1 = game.scores[1]
    const pen0 = game.racks[0].reduce((s, t) => s + tileValue(t), 0)
    const pen1 = game.racks[1].reduce((s, t) => s + tileValue(t), 0)
    for (let i = 0; i < 6; i++) game.pass(game.turn)
    expect(game.status).toBe('ENDED')
    expect(game.endReason).toBe('SIX_SCORELESS')
    expect(game.winner).toBeNull()
    expect(game.scores[0]).toBe(before0 - pen0)
    expect(game.scores[1]).toBe(before1 - pen1)
  })

  it('a scoring move resets the scoreless streak', () => {
    const game = new Game(2, 1)
    game.pass(0)
    game.pass(1)
    expect(game.scorelessStreak).toBe(2)
    game.scoreMove(game.turn, [0], 5)
    expect(game.scorelessStreak).toBe(0)
    expect(game.status).toBe('PLAYING')
  })

  it('ends BAG_EMPTY_OUT when the bag is empty and the mover goes out, with tile bonus', () => {
    const game = new Game(2, 1)
    game.bag.draw(game.bag.remaining())
    expect(game.bagRemaining()).toBe(0)
    const oppValue = game.racks[1].reduce((s, t) => s + tileValue(t), 0)
    const result = game.scoreMove(0, [0, 1, 2, 3, 4, 5, 6], 10)
    expect(result).toEqual({ ok: true })
    expect(game.status).toBe('ENDED')
    expect(game.endReason).toBe('BAG_EMPTY_OUT')
    expect(game.winner).toBe(0)
    expect(game.scores[0]).toBe(10 + oppValue)
    expect(game.scores[1]).toBe(0 - oppValue)
  })

  it('rejects exchange when the bag holds fewer than 7 tiles', () => {
    const game = new Game(2, 5)
    game.bag.draw(game.bag.remaining() - 6)
    expect(game.bagRemaining()).toBe(6)
    const turnBefore = game.turn
    const result = game.exchange(game.turn, 1)
    expect(result).toEqual({ ok: false, reason: 'EXCHANGE_GATE' })
    expect(game.turn).toBe(turnBefore)
    expect(game.status).toBe('PLAYING')
  })

  it('exchange swaps tiles without changing the bag size', () => {
    const game = new Game(2, 9)
    const bagBefore = game.bagRemaining()
    const result = game.exchange(0, 3)
    expect(result).toEqual({ ok: true })
    expect(game.racks[0].length).toBe(7)
    expect(game.bagRemaining()).toBe(bagBefore)
    expect(game.turn).toBe(1)
  })

  it('rotates turns across 3 seats and rejects the wrong seat', () => {
    const game = new Game(3, 2)
    expect(game.turn).toBe(0)
    expect(game.pass(1)).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' })
    expect(game.turn).toBe(0)
    game.pass(0)
    expect(game.turn).toBe(1)
    game.pass(1)
    expect(game.turn).toBe(2)
    game.pass(2)
    expect(game.turn).toBe(0)
  })

  it('rejects any action on an ended game with BAD_STATE', () => {
    const game = new Game(2, 1)
    for (let i = 0; i < 6; i++) game.pass(game.turn)
    expect(game.status).toBe('ENDED')
    expect(game.pass(game.turn)).toEqual({ ok: false, reason: 'BAD_STATE' })
    expect(game.exchange(game.turn, 1)).toEqual({ ok: false, reason: 'BAD_STATE' })
    expect(game.scoreMove(game.turn, [0], 4)).toEqual({ ok: false, reason: 'BAD_STATE' })
  })

  it('rematch resets an ended game with a fresh bag', () => {
    const game = new Game(2, 1)
    for (let i = 0; i < 6; i++) game.pass(game.turn)
    expect(game.status).toBe('ENDED')
    game.rematch()
    expect(game.status).toBe('PLAYING')
    expect(game.scores).toEqual([0, 0])
    expect(game.bagRemaining()).toBe(100 - 7 * 2)
    expect(game.turn).toBe(0)
    expect(game.scorelessStreak).toBe(0)
    expect(game.winner).toBeNull()
    expect(game.endReason).toBeNull()
    for (const rack of game.racks) expect(rack.length).toBe(7)
  })
})
