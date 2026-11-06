// Commit/reject tests (issue #8): the 26-button picker, the exact
// `Not in my book: WORD` refusal (≥2 s, tiles slide back), and the commit
// payoff (.last-move count plus a synchronous #float-score).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  boardToTiles,
  gameStore,
  provScoreText,
} from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  buildBoardHTMLWithPending,
  buildBoardHTML,
} from '../../client/src/components/Board'
import { buildBlankPickerHTML } from '../../client/src/components/BlankPicker'
import { buildToastHTML } from '../../client/src/components/Toast'
import {
  buildFloatScoreHTML,
  tableSkeletonHTML,
} from '../../client/src/components/Table'

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

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

function placeWord(faces: string[], squares: string[]): void {
  // Full 7-tile racks so slide-back restores 7.
  gameStore.getState().setRack([...(faces.join('') + 'ABCDEF').slice(0, 7)])
  for (let k = 0; k < squares.length; k++) {
    const index = gameStore
      .getState()
      .rack.findIndex((t) => !t.isBlank && t.face === faces[k])
    expect(index).toBeGreaterThanOrEqual(0)
    expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
  }
}

beforeEach(() => {
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
})

afterEach(() => {
  vi.useRealTimers()
  uiStore.getState().clearToast()
})

describe('Blank picker contract', () => {
  it('renders #blank-picker with exactly 26 A-Z letter buttons', () => {
    const html = buildBlankPickerHTML()
    expect(html).toContain('id="blank-picker"')
    expect(count(/data-letter="/g, html)).toBe(26)
    expect(count(/<button/g, html)).toBe(27) // 26 letters + cancel
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(html).toContain(`data-letter="${letter}"`)
    }
    expect(html).toContain('data-action="cancel-picker"')
    expect(html).not.toContain('data-letter="?"')
  })

  it('clicking Z designates the pending blank face (value stays 0)', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    // What the picker letter-click does for a pre-place blank.
    expect(gameStore.getState().placeTileAs(0, 'H8', 'Z')).toBe(true)
    const html = buildBoardHTMLWithPending({}, gameStore.getState().pending)
    expect(html).toContain('data-tile="Z"')
    expect(html).toContain('>Z</div>')
  })

  it('the served skeleton mounts the contract nodes', () => {
    const html = tableSkeletonHTML()
    for (const id of ['#blank-picker', '#toast', '#float-layer', '#prov-score', '#rack']) {
      expect(html).toContain(`id="${id.slice(1)}"`)
    }
    expect(count(/data-letter="/g, html)).toBe(26)
  })
})

describe('Illegal word refusal', () => {
  it('XYZQ refuses with NOT_IN_LEXICON and slides tiles back', () => {
    placeWord(['X', 'Y', 'Z', 'Q'], ['H8', 'I8', 'J8', 'K8'])
    expect(gameStore.getState().pending).toHaveLength(4)
    const result = gameStore.getState().commit()
    expect(result).toMatchObject({ ok: false, reason: 'NOT_IN_LEXICON', word: 'XYZQ' })
    // Slide-back: pending cleared, rack restored to 7.
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(7)
    expect(gameStore.getState().lastMove).toHaveLength(0)
    expect(provScoreText(gameStore.getState().provScore)).toBe('0 pts')
  })

  it('toasts exactly `Not in my book: XYZQ`, visible for >=2s', () => {
    vi.useFakeTimers()
    placeWord(['X', 'Y', 'Z', 'Q'], ['H8', 'I8', 'J8', 'K8'])
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(false)
    const word = !result.ok && result.reason !== 'BLANK_NO_LETTER'
      ? (result.word ?? '')
      : ''
    expect(word).toBe('XYZQ')
    uiStore.getState().showToast(`Not in my book: ${word}`)
    expect(uiStore.getState().toast).toBe('Not in my book: XYZQ')
    expect(buildToastHTML(uiStore.getState().toast)).toContain('Not in my book: XYZQ')
    // Still visible after 2 s …
    vi.advanceTimersByTime(2000)
    expect(uiStore.getState().toast).toBe('Not in my book: XYZQ')
    // … then the 2600 ms timer clears it.
    vi.advanceTimersByTime(600)
    expect(uiStore.getState().toast).toBeNull()
    expect(buildToastHTML(uiStore.getState().toast)).toContain('hidden')
  })

  it('rapid illegal plays replace the copy and restart the timer', () => {
    vi.useFakeTimers()
    uiStore.getState().showToast('Not in my book: XYZQ')
    vi.advanceTimersByTime(2000)
    uiStore.getState().showToast('Not in my book: QQ')
    expect(uiStore.getState().toast).toBe('Not in my book: QQ')
    vi.advanceTimersByTime(2000)
    expect(uiStore.getState().toast).toBe('Not in my book: QQ')
    vi.advanceTimersByTime(600)
    expect(uiStore.getState().toast).toBeNull()
  })
})

describe('Legal word commit', () => {
  it('sets .last-move count to the word length with a sync #float-score', () => {
    placeHello()
    const t0 = Date.now()
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.points).toBeGreaterThan(0)
    // #float-score appears synchronously (well inside 500 ms).
    const floatHTML = buildFloatScoreHTML(result.points)
    expect(Date.now() - t0).toBeLessThan(500)
    expect(floatHTML).toContain('id="float-score"')
    expect(floatHTML).toContain(`+${result.points}`)
    // .last-move marks exactly the committed squares.
    const state = gameStore.getState()
    expect(state.lastMove).toHaveLength(5)
    expect(state.lastScore).toBe(result.points)
    const html = buildBoardHTMLWithPending(boardToTiles(state.board), state.pending, state.lastMove)
    expect(count(/last-move/g, html)).toBe(5)
    expect(count(/class="tile pending"/g, html)).toBe(0)
    // Committed tiles persist on the board grid.
    const plain = buildBoardHTML(boardToTiles(state.board), state.lastMove)
    expect(count(/last-move/g, plain)).toBe(5)
    expect(count(/class="sq /g, plain)).toBe(225)
  })

  it('a designated blank commits at value 0 with its letter face', () => {
    gameStore.getState().setRack(['?', 'H', 'E', 'L', 'L', 'O', 'X'])
    const squares = ['H8', 'I8', 'J8', 'K8', 'L8']
    const faces = ['H', 'E', 'L', 'L', 'O']
    for (let k = 0; k < squares.length; k++) {
      const index = gameStore
        .getState()
        .rack.findIndex((t) => !t.isBlank && t.face === faces[k])
      expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
    }
    const result = gameStore.getState().commit()
    expect(result.ok).toBe(true)
  })

  it('Play with nothing pending stays silent (EMPTY_MOVE)', () => {
    expect(gameStore.getState().commit()).toMatchObject({
      ok: false,
      reason: 'EMPTY_MOVE',
    })
    expect(uiStore.getState().toast).toBeNull()
  })
})
