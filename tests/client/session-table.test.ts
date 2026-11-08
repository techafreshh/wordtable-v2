// Session table proofs (issue #85): the offline hot-seat table renders a
// 7-tile rack and places through the shared FloatScore feedback over the
// session engine as commit authority. Headless by design: every proof runs
// through the UI stores alone (sessionStore + gameStore + uiStore) with no
// DOM, exactly like the scripted black-box probes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  gameStore,
  provScoreText,
  displayFace,
} from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  sessionStore,
  resetSessionForTests,
  BOT_PASS_MS,
} from '../../client/src/store/session'
import {
  buildHotSeatTableHTML,
  playCommitSession,
  sessionAllowsPlacement,
  syncGameFromSession,
} from '../../client/src/components/HotSeatTable'
import { buildBoardHTMLWithPending } from '../../client/src/components/Board'
import { buildFloatScoreHTML } from '../../client/src/components/FloatScore'
import { tileValue } from '../../shared/engine/bag'
import { GameStatus, GameEndReason } from '../../shared/engine/game'
import type { BoardGrid } from '../../shared/engine/rules'

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

// Seed 5 deals seat 0 `AWDTACN` (CAT through the star) and seat 1 a GAME
// reply; seed 24 deals seat 0 `SQXINOE` (QX is not a word); seed 1 deals
// seat 0 `ATER?OY` (blank + AT for the picker path).
function startHumanSeed5(bots: boolean[] = [false, false]): void {
  sessionStore.getState().startSession(['Ann', 'Bo'], bots, 5)
  syncGameFromSession()
}

function placeLetters(faces: string[], squares: string[]): void {
  for (let k = 0; k < squares.length; k++) {
    const index = gameStore
      .getState()
      .rack.findIndex((t) => !t.isBlank && t.face === faces[k])
    expect(index).toBeGreaterThanOrEqual(0)
    expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
  }
}

beforeEach(() => {
  resetSessionForTests()
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  uiStore.getState().clearToast()
  resetSessionForTests()
})

describe('session rack and sync', () => {
  it('sync installs the turn-seat rack and clears stale pending', () => {
    startHumanSeed5()
    expect(gameStore.getState().rack).toHaveLength(7)
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    expect(gameStore.getState().pending).toHaveLength(1)
    sessionStore.getState().passTurn()
    syncGameFromSession()
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(0)
    expect(state.selectedRack).toBeNull()
    expect(state.rack).toHaveLength(7)
    expect(provScoreText(state.provScore)).toBe('0 pts')
  })

  it('syncFromSession preserves the last-move highlight', () => {
    startHumanSeed5()
    placeLetters(['C', 'A', 'T'], ['H8', 'I8', 'J8'])
    playCommitSession()
    expect(gameStore.getState().lastMove).toHaveLength(3)
    syncGameFromSession()
    expect(gameStore.getState().lastMove).toHaveLength(3)
    expect(gameStore.getState().lastScore).toBeGreaterThan(0)
    expect(gameStore.getState().pending).toHaveLength(0)
  })

  it('gates placement on human turns only', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true])
    syncGameFromSession()
    expect(sessionAllowsPlacement()).toBe(true)
    sessionStore.getState().passTurn()
    expect(sessionAllowsPlacement()).toBe(false)
  })
})

