// Board view — pure DOM/CSS 15x15 club table, no WebGL/Three imports.
// Premium layout mirrors shared/engine/board.ts (kept literal here so the
// view stays dependency-free); the engine remains the scoring authority.
// Placement interactions (issue #7) delegate to the game store so drag-drop
// and tap-tap share one placeTile path.

import { gameStore, type PendingTile } from '../store/game'
import { uiStore } from '../store/ui'
import { buildTileHTML, getActiveDragIndex, getTileDragPayload, setActiveDragIndex } from './Tile'

export const BOARD_SIZE = 15

export type PremiumKind = 'TW' | 'DW' | 'TL' | 'DL' | 'STAR' | 'PLAIN'

// Legend: '3' = triple word, '2' = double word, 't' = triple letter,
// 'd' = double letter, '*' = center star (H8), '.' = plain square.
const PREMIUM_LEGEND: readonly string[] = [
  '3..d...3...d..3',
  '.2...t...t...2.',
  '..2...d.d...2..',
  'd..2...d...2..d',
  '....2.....2....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  '3..d...*...d..3',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....2.....2....',
  'd..2...d...2..d',
  '..2...d.d...2..',
  '.2...t...t...2.',
  '3..d...3...d..3',
]

function checkBounds(row: number, col: number, fn: string): void {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_SIZE ||
    col < 0 ||
    col >= BOARD_SIZE
  ) {
    throw new RangeError(`${fn}: out of bounds (${row}, ${col})`)
  }
}

export function premiumKindAt(row: number, col: number): PremiumKind {
  checkBounds(row, col, 'premiumKindAt')
  switch (PREMIUM_LEGEND[row][col]) {
    case '3':
      return 'TW'
    case '2':
      return 'DW'
    case 't':
      return 'TL'
    case 'd':
      return 'DL'
    case '*':
      return 'STAR'
    default:
      return 'PLAIN'
  }
}

// Letter-first algebra, e.g. row 7 col 7 -> "H8".
export function squareLabel(row: number, col: number): string {
  checkBounds(row, col, 'squareLabel')
  return `${String.fromCharCode(65 + col)}${row + 1}`
}

function premiumClass(kind: PremiumKind): string {
  switch (kind) {
    case 'TW':
      return 'sq-tw'
    case 'DW':
      return 'sq-dw'
    case 'TL':
      return 'sq-tl'
    case 'DL':
      return 'sq-dl'
    case 'STAR':
      return 'sq-star'
    default:
      return 'sq-plain'
  }
}

function premiumText(kind: PremiumKind): string {
  switch (kind) {
    case 'TW':
      return 'TW'
    case 'DW':
      return 'DW'
    case 'TL':
      return 'TL'
    case 'DL':
      return 'DL'
    case 'STAR':
      return '★'
    default:
      return ''
  }
}

function cellHTML(row: number, col: number, tiles: Readonly<Record<string, string>>): string {
  const kind = premiumKindAt(row, col)
  const sq = squareLabel(row, col)
  const tile = tiles[sq]
  const inner =
    tile !== undefined
      ? `<div class="tile" data-tile="${tile}">${tile}</div>`
      : kind === 'STAR'
        ? `<span class="star" aria-hidden="true">★</span>`
        : premiumText(kind) === ''
          ? ''
          : `<span class="sq-label" aria-hidden="true">${premiumText(kind)}</span>`
  return (
    `<div class="sq ${premiumClass(kind)}" role="gridcell"` +
    ` data-sq="${sq}" data-premium="${kind}" aria-label="${sq} ${kind.toLowerCase()}">` +
    inner +
    `</div>`
  )
}

// Full board markup: .board wrapper with exactly 225 .sq children.
export function buildBoardHTML(tiles: Readonly<Record<string, string>> = {}): string {
  let cells = ''
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      cells += cellHTML(row, col, tiles)
    }
  }
  return `<div class="board" role="grid" aria-label="Wordtable board">${cells}</div>`
}

export function mountBoard(el: HTMLElement, tiles: Readonly<Record<string, string>> = {}): void {
  el.innerHTML = buildBoardHTML(tiles)
}

