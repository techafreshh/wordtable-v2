// Shared exchange surface (issue #89) — one tile-exchange panel reused
// by the hot-seat and online tables, mirroring the Rack/BlankPicker/Toast
// split: a pure HTML builder plus an idempotent mount. Transient selection
// lives in uiStore (`exchangeOpen`, `exchangeSelected`); the authoritative
// bag count comes from the session snapshot offline and from
// gameStore.bagRemaining (projected out of `state_sync.bag_remaining`)
// online. Confirm sends faces ('?' for blanks), never a bare count.

import { GameStatus } from '../../../shared/engine/game'
import { gameStore } from '../store/game'
import { uiStore } from '../store/ui'
import { sessionStore } from '../store/session'
import { net, netStore } from '../store/net'
import { showToastText } from './Toast'

// Bag line copy: unknown counts (no snapshot yet) read `Bag: —` and the
// button stays enabled apart from the turn/pending gates.
export function bagLineText(bag: number | null): string {
  if (bag === null || !Number.isFinite(bag)) return 'Bag: —'
  return `Bag: ${Math.max(0, Math.trunc(bag))}`
}

// Pure builder: `#exchange-button` (disabled while gated), the `#bag-`
// remaining line, and the hidden-unless-open `#exchange-panel` with the
// count-labelled `#exchange-confirm` plus `#exchange-cancel`.
export function buildExchangeHTML(
  bag: number | null,
  selectedCount: number,
  disabled: boolean,
  open: boolean,
): string {
  const n =
    Number.isInteger(selectedCount) && selectedCount > 0 ? selectedCount : 0
  return (
    `<button type="button" id="exchange-button" data-action="exchange"${disabled ? ' disabled' : ''}>Exchange</button>` +
    `<div id="bag-remaining">${bagLineText(bag)}</div>` +
    `<div id="exchange-panel"${open ? '' : ' hidden'}>` +
    '<p class="exchange-hint">Tap rack tiles to choose, then confirm.</p>' +
    `<button type="button" id="exchange-confirm"${n === 0 ? ' disabled' : ''}>Exchange ${n}</button>` +
    '<button type="button" id="exchange-cancel">Cancel</button>' +
    '</div>'
  )
}

// In-place repaint for the store-driven patch paths: the mount points
// survive (delegation listeners stay attached), only the live bits move.
export function paintExchange(
  root: ParentNode,
  bag: number | null,
  disabled: boolean,
): void {
  const ui = uiStore.getState()
  const button = root.querySelector<HTMLButtonElement>('#exchange-button')
  if (button) {
    if (disabled) button.setAttribute('disabled', '')
    else button.removeAttribute('disabled')
  }
  const line = root.querySelector('#bag-remaining')
  if (line) line.textContent = bagLineText(bag)
  const panel = root.querySelector('#exchange-panel')
  if (panel) {
    if (ui.exchangeOpen) panel.removeAttribute('hidden')
    else panel.setAttribute('hidden', '')
  }
  const confirm = root.querySelector<HTMLButtonElement>('#exchange-confirm')
  if (confirm) {
    confirm.textContent = `Exchange ${ui.exchangeSelected.length}`
    if (ui.exchangeSelected.length === 0) confirm.setAttribute('disabled', '')
    else confirm.removeAttribute('disabled')
  }
}

// Button gate, offline: bot turns and ended games refuse silently (exactly
// like placement), pending tiles refuse silently (recall or commit first),
// and the sub-7 bag refuses with the engine's EXCHANGE_GATE toast.
export type ExchangeGate = 'CLOSED' | 'GATE'

export function offlineExchangeBlocked(): ExchangeGate | null {
  const snap = sessionStore.getState().snapshot()
  if (snap === null || snap.status !== GameStatus.PLAYING) return 'CLOSED'
  if (sessionStore.getState().isBot[snap.turn]) return 'CLOSED'
  if (gameStore.getState().pending.length > 0) return 'CLOSED'
  if (snap.bagRemaining < 7) return 'GATE'
  return null
}