describe('session placement and provisional', () => {
  it('tap and drag paths share one pending loop with a live prov chip', () => {
    startHumanSeed5()
    gameStore.getState().selectRack(0)
    const selected = gameStore.getState().selectedRack
    expect(selected).not.toBeNull()
    expect(gameStore.getState().placeTile(selected ?? -1, 'H8')).toBe(true)
    gameStore.getState().selectRack(null)
    const dragIndex = gameStore
      .getState()
      .rack.findIndex((t) => !t.isBlank && t.face === 'C')
    expect(gameStore.getState().placeTile(dragIndex, 'I8')).toBe(true)
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(2)
    expect(provScoreText(state.provScore)).toMatch(/^[0-9]+ pts$/)
    expect(state.provScore).toBeGreaterThan(0)
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(count(/class="tile pending"/g, html)).toBe(2)
    gameStore.getState().recall()
    const cleared = gameStore.getState()
    expect(cleared.pending).toHaveLength(0)
    expect(cleared.rack).toHaveLength(7)
    expect(provScoreText(cleared.provScore)).toBe('0 pts')
  })

  it('provisional validates against committed session tiles', () => {
    const grid: BoardGrid = Array.from({ length: 15 }, () =>
      Array.from({ length: 15 }, () => null),
    )
    for (let k = 0; k < 5; k++) {
      grid[7]![7 + k] = { letter: 'HELLO'[k], blank: false }
    }
    gameStore
      .getState()
      .syncFromSession(
        grid,
        [...'WEABCDF'].map((face) => ({ face, isBlank: false })),
      )
    const w = gameStore
      .getState()
      .rack.findIndex((t) => t.face === 'W')
    expect(gameStore.getState().placeTile(w, 'M8')).toBe(true)
    const e = gameStore
      .getState()
      .rack.findIndex((t) => t.face === 'E')
    expect(gameStore.getState().placeTile(e, 'N8')).toBe(true)
    const state = gameStore.getState()
    // Against an empty grid M8/N8 would refuse FIRST_MOVE_STAR (prov 0);
    // against HELLO the HELLOWE hook scores.
    expect(state.provScore).toBeGreaterThan(0)
    expect(state.provWords).toContain('HELLOWE')
  })

  it('shuffle preserves pending and recall restores the rack', () => {
    startHumanSeed5()
    const before = gameStore
      .getState()
      .rack.map((t) => (t.isBlank ? '?' : t.face))
      .sort()
      .join('')
    placeLetters(['C', 'A'], ['H8', 'I8'])
    gameStore.getState().shuffle()
    const shuffled = gameStore.getState()
    expect(shuffled.pending).toHaveLength(2)
    const combined = [
      ...shuffled.rack.map((t) => (t.isBlank ? '?' : t.face)),
      ...shuffled.pending.map((p) => displayFace(p)),
    ]
      .sort()
      .join('')
    expect(combined).toBe(before)
    gameStore.getState().recall()
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(0)
    expect(state.rack).toHaveLength(7)
    expect(provScoreText(state.provScore)).toBe('0 pts')
  })
})

describe('session commit', () => {
  it('legal commit scores, refills, and highlights the last move', () => {
    startHumanSeed5()
    placeLetters(['C', 'A', 'T'], ['H8', 'I8', 'J8'])
    playCommitSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.scores).toEqual([10, 0])
    expect(snap?.turn).toBe(1)
    expect(sessionStore.getState().wordHistory()).toEqual([
      { seat: 0, words: ['CAT'], points: 10 },
    ])
    const state = gameStore.getState()
    expect(state.rack).toHaveLength(7)
    expect(state.pending).toHaveLength(0)
    expect(state.lastMove).toHaveLength(3)
    expect(state.lastScore).toBe(10)
    const html = buildHotSeatTableHTML(snap!)
    expect(count(/last-move/g, html)).toBe(3)
    expect(count(/class="tile pending"/g, html)).toBe(0)
    const float = buildFloatScoreHTML(state.lastScore ?? 0)
    expect(float).toContain('id="float-score"')
    expect(float).toContain('+10')
  })

  it('illegal commit toasts the exact word and slides tiles back', () => {
    vi.useFakeTimers()
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false], 24)
    syncGameFromSession()
    placeLetters(['Q', 'X'], ['H8', 'I8'])
    playCommitSession()
    expect(uiStore.getState().toast).toBe('Not in my book: QX')
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(0)
    expect(state.rack).toHaveLength(7)
    const snap = sessionStore.getState().snapshot()
    expect(snap?.scores).toEqual([0, 0])
    expect(snap?.turn).toBe(0)
    // The refusal stays visible for >=2 s, then the toast timer clears it.
    vi.advanceTimersByTime(2000)
    expect(uiStore.getState().toast).toBe('Not in my book: QX')
    vi.advanceTimersByTime(600)
    expect(uiStore.getState().toast).toBeNull()
  })

  it('undesignated blank reopens the picker; designated blank is worth 0', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false], 1)
    syncGameFromSession()
    const blankIndex = gameStore.getState().rack.findIndex((t) => t.isBlank)
    expect(blankIndex).toBeGreaterThanOrEqual(0)
    expect(gameStore.getState().placeTile(blankIndex, 'H8')).toBe(true)
    playCommitSession()
    const parked = gameStore.getState().pending
    expect(parked).toHaveLength(1)
    expect(uiStore.getState().blankPending).toMatchObject({
      rackIndex: -1,
      sq: 'H8',
      pendingId: parked[0].id,
    })
    expect(gameStore.getState().designateBlank(parked[0].id, 'C')).toBe(true)
    uiStore.getState().closeBlankPicker()
    expect(tileValue({ face: '?', isBlank: true, blankAs: 'C' })).toBe(0)
    placeLetters(['A', 'T'], ['I8', 'J8'])
    playCommitSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.scores[0]).toBeGreaterThan(0)
    expect(snap?.turn).toBe(1)
    expect(snap?.board[7]?.[7]).toEqual({ letter: 'C', blank: true })
  })

  it('bot-seat commits are silently ignored', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true])
    syncGameFromSession()
    sessionStore.getState().passTurn()
    syncGameFromSession()
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    playCommitSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.turn).toBe(1)
    expect(snap?.scores).toEqual([0, 0])
    expect(uiStore.getState().toast).toBeNull()
  })

  it('geometry refusals slide back with no lexicon toast', () => {
    startHumanSeed5()
    placeLetters(['C'], ['H8'])
    playCommitSession()
    expect(uiStore.getState().toast).toBeNull()
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(7)
    expect(sessionStore.getState().snapshot()?.turn).toBe(0)
  })
})

