import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { gameStore, provScoreText } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import { buildTileHTML } from '../../client/src/components/Tile'
import {
  buildRackActionsHTML,
  buildRackHTML,
} from '../../client/src/components/Rack'
import { buildBoardHTMLWithPending } from '../../client/src/components/Board'

const CLIENT_STYLES = new URL('../../client/styles/', import.meta.url)
const SRC_STYLES = new URL('../../client/src/styles/', import.meta.url)

function css(dir: URL, name: string): string {
  return readFileSync(new URL(name, dir), 'utf8')
}

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

function sortedFaces(faces: string[]): string {
  return [...faces].sort().join('')
}

beforeEach(() => {
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
})

// Drags faces onto squares via the single placeTile path both drag-drop
// and tap-tap funnel through.
function dragTiles(faces: string[], squares: string[]): void {
  for (let k = 0; k < squares.length; k++) {
    const state = gameStore.getState()
    const index = state.rack.findIndex((t) => !t.isBlank && t.face === faces[k])
    expect(index).toBeGreaterThanOrEqual(0)
    expect(state.placeTile(index, squares[k])).toBe(true)
  }
}

describe('Rack placement', () => {
  it('places H-E-L-L-O on row 8 cols H-L: 5 pending and a matching prov chip', () => {
    gameStore.getState().setRack([...'HELLO??'])
    dragTiles(['H', 'E', 'L', 'L', 'O'], ['H8', 'I8', 'J8', 'K8', 'L8'])
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(5)
    expect(state.rack).toHaveLength(2)
    const html = buildBoardHTMLWithPending({}, state.pending)
    expect(count(/class="sq /g, html)).toBe(225)
    expect(count(/class="tile pending"/g, html)).toBe(5)
    expect(count(/data-pending="true"/g, html)).toBe(5)
    // The square itself never carries the pending class.
    expect(count(/class="sq[^"]*pending/g, html)).toBe(0)
    expect(provScoreText(state.provScore)).toMatch(/^[0-9]+ pts$/)
    expect(state.provScore).toBeGreaterThan(0)
  })

  it('recall returns pending tiles: 0 pending and 7 in the rack', () => {
    gameStore.getState().setRack([...'HELLO??'])
    dragTiles(['H', 'E', 'L', 'L', 'O'], ['H8', 'I8', 'J8', 'K8', 'L8'])
    gameStore.getState().recall()
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(0)
    expect(state.rack).toHaveLength(7)
    const board = buildBoardHTMLWithPending({}, state.pending)
    expect(count(/class="tile pending"/g, board)).toBe(0)
    expect(count(/data-pending="true"/g, board)).toBe(0)
    const rack = buildRackHTML(state.rack, state.selectedRack)
    expect(count(/data-rack-index="/g, rack)).toBe(7)
    expect(provScoreText(state.provScore)).toBe('0 pts')
  })

  it('shuffle keeps the same multiset and re-renders synchronously', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    const before = sortedFaces(gameStore.getState().rack.map((t) => t.face))
    const t0 = Date.now()
    gameStore.getState().shuffle()
    const state = gameStore.getState()
    const html = buildRackHTML(state.rack, state.selectedRack)
    const elapsed = Date.now() - t0
    expect(state.rack).toHaveLength(6)
    expect(sortedFaces(state.rack.map((t) => t.face))).toBe(before)
    for (const ch of 'ABCDEF') expect(html).toContain(`data-tile="${ch}"`)
    expect(count(/data-rack-index="/g, html)).toBe(6)
    expect(elapsed).toBeLessThan(500)
  })

  it('tap-select then square-click places through the shared path', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    gameStore.getState().selectRack(0)
    uiStore.getState().selectRack(0)
    expect(gameStore.getState().selectedRack).toBe(0)
    expect(uiStore.getState().selectedRack).toBe(0)
    // The Board square-click handler reads the same selection cursor.
    const selected =
      gameStore.getState().selectedRack ?? uiStore.getState().selectedRack
    expect(selected).toBe(0)
    expect(gameStore.getState().placeTile(selected ?? -1, 'H8')).toBe(true)
    gameStore.getState().selectRack(null)
    uiStore.getState().selectRack(null)
    expect(gameStore.getState().pending).toHaveLength(1)
    expect(gameStore.getState().selectedRack).toBeNull()
    expect(uiStore.getState().selectedRack).toBeNull()
    const html = buildBoardHTMLWithPending({}, gameStore.getState().pending)
    expect(count(/class="tile pending"/g, html)).toBe(1)
    expect(html).toContain('data-sq="H8" data-premium="STAR" data-pending="true"')
  })

  it('clears the tap-tap cursor on select-then-clear', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    gameStore.getState().selectRack(2)
    uiStore.getState().selectRack(2)
    gameStore.getState().selectRack(null)
    uiStore.getState().selectRack(null)
    expect(gameStore.getState().selectedRack).toBeNull()
    expect(uiStore.getState().selectedRack).toBeNull()
    expect(gameStore.getState().pending).toHaveLength(0)
  })

  it('ignores drops onto occupied squares', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(false)
    expect(gameStore.getState().placeTile(0, 'h8')).toBe(false)
    expect(gameStore.getState().pending).toHaveLength(1)
  })

  it('scores a blank without designation as 0 without throwing', () => {
    gameStore.getState().setRack(['?'])
    expect(() => gameStore.getState().placeTile(0, 'H8')).not.toThrow()
    const state = gameStore.getState()
    expect(state.pending).toHaveLength(1)
    expect(state.provScore).toBe(0)
    expect(provScoreText(state.provScore)).toMatch(/^[0-9]+ pts$/)
  })

  it('rejects out-of-range and unknown squares without mutating', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    expect(gameStore.getState().placeTile(9, 'H8')).toBe(false)
    expect(gameStore.getState().placeTile(0, 'Z99')).toBe(false)
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(6)
    expect(provScoreText(gameStore.getState().provScore)).toBe('0 pts')
  })
})