// Button gate, online: only the turn seat on a started room may exchange;
// an unknown bag (no snapshot yet) reads as gate-open.
export function onlineExchangeBlocked(): ExchangeGate | null {
  const auth = netStore.getState()
  const ui = uiStore.getState()
  if (auth.seat === null || auth.seat !== ui.turn || !auth.started) return 'CLOSED'
  if (gameStore.getState().pending.length > 0) return 'CLOSED'
  if ((gameStore.getState().bagRemaining ?? 7) < 7) return 'GATE'
  return null
}

function currentBag(mode: 'offline' | 'online'): number | null {
  if (mode === 'online') return gameStore.getState().bagRemaining
  return sessionStore.getState().snapshot()?.bagRemaining ?? null
}

function confirmExchange(opts: {
  mode: 'offline' | 'online'
  onExchanged?: () => void
}): void {
  const selected = uiStore.getState().exchangeSelected
  const rack = gameStore.getState().rack
  // Faces at select time: blanks ride as '?', so the engine swaps exactly
  // the picked tiles (never a bare count).
  const faces = selected
    .filter((i) => Number.isInteger(i) && i >= 0 && i < rack.length)
    .map((i) => {
      const tile = rack[i]
      return tile.isBlank ? '?' : tile.face
    })
  if (faces.length === 0) return
  if (opts.mode === 'offline') {
    const result = sessionStore.getState().exchangeTiles(faces)
    if (!result.ok) {
      showToastText(result.reason)
      return
    }
    uiStore.getState().clearExchange()
    opts.onExchanged?.()
    return
  }
  void net.exchange(faces).then((reply) => {
    if (!reply.ok) showToastText(reply.error ?? 'BAD_REPLY')
    else uiStore.getState().clearExchange()
  })
}

export function mountExchange(
  root: HTMLElement,
  opts: { mode: 'offline' | 'online'; onExchanged?: () => void },
): void {
  const blocked =
    opts.mode === 'offline' ? offlineExchangeBlocked : onlineExchangeBlocked
  root.querySelector<HTMLElement>('#exchange-button')?.addEventListener('click', () => {
    const ui = uiStore.getState()
    if (ui.exchangeOpen) {
      ui.clearExchange()
      return
    }
    const gate = blocked()
    // The empty-bag gate surfaces the engine's rejection as a toast; any
    // other gate (turn, pending) stays silent exactly like placement.
    if (gate === 'GATE') {
      showToastText('EXCHANGE_GATE')
      return
    }
    if (gate !== null) return
    // Opening clears the placement cursor so a stale selection can never
    // commit through the board while the panel is open.
    gameStore.getState().selectRack(null)
    ui.selectRack(null)
    ui.setExchangeOpen(true)
  })
  root.querySelector<HTMLElement>('#exchange-cancel')?.addEventListener('click', () => {
    uiStore.getState().clearExchange()
  })
  root.querySelector<HTMLElement>('#exchange-confirm')?.addEventListener('click', () => {
    confirmExchange(opts)
  })
  // Capture-phase rack tap on the FRESH `#rack` node (rebuilt on every
  // full `innerHTML` render, exactly like HotSeatTable's guardPlacement):
  // while the panel is open, tile clicks toggle exchange selection
  // instead of placement. Scoping to `#rack` keeps the listener on a
  // node that is discarded with each render, so re-mounts never stack
  // duplicate toggles on the persistent `#screen` host (two stacked
  // toggles would cancel and selection would never stick). Capture runs
  // before the rack bubble handlers, so a stopped event never reaches
  // placement.
  const rackNode = root.querySelector<HTMLElement>('#rack')
  rackNode?.addEventListener(
    'click',
    (e) => {
      if (!uiStore.getState().exchangeOpen) return
      const tile = (e.target as HTMLElement).closest?.('.tile')
      if (!tile || !rackNode.contains(tile)) return
      const raw = tile.getAttribute('data-rack-index')
      if (raw === null) return
      const index = Number(raw)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= gameStore.getState().rack.length
      ) {
        return
      }
      e.stopPropagation()
      e.preventDefault()
      uiStore.getState().toggleExchangeIndex(index)
    },
    true,
  )
  // Live paint for this mount only. No store subscriptions here: the
  // table-level patch paths (`renderHotSeatTable`/`renderOnlineTable`
  // via the main.ts repaint hooks) already repaint these nodes on every
  // store change, and subscribing here would stack one closure per
  // mount on the persistent host.
  paintExchange(root, currentBag(opts.mode), blocked() !== null)
}