describe('session endings and scripted play', () => {
  it('bot auto-move replies after a human commit', () => {
    vi.useFakeTimers()
    startHumanSeed5([false, true])
    placeLetters(['C', 'A', 'T'], ['H8', 'I8', 'J8'])
    playCommitSession()
    vi.advanceTimersByTime(BOT_PASS_MS)
    const snap = sessionStore.getState().snapshot()
    expect(snap?.turn).toBe(0)
    expect(snap?.scores).toEqual([10, 12])
    expect(sessionStore.getState().wordHistory()).toHaveLength(2)
    syncGameFromSession()
    expect(gameStore.getState().rack).toHaveLength(7)
  })

  it('six passes end the game and rematch reopens the table', () => {
    startHumanSeed5()
    for (let i = 0; i < 6; i++) sessionStore.getState().passTurn()
    const ended = sessionStore.getState().snapshot()
    expect(ended?.status).toBe(GameStatus.ENDED)
    expect(ended?.endReason).toBe(GameEndReason.SIX_SCORELESS)
    sessionStore.getState().rematch()
    const fresh = sessionStore.getState().snapshot()
    expect(fresh?.status).toBe(GameStatus.PLAYING)
    expect(fresh?.scores).toEqual([0, 0])
    syncGameFromSession()
    const html = buildHotSeatTableHTML(fresh!)
    expect(count(/data-rack-index="/g, html)).toBe(7)
    expect(html).toContain('id="pass-button"')
  })

  it('a scripted human→bot game completes via the stores alone', () => {
    vi.useFakeTimers()
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true], 5)
    syncGameFromSession()
    const commit = sessionStore.getState().placeMove([
      { square: 'H8', face: 'C' },
      { square: 'I8', face: 'A' },
      { square: 'J8', face: 'T' },
    ])
    expect(commit).toMatchObject({ ok: true, words: ['CAT'] })
    syncGameFromSession()
    vi.advanceTimersByTime(BOT_PASS_MS)
    syncGameFromSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.status).toBe(GameStatus.PLAYING)
    expect(snap?.turn).toBe(0)
    expect(snap?.scores).toEqual([10, 12])
    expect(sessionStore.getState().wordHistory().map((e) => e.words.join('/'))).toEqual([
      'CAT',
      'GAME',
    ])
    expect(gameStore.getState().rack).toHaveLength(7)
  })
})
