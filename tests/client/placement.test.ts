// Placement loop tests (issue #8 over the issue #7 loop): tap-tile→tap-square
// creates pending, undesignated blanks never commit, picker designation
// renders the letter face at value 0, and Recall restores the rack.

import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore, provScoreText, displayFace } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import { tileValue } from '../../shared/engine/bag'
import { buildBoardHTMLWithPending } from '../../client/src/components/Board'
import { openBlankPickerFor } from '../../client/src/components/BlankPicker'

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

beforeEach(() => {
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
})

describe('Tap placement', () => {
  it('tap-tile then tap-square creates one pending tile and a prov chip', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    gameStore.getState().selectRack(0)
    uiStore.getState().selectRack(0)
    const selected = gameStore.getState().selectedRack ?? uiStore.getState().selectedRack
    expect(selected).toBe(0)
    expect(gameStore.getState().placeTile(selected ?? -1, 'H8')).toBe(true)
    gameStore.getState().selectRack(null)
    uiStore.getState().selectRack(null)
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0].sq).toBe('H8')
    expect(provScoreText(state.provScore)).toMatch(/^[0-9]+ pts$/)
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(count(/class="tile pending"/g, html)).toBe(1)
    expect(html).toContain('data-sq="H8" data-premium="STAR" data-pending="true"')
  })

  it('dropping a blank parks the picker instead of placing', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    openBlankPickerFor(0, 'H8')
    const blank = uiStore.getState().blankPending
    expect(blank).toMatchObject({ rackIndex: 0, sq: 'H8' })
    // Nothing landed until a letter is chosen.
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(3)
    uiStore.getState().closeBlankPicker()
    expect(uiStore.getState().blankPending).toBeNull()
  })

  it('a blank without a letter never commits (BLANK_NO_LETTER)', () => {
    gameStore.getState().setRack(['?', 'H', 'E', 'L', 'L', 'O'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    const result = gameStore.getState().commit()
    expect(result).toMatchObject({ ok: false, reason: 'BLANK_NO_LETTER' })
    // Kept in place so the picker can resolve it; nothing was written.
    expect(gameStore.getState().pending).toHaveLength(1)
    expect(gameStore.getState().lastMove).toHaveLength(0)
  })

  it('Z designation renders face Z with tile value 0', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    expect(gameStore.getState().placeTileAs(0, 'H8', 'Z')).toBe(true)
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(1)
    expect(displayFace(state.pending[0])).toBe('Z')
    expect(tileValue({ face: '?', isBlank: true, blankAs: 'Z' })).toBe(0)
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(html).toContain('data-tile="Z"')
    expect(html).toContain('data-blank="true"')
    expect(count(/class="tile pending"/g, html)).toBe(1)
  })

  it('designateBlank resolves an already-placed blank in place', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    const id = gameStore.getState().pending[0].id
    expect(gameStore.getState().designateBlank(id, 'Z')).toBe(true)
    expect(displayFace(gameStore.getState().pending[0])).toBe('Z')
    expect(gameStore.getState().designateBlank(id, '1')).toBe(false)
    expect(gameStore.getState().designateBlank(99999, 'Z')).toBe(false)
  })

  it('hook pending face matches DOM data-tile after Z designation', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    expect(gameStore.getState().placeTileAs(0, 'H8', 'Z')).toBe(true)
    const state = gameStore.getState()
    // getState() projects pending faces through displayFace, so the hook
    // reports the designated letter the DOM shows.
    expect(displayFace(state.pending[0])).toBe('Z')
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(html).toContain('data-tile="Z"')
  })

  it('late designation and undesignated blanks match hook and DOM', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    // Undesignated blank still reports '?' in both hook and DOM.
    expect(displayFace(gameStore.getState().pending[0])).toBe('?')
    expect(buildBoardHTMLWithPending({}, gameStore.getState().pending)).toContain(
      'data-tile="?"',
    )
    const id = gameStore.getState().pending[0].id
    expect(gameStore.getState().designateBlank(id, 'Z')).toBe(true)
    const state = gameStore.getState()
    expect(displayFace(state.pending[0])).toBe('Z')
    expect(buildBoardHTMLWithPending({}, state.pending)).toContain('data-tile="Z"')
  })

  it('placeTileAs rejects garbage letters and non-blanks with letters', () => {
    gameStore.getState().setRack(['?', 'A'])
    expect(gameStore.getState().placeTileAs(0, 'H8', '?')).toBe(false)
    expect(gameStore.getState().placeTileAs(0, 'H8', '')).toBe(false)
    expect(gameStore.getState().placeTileAs(1, 'H8', 'Z')).toBe(false)
    expect(gameStore.getState().pending).toHaveLength(0)
  })

  it('Recall clears pending and restores all 7 rack tiles', () => {
    gameStore.getState().setRack([...'HELLO??'])
    const faces = ['H', 'E', 'L', 'L', 'O']
    const squares = ['H8', 'I8', 'J8', 'K8', 'L8']
    for (let k = 0; k < squares.length; k++) {
      const index = gameStore.getState().rack.findIndex((t) => !t.isBlank && t.face === faces[k])
      expect(gameStore.getState().placeTile(index, squares[k])).toBe(true)
    }
    expect(gameStore.getState().pending).toHaveLength(5)
    gameStore.getState().recall()
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(0)
    expect(state.rack).toHaveLength(7)
    expect(provScoreText(state.provScore)).toBe('0 pts')
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(count(/class="tile pending"/g, html)).toBe(0)
  })
})
