// Online table (issue #88) — the server-authoritative board behind the
// new online loop: gameStore board/rack/pending as the placement scratch,
// state_sync broadcasts as the only truth, commits through the net
// intents. Mirrors the HotSeatTable skeleton/patch discipline: a pure
// builder plus a live-region renderer that preserves mount points.

import {
  buildBoardHTMLWithPending,
  mountBoardInteractions,
} from './Board'
import { buildBlankPickerHTML, mountBlankPicker } from './BlankPicker'
import { buildChatBubbleHTML, mountChatBubble } from './ChatBubble'
import { buildChatPanelHTML, mountChatPanel } from './ChatPanel'
import {
  buildRackActionsHTML,
  buildRackTilesHTML,
  mountRack,
  mountRackActions,
} from './Rack'
import { mountToast, showToastText } from './Toast'
import {
  boardToTiles,
  displayFace,
  gameStore,
  provScoreText,
} from '../store/game'
import { net, type PlacedTile } from '../store/net'
import { uiStore } from '../store/ui'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildOnlineTableHTML(): string {
  const state = gameStore.getState()
  const ui = uiStore.getState()
  const turnName = String(ui.seats[ui.turn] ?? '')
  return (
    '<main class="screen screen-table" id="online-table">' +
    `<div id="score-line" aria-label="Score">${ui.scores.join(' - ')}</div>` +
    `<div id="turn-line">${escapeHTML(turnName)} to play</div>` +
    `<div class="board-host">${buildBoardHTMLWithPending(boardToTiles(state.board), state.pending, state.lastMove)}</div>` +
    `<div id="prov-score" role="status" aria-live="polite" title="${escapeHTML(state.provWords.join(' '))}">${provScoreText(state.provScore)}</div>` +
    `<div id="rack" class="rack" role="listbox" aria-label="Rack">${buildRackTilesHTML(state.rack, state.selectedRack)}</div>` +
    buildRackActionsHTML() +
    '<div class="table-actions">' +
    '<button type="button" id="commit-button" data-action="play">Play</button>' +
    '<button type="button" id="pass-button">Pass</button>' +
    '<button type="button" id="exchange-button" data-action="exchange">Exchange</button>' +
    '</div>' +
    '<div id="float-layer" aria-hidden="true"></div>' +
    buildBlankPickerHTML() +
    `<div id="chat-root">${buildChatBubbleHTML(ui.unread, ui.chatOpen)}${buildChatPanelHTML(ui.chat, ui.chatOpen)}</div>` +
    '</main>'
  )
}

// Store-driven patch: repaint the live regions without replacing mount
// points, so board/rack delegation listeners survive net broadcasts.
export function renderOnlineTable(root: HTMLElement): void {
  const table = root.querySelector('#online-table')
  if (!table) return
  const state = gameStore.getState()
  const ui = uiStore.getState()
  const scoreLine = root.querySelector<HTMLElement>('#score-line')
  if (scoreLine) scoreLine.textContent = ui.scores.join(' - ')
  const turnLine = root.querySelector<HTMLElement>('#turn-line')
  if (turnLine) {
    turnLine.textContent = `${String(ui.seats[ui.turn] ?? '')} to play`
  }
  const host = root.querySelector<HTMLElement>('.board-host')
  if (host) {
    host.innerHTML = buildBoardHTMLWithPending(
      boardToTiles(state.board),
      state.pending,
      state.lastMove,
    )
  }
  const score = root.querySelector<HTMLElement>('#prov-score')
  if (score) {
    score.textContent = provScoreText(state.provScore)
    score.title = state.provWords.join(' ')
  }
  const rack = root.querySelector<HTMLElement>('#rack')
  if (rack) {
    rack.innerHTML = buildRackTilesHTML(state.rack, state.selectedRack)
  }
}

// Commit the game-store scratch through the server: blanks ride as
// `{face:'?', as}` exactly like the hot-seat commit mapping. An empty
// scratch is silent; a refusal surfaces as a toast and the broadcast
// snapshot restores the authoritative rack.
export function playCommitOnline(): void {
  const before = gameStore.getState()
  if (before.pending.length === 0) return
  const tiles: PlacedTile[] = before.pending.map((p) => {
    if (p.isBlank) return { square: p.sq, face: '?', as: p.blankAs ?? '' }
    return { square: p.sq, face: displayFace(p) }
  })
  void net.placeTiles(tiles).then((reply) => {
    if (!reply.ok) showToastText(reply.error ?? 'BAD_REPLY')
  })
}

export function mountOnlineTable(root: HTMLElement): void {
  // No per-root mount guard: the #screen host persists across route
  // paints while its children are rebuilt, so every paint must re-mount
  // the fresh board/rack/buttons (per-child guards stay idempotent).
  // A root early-return would leave the second visit's nodes dead.
  const boardHost = root.querySelector<HTMLElement>('.board-host')
  const rack = root.querySelector<HTMLElement>('#rack')
  const actions = root.querySelector<HTMLElement>('#rack-actions')
  const commit = root.querySelector<HTMLElement>('#commit-button')
  const pass = root.querySelector<HTMLElement>('#pass-button')
  const exchange = root.querySelector<HTMLElement>('#exchange-button')
  const picker = root.querySelector<HTMLElement>('#blank-picker')
  const toast = root.querySelector<HTMLElement>('#toast')
  if (boardHost) mountBoardInteractions(boardHost)
  if (rack) mountRack(rack)
  if (actions) mountRackActions(actions)
  if (picker) mountBlankPicker(picker)
  if (toast) mountToast(toast)
  commit?.addEventListener('click', () => {
    playCommitOnline()
  })
  pass?.addEventListener('click', () => {
    void net.passTurn().then((reply) => {
      if (!reply.ok) showToastText(reply.error ?? 'BAD_REPLY')
    })
  })
  exchange?.addEventListener('click', () => {
    void net.exchange(1).then((reply) => {
      if (!reply.ok) showToastText(reply.error ?? 'BAD_REPLY')
    })
  })
  const chatRoot = root.querySelector<HTMLElement>('#chat-root')
  if (chatRoot) {
    mountChatBubble(chatRoot)
    mountChatPanel(chatRoot)
  }
  // A fresh skeleton starts unselected: stale cursors never leak in.
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  renderOnlineTable(root)
}