// Full board markup with pending tiles overlaid. Each pending entry renders
// exactly one `.tile.pending` inside its `data-sq` square, and the square
// gains `data-pending="true"` (never a `pending` class) so `.pending`
// counts equal pending tile counts.
export function buildBoardHTMLWithPending(
  tiles: Readonly<Record<string, string>> = {},
  pending: readonly PendingTile[] = [],
): string {
  const bySq = new Map<string, PendingTile>()
  for (const p of pending) bySq.set(p.sq.trim().toUpperCase(), p)
  let cells = ''
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const sq = squareLabel(row, col)
      const pend = bySq.get(sq)
      if (pend === undefined) {
        cells += cellHTML(row, col, tiles)
        continue
      }
      const kind = premiumKindAt(row, col)
      const tile = buildTileHTML(
        { face: pend.face, isBlank: pend.isBlank },
        { pending: true, pendingId: pend.id, draggable: false },
      )
      cells +=
        `<div class="sq ${premiumClass(kind)}" role="gridcell"` +
        ` data-sq="${sq}" data-premium="${kind}" data-pending="true"` +
        ` aria-label="${sq} ${kind.toLowerCase()}">` +
        tile +
        `</div>`
    }
  }
  return `<div class="board" role="grid" aria-label="Wordtable board">${cells}</div>`
}

export function mountBoardWithPending(
  el: HTMLElement,
  tiles: Readonly<Record<string, string>> = {},
  pending: readonly PendingTile[] = [],
): void {
  el.innerHTML = buildBoardHTMLWithPending(tiles, pending)
}

// Patches pending tiles into an already-mounted board without rebuilding
// the grid, so hosts that manage their own render loop can refresh cheaply.
export function renderPending(host: HTMLElement, pending: readonly PendingTile[]): void {
  const bySq = new Map<string, PendingTile>()
  for (const p of pending) bySq.set(p.sq.trim().toUpperCase(), p)
  const squares = host.querySelectorAll('.sq[data-sq]')
  squares.forEach((node) => {
    const square = node as HTMLElement
    const sq = (square.dataset.sq ?? '').toUpperCase()
    const pend = bySq.get(sq)
    let existing: Element | null = null
    for (const child of Array.from(square.children)) {
      if (child.classList.contains('tile') && child.classList.contains('pending')) {
        existing = child
        break
      }
    }
    if (pend === undefined) {
      square.removeAttribute('data-pending')
      if (existing) existing.remove()
      return
    }
    square.setAttribute('data-pending', 'true')
    const face = pend.isBlank ? '?' : pend.face
    if (
      existing &&
      existing.getAttribute('data-pending-id') === String(pend.id) &&
      existing.getAttribute('data-tile') === face
    ) {
      return
    }
    if (existing) existing.remove()
    square.insertAdjacentHTML(
      'beforeend',
      buildTileHTML(
        { face: pend.face, isBlank: pend.isBlank },
        { pending: true, pendingId: pend.id, draggable: false },
      ),
    )
  })
}

function selectedRackIndex(): number | null {
  return gameStore.getState().selectedRack ?? uiStore.getState().selectedRack
}

function clearSelection(): void {
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
}

// Delegated board interactions (idempotent per host): HTML5 dragover/drop
// for mouse plus click for tap-tile→tap-square. Clicking a pending tile
// with no selection returns it to the rack.
export function mountBoardInteractions(host: HTMLElement): void {
  if (host.dataset.interactions === '1') return
  host.dataset.interactions = '1'

  host.addEventListener('dragover', (e) => {
    const square = (e.target as HTMLElement).closest?.('.sq')
    if (!square || !host.contains(square)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    square.classList.add('drop-ok')
  })

  host.addEventListener('dragleave', (e) => {
    const square = (e.target as HTMLElement).closest?.('.sq')
    if (square && host.contains(square)) square.classList.remove('drop-ok')
  })

  host.addEventListener('drop', (e) => {
    const square = (e.target as HTMLElement).closest?.('.sq')
    if (!square || !host.contains(square)) return
    e.preventDefault()
    square.classList.remove('drop-ok')
    const sq = square.getAttribute('data-sq')
    if (!sq) return
    const index =
      getTileDragPayload(e.dataTransfer) ?? getActiveDragIndex() ?? selectedRackIndex()
    if (index === null || index === undefined) return
    if (gameStore.getState().placeTile(index, sq)) clearSelection()
    setActiveDragIndex(null)
  })

  host.addEventListener('click', (e) => {
    const square = (e.target as HTMLElement).closest?.('.sq')
    if (!square || !host.contains(square)) return
    const sq = square.getAttribute('data-sq')
    if (!sq) return
    const selected = selectedRackIndex()
    if (selected !== null && selected !== undefined) {
      if (gameStore.getState().placeTile(selected, sq)) clearSelection()
      return
    }
    const pendEl = (e.target as HTMLElement).closest?.('.tile.pending')
    if (pendEl && square.contains(pendEl)) {
      const raw = pendEl.getAttribute('data-pending-id')
      if (raw !== null) gameStore.getState().returnTile(Number(raw))
    }
  })
}
