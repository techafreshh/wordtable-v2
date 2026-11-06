// Tile element factory — the single `<div class="tile">` builder for rack
// tiles, pending tiles and committed tiles. Blanks render as `?`; pending
// tiles gain the `pending` class (never the square itself) so `.pending`
// counts equal pending tile counts. Touch drags never scroll: every tile
// carries `touch-action: none` via CSS plus mountTileAttrs for nodes built
// outside the HTML builders.

import type { Tile } from '../../../shared/engine/bag'

export interface TileRenderOpts {
  pending?: boolean
  selected?: boolean
  rackIndex?: number
  pendingId?: number
  draggable?: boolean
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
  const face = tile.isBlank ? '?' : tile.face
  let attrs =
    `class="${classes.join(' ')}"` +
    ` draggable="${opts.draggable === false ? 'false' : 'true'}"` +
    ` data-tile="${esc(face)}"`
  if (opts.rackIndex !== undefined) attrs += ` data-rack-index="${opts.rackIndex}"`
  if (opts.pendingId !== undefined) attrs += ` data-pending-id="${opts.pendingId}"`
  if (opts.selected === true) attrs += ' aria-selected="true"'
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
  el.setAttribute('draggable', opts.draggable === false ? 'false' : 'true')
  el.dataset.tile = tile.isBlank ? '?' : tile.face
  if (opts.rackIndex !== undefined) el.dataset.rackIndex = String(opts.rackIndex)
  if (opts.pendingId !== undefined) el.dataset.pendingId = String(opts.pendingId)
  if (opts.selected === true) el.setAttribute('aria-selected', 'true')
  el.style.touchAction = 'none'
}
