// Tile element factory — the single `<div class="tile">` builder for rack
// tiles, pending tiles and committed tiles. Blanks render as `?`; pending
// tiles gain the `pending` class (never the square itself) so `.pending`
// counts equal pending tile counts. Touch drags never scroll: every tile
// carries `touch-action: none` via CSS plus mountTileAttrs for nodes built
// outside the HTML builders.

import type { Tile } from '../../../shared/engine/bag'

export interface TileRenderOpts {
  pending?: boolean
  // Exchange-picked tiles (issue #89) outline in brass without taking
  // the placement cursor: `selected` stays the tap-tap path.
  exchange?: boolean
  selected?: boolean
  rackIndex?: number
  pendingId?: number
  draggable?: boolean
  lastMove?: boolean
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildTileHTML(tile: Tile, opts: TileRenderOpts = {}): string {
  const classes = ['tile']
  if (opts.pending === true) classes.push('pending')
  if (opts.selected === true) classes.push('selected')
  if (opts.exchange === true) classes.push('exchange-selected')
  if (opts.lastMove === true) classes.push('last-move')
  // A designated blank shows its picker letter but stays a blank (value
  // 0); an undesignated blank shows '?'. data-blank marks blanks so the
  // letter face never reads as a real tile.
  const designated = (tile.blankAs ?? '').trim().toUpperCase()
  const face = tile.isBlank ? (/^[A-Z]$/.test(designated) ? designated : '?') : tile.face
  let attrs =
    `class="${classes.join(' ')}"` +
    ` draggable="${opts.draggable === false ? 'false' : 'true'}"` +
    ` data-tile="${esc(face)}"`
  if (tile.isBlank) attrs += ' data-blank="true"'
  if (opts.rackIndex !== undefined) attrs += ` data-rack-index="${opts.rackIndex}"`
  if (opts.pendingId !== undefined) attrs += ` data-pending-id="${opts.pendingId}"`
  if (opts.selected === true || opts.exchange === true) attrs += ' aria-selected="true"'
  return `<div ${attrs}>${esc(face)}</div>`
}

// Ephemeral HTML5-drag index. dragstart stores the rack index here without
// touching the zustand stores, so the drop read never triggers a mid-drag
// re-render that would replace the dragged node and abort the drag.
let activeDragIndex: number | null = null

export function setActiveDragIndex(index: number | null): void {
  activeDragIndex = index
}

export function getActiveDragIndex(): number | null {
  return activeDragIndex
}

export const RACK_DRAG_MIME = 'application/x-wordtable-rack-index'

export function setTileDragPayload(dt: DataTransfer, rackIndex: number): void {
  dt.setData(RACK_DRAG_MIME, String(rackIndex))
  dt.setData('text/plain', String(rackIndex))
}

export function getTileDragPayload(dt: DataTransfer | null | undefined): number | null {
  if (!dt) return null
  const types = [RACK_DRAG_MIME, 'text/plain', 'text'];
  for (const type of types) {
    let raw = ''
    try {
      raw = dt.getData(type)
    } catch {
      continue
    }
    if (raw === '') continue
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return n
  }
  return null
}

// Applies the tile hooks to a node created outside buildTileHTML.
export function mountTileAttrs(el: HTMLElement, tile: Tile, opts: TileRenderOpts = {}): void {
  el.classList.add('tile')
  el.classList.toggle('pending', opts.pending === true)
  el.classList.toggle('selected', opts.selected === true)
  el.classList.toggle('exchange-selected', opts.exchange === true)
  el.classList.toggle('last-move', opts.lastMove === true)
  el.setAttribute('draggable', opts.draggable === false ? 'false' : 'true')
  const designated = (tile.blankAs ?? '').trim().toUpperCase()
  el.dataset.tile = tile.isBlank ? (/^[A-Z]$/.test(designated) ? designated : '?') : tile.face
  if (tile.isBlank) el.dataset.blank = 'true'
  else delete el.dataset.blank
  if (opts.rackIndex !== undefined) el.dataset.rackIndex = String(opts.rackIndex)
  if (opts.pendingId !== undefined) el.dataset.pendingId = String(opts.pendingId)
  if (opts.selected === true || opts.exchange === true) el.setAttribute('aria-selected', 'true')
  else el.removeAttribute('aria-selected')
  el.style.touchAction = 'none'
}
