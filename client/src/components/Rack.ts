// Rack view — `#rack` tile row plus the Recall/Shuffle actions. Rack tiles
// drag (HTML5 draggable + ephemeral drag index, no mid-drag store churn)
// and click-to-select (tap-tap cursor shared by the Board square handler).
// Recall/Shuffle dispatch the game store and reuse the `.rack.shake` key
// from styles/fx.css for reject/recall feedback.

import type { Tile } from '../../../shared/engine/bag'
import { gameStore } from '../store/game'
import { uiStore } from '../store/ui'
import { buildTileHTML, setActiveDragIndex, setTileDragPayload } from './Tile'

// Exchange highlight (issue #89): while the exchange panel is open the
// picked rack indices render `exchange-selected` (aria-selected) without
// touching the tap-tap `selected` cursor. Read straight from uiStore so
// every table builder inherits the highlight with no signature change.
export function buildRackTilesHTML(rack: Tile[], selectedRack: number | null): string {
  const exchanging = uiStore.getState().exchangeOpen
    ? new Set(uiStore.getState().exchangeSelected)
    : null
  return rack
    .map((tile, i) =>
      buildTileHTML(tile, {
        selected: selectedRack === i,
        rackIndex: i,
        exchange: exchanging?.has(i) === true,
      }),
    )
    .join('')
}

export function buildRackHTML(rack: Tile[], selectedRack: number | null): string {
  return (
    `<div id="rack" class="rack" role="listbox" aria-label="Rack">` +
    buildRackTilesHTML(rack, selectedRack) +
    `</div>`
  )
}

export function buildRackActionsHTML(): string {
  return (
    '<div id="rack-actions">' +
    '<button type="button" data-action="recall">Recall</button>' +
    '<button type="button" data-action="shuffle">Shuffle</button>' +
    '</div>'
  )
}

// The game store owns placement; uiStore.selectedRack is the transient
// tap-tap cursor for components that only read UI state. Both move together.
function selectBoth(index: number | null): void {
  gameStore.getState().selectRack(index)
  uiStore.getState().selectRack(index)
}

export function mountRack(rackEl: HTMLElement): void {
  if (rackEl.dataset.mounted === '1') return
  rackEl.dataset.mounted = '1'

  rackEl.addEventListener('dragstart', (e) => {
    const target = (e.target as HTMLElement).closest?.('.tile')
    if (!target || !rackEl.contains(target)) return
    const raw = target.getAttribute('data-rack-index')
    if (raw === null) return
    const index = Number(raw)
    if (!Number.isInteger(index) || index < 0) return
    setActiveDragIndex(index)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      try {
        setTileDragPayload(e.dataTransfer, index)
      } catch {
        // Synthetic DataTransfers may reject custom mimes; the drop handler
        // falls back to the ephemeral index and the tap-tap selection.
      }
    }
  })

  rackEl.addEventListener('dragend', () => {
    setActiveDragIndex(null)
  })

  rackEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest?.('.tile')
    if (!target || !rackEl.contains(target)) return
    const raw = target.getAttribute('data-rack-index')
    if (raw === null) return
    const index = Number(raw)
    if (!Number.isInteger(index) || index < 0) return
    const current = gameStore.getState().selectedRack
    selectBoth(current === index ? null : index)
  })
}

// Reject feedback (issue #8): shake the rack, then settle. The pending
// tiles are already back via the store recall; the shake is pure motion.
export function shakeRack(rackEl: HTMLElement | null): void {
  if (!rackEl) return
  rackEl.classList.remove('shake')
  void rackEl.offsetWidth
  rackEl.classList.add('shake')
  window.setTimeout(() => rackEl.classList.remove('shake'), 300)
}

export function mountRackActions(actionsEl: HTMLElement): void {
  if (actionsEl.dataset.mounted === '1') return
  actionsEl.dataset.mounted = '1'

  actionsEl.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest?.('button[data-action]')
    if (!button || !actionsEl.contains(button)) return
    const action = button.getAttribute('data-action')
    if (action === 'recall') {
      gameStore.getState().recall()
      selectBoth(null)
      const rack = document.getElementById('rack')
      if (rack) {
        rack.classList.remove('shake')
        void rack.offsetWidth
        rack.classList.add('shake')
        window.setTimeout(() => rack.classList.remove('shake'), 300)
      }
    } else if (action === 'shuffle') {
      gameStore.getState().shuffle()
    }
  })
}
