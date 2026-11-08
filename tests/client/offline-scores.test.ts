// Offline score accumulation (issue #87): a successful offline commit
// credits the acting seat's strip score via uiStore.setScores, consecutive
// commits accumulate, refusals leave scores untouched, and reset() zeroes
// the strip with the board. Headless — same helpers as commit.test.ts.

import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'

// HELLO on row 8 through the center star: the canonical legal first move.
function placeHello(): void {
  gameStore.getState().setRack([...'HELLO??'])
  const faces = ['H', 'E', 'L', 'L', 'O']
  const squares = ['H8', 'I8', 'J8', 'K8', 'L8']
  for (let k = 0; k < squares.length; k++) {
    const index = gameStore
      .getState()
      .rack.findIndex((t) => !t.isBlank && t.face === faces[k])
    expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
  }
}

beforeEach(() => {
  uiStore.getState().resetTable()
  gameStore.getState().reset()
})

describe('offline score accumulation', () => {
  it('a successful commit credits the acting seat by the move points', () => {
    placeHello()
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.points).toBeGreaterThan(0)
    const scores = uiStore.getState().scores
    expect(scores[uiStore.getState().turn]).toBe(result.points)
    expect(scores.slice(1)).toEqual([0, 0, 0])
  })

  it('consecutive commits accumulate on the acting seat', () => {
    placeHello()
    const first = gameStore.getState().commit()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // Hook E under the H for vertical HE (both fallback words); setRack
    // preserves the committed board so the hook stays connected.
    gameStore.getState().setRack(['E', 'A', 'B', 'C', 'D', 'F', 'G'])
    const index = gameStore
      .getState()
      .rack.findIndex((t) => !t.isBlank && t.face === 'E')
    expect(gameStore.getState().placeTile(index, 'H9')).toBe(true)
    const second = gameStore.getState().commit()
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.points).toBeGreaterThan(0)
    expect(uiStore.getState().scores[0]).toBe(first.points + second.points)
  })

  it('credits the seat selected by setTurn', () => {
    uiStore.getState().setTurn(1)
    placeHello()
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(uiStore.getState().scores[1]).toBe(result.points)
    expect(uiStore.getState().scores[0]).toBe(0)
  })

  it('refusals leave scores untouched', () => {
    // NOT_IN_LEXICON slides back; strip stays zero.
    gameStore.getState().setRack([...'XYZQABC'])
    const faces = ['X', 'Y', 'Z', 'Q']
    const squares = ['H8', 'I8', 'J8', 'K8']
    for (let k = 0; k < squares.length; k++) {
      const index = gameStore
        .getState()
        .rack.findIndex((t) => !t.isBlank && t.face === faces[k])
      expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
    }
    expect(gameStore.getState().commit()).toMatchObject({
      ok: false,
      reason: 'NOT_IN_LEXICON',
    })
    expect(uiStore.getState().scores).toEqual([0, 0, 0, 0])

    // EMPTY_MOVE: nothing pending, nothing credited.
    expect(gameStore.getState().commit()).toMatchObject({
      ok: false,
      reason: 'EMPTY_MOVE',
    })
    expect(uiStore.getState().scores).toEqual([0, 0, 0, 0])

    // BLANK_NO_LETTER keeps pending in place; strip stays zero.
    gameStore.getState().setRack(['?', 'H', 'E', 'L', 'L', 'O'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    expect(gameStore.getState().commit()).toMatchObject({
      ok: false,
      reason: 'BLANK_NO_LETTER',
    })
    expect(uiStore.getState().scores).toEqual([0, 0, 0, 0])
  })

  it('reset() zeroes the strip scores with the board', () => {
    placeHello()
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(true)
    expect(uiStore.getState().scores[0]).toBeGreaterThan(0)
    gameStore.getState().reset()
    expect(uiStore.getState().scores).toEqual([0, 0, 0, 0])
    expect(gameStore.getState().board.flat().every((c) => c === null)).toBe(true)
    expect(gameStore.getState().lastScore).toBeNull()
  })
})