describe('Tile factory', () => {
  it('marks pending tiles with draggable hooks', () => {
    const html = buildTileHTML({ face: 'H', isBlank: false }, { pending: true })
    expect(html).toContain('class="tile pending"')
    expect(html).toContain('draggable="true"')
    expect(html).toContain('data-tile="H"')
  })

  it('renders blanks as ?', () => {
    expect(buildTileHTML({ face: '?', isBlank: true }, {})).toContain('>?<')
  })

  it('marks rack tiles with their index and selection', () => {
    const html = buildTileHTML(
      { face: 'A', isBlank: false },
      { selected: true, rackIndex: 2 },
    )
    expect(html).toContain('data-rack-index="2"')
    expect(html).toContain('class="tile selected"')
    expect(html).toContain('aria-selected="true"')
  })
})

describe('Rack DOM contract', () => {
  it('renders #rack tiles with data-rack-index and data-tile hooks', () => {
    gameStore.getState().setRack([...'ABCDEF'])
    const state = gameStore.getState()
    const html = buildRackHTML(state.rack, state.selectedRack)
    expect(html).toContain('id="rack"')
    expect(count(/data-rack-index="/g, html)).toBe(6)
    expect(count(/data-tile="/g, html)).toBe(6)
  })

  it('renders Recall/Shuffle buttons with exact labels and actions', () => {
    const html = buildRackActionsHTML()
    expect(html).toContain('data-action="recall"')
    expect(html).toContain('data-action="shuffle"')
    expect(html).toContain('>Recall<')
    expect(html).toContain('>Shuffle<')
  })
})

describe('Rack stylesheets', () => {
  it('ships the placement markers on both style paths', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const board = css(dir, 'board.css')
      for (const marker of [
        '.tile.pending',
        '.tile.selected',
        '#prov-score',
        '#rack',
        'touch-action: none',
        '@media (max-width: 480px)',
      ]) {
        expect(board).toContain(marker)
      }
    }
  })
})
