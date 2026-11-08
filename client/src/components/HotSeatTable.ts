// Hot-seat table (issue #10, placement loop issue #85) — the session
// snapshot over the Board grid with the full Table.ts placement stack:
// the game store is pending/selection scratch synced from the session
// snapshot, LocalGame stays the commit authority. Bot seats resolve
// through the session auto-pass timer; humans place via tap-tap and
// drag-drop through the shared Board/Rack/BlankPicker mounts, commit
// through sessionStore.placeMove, and pass with the button or the hook.

import { GameStatus } from '../../../shared/engine/game'
import { toAlgebra } from '../../../shared/engine/board'
import type { BoardGrid } from '../../../shared/engine/rules'
import type {
  LocalSnapshot,
  PlaceSpec,
} from '../../../shared/engine/local'
import {
  buildBoardHTML,
  buildBoardHTMLWithPending,
  mountBoardInteractions,
} from './Board'
import {
  buildRackActionsHTML,
  buildRackTilesHTML,
  mountRack,
  mountRackActions,
  shakeRack,
} from './Rack'
import { buildBlankPickerHTML, mountBlankPicker } from './BlankPicker'
import {
  buildExchangeHTML,
  mountExchange,
  offlineExchangeBlocked,
  paintExchange,
} from './Exchange'
import { mountToast, showToastText } from './Toast'
import { buildPlayerStripHTML } from './PlayerStrip'
import { appendFloatScore, markCommitSlam } from './Table'
import { displayFace, gameStore, provScoreText } from '../store/game'
import { uiStore } from '../store/ui'
import { sessionStore } from '../store/session'
import { navigate } from '../router'
import { playThunk } from '../audio/sounds'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Committed-only grid: LocalGame owns placed tiles, so every supplied tile
// renders `.tile.committed` (never `.pending` or `.last-move`). A pure
// string promotion over buildBoardHTML, testable by regex count.
export function buildTableBoardHTML(
  tiles: Readonly<Record<string, string>> = {},
): string {
  return buildBoardHTML(tiles).split('class="tile"').join('class="tile committed"')
}

// Committed board grid as an algebra→letter map for the Board renderer.
export function boardTiles(board: BoardGrid): Record<string, string> {
  const tiles: Record<string, string> = {}
  for (let row = 0; row < board.length; row++) {
    const cells = board[row]
    if (!cells) continue
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col]
      if (cell !== null && cell !== undefined) {
        tiles[toAlgebra(row, col)] = cell.letter
      }
    }
  }
  return tiles
}

// Placement gate: input is ignored when there is no session, the game is
// over, or the turn seat is a bot. Recall/Shuffle stay live (display-local
// scratch ops); the commit button re-checks before calling the engine.
export function sessionAllowsPlacement(): boolean {
  const snap = sessionStore.getState().snapshot()
  if (snap === null || snap.status !== GameStatus.PLAYING) return false
  return !sessionStore.getState().isBot[snap.turn]
}

// Projection writer: install the engine snapshot's board and turn-seat rack
// as the placement scratch. Pending, selection and the provisional chip
// clear; lastMove/lastScore are preserved for the commit path to set.
export function syncGameFromSession(): void {
  const snap = sessionStore.getState().snapshot()
  if (snap === null) return
  gameStore.getState().syncFromSession(snap.board, snap.racks[snap.turn] ?? [])
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
}

export function buildHotSeatTableHTML(snapshot: LocalSnapshot): string {
  const turnName = String(snapshot.names[snapshot.turn] ?? '')
  const state = gameStore.getState()
  const ui = uiStore.getState()
  return (
    '<main class="screen screen-table">' +
    buildPlayerStripHTML(snapshot.names, snapshot.scores, snapshot.turn) +
    `<div id="score-line" aria-label="Score">${snapshot.scores.join(' - ')}</div>` +
    `<div id="turn-line">${escapeHTML(turnName)} to play</div>` +
    `<div class="board-host">${buildBoardHTMLWithPending(boardTiles(snapshot.board), state.pending, state.lastMove)}</div>` +
    `<div id="prov-score" role="status" aria-live="polite" title="${escapeHTML(state.provWords.join(' '))}">${provScoreText(state.provScore)}</div>` +
    `<div id="rack" class="rack" role="listbox" aria-label="Rack"${
      sessionAllowsPlacement() ? '' : ' aria-disabled="true"'
    }>${buildRackTilesHTML(state.rack, state.selectedRack)}</div>` +
    buildRackActionsHTML() +
    '<div class="table-actions">' +
    '<button type="button" id="commit-button" data-action="play">Play</button>' +
    '<button type="button" id="pass-button">Pass</button>' +
    buildExchangeHTML(
      snapshot.bagRemaining,
      ui.exchangeSelected.length,
      offlineExchangeBlocked() !== null,
      ui.exchangeOpen,
    ) +
    '</div>' +
    '<div id="float-layer" aria-hidden="true"></div>' +
    buildBlankPickerHTML() +
    '</main>'
  )
}

// Store-driven patch: repaint the live regions without replacing mount
// points, so delegation listeners survive game/ui intents. Toast, picker
// and float nodes paint through their own subscriptions and are untouched.
export function renderHotSeatTable(app: HTMLElement): void {
  const snap = sessionStore.getState().snapshot()
  if (snap === null) return
  const state = gameStore.getState()
  const strip = app.querySelector<HTMLElement>('#player-strip')
  if (strip) {
    strip.outerHTML = buildPlayerStripHTML(snap.names, snap.scores, snap.turn)
  }
  const scoreLine = app.querySelector<HTMLElement>('#score-line')
  if (scoreLine) scoreLine.textContent = snap.scores.join(' - ')
  const turnLine = app.querySelector<HTMLElement>('#turn-line')
  if (turnLine) turnLine.textContent = `${String(snap.names[snap.turn] ?? '')} to play`
  const host = app.querySelector<HTMLElement>('.board-host')
  if (host) {
    host.innerHTML = buildBoardHTMLWithPending(
      boardTiles(snap.board),
      state.pending,
      state.lastMove,
    )
  }
  const score = app.querySelector<HTMLElement>('#prov-score')
  if (score) {
    score.textContent = provScoreText(state.provScore)
    score.title = state.provWords.join(' ')
  }
  const rack = app.querySelector<HTMLElement>('#rack')
  if (rack) {
    rack.innerHTML = buildRackTilesHTML(state.rack, state.selectedRack)
    if (sessionAllowsPlacement()) rack.removeAttribute('aria-disabled')
    else rack.setAttribute('aria-disabled', 'true')
  }
  paintExchange(app, snap.bagRemaining, offlineExchangeBlocked() !== null)
}

// DOM paint for headless-safe commit paths: the stores stay authoritative
// when there is no screen (tests, scripted hooks).
function paintSessionTable(): void {
  if (typeof document === 'undefined') return
  try {
    const host = document.getElementById('screen')
    if (host) renderHotSeatTable(host)
  } catch {
    // No screen yet: the stores stay authoritative without a repaint.
  }
}

// Play handler, mirroring Table.ts playCommit branch for branch: snapshot
// refusal copy up front, BLANK_NO_LETTER reopens the picker, EMPTY_MOVE is
// silent, NOT_IN_LEXICON toasts `Not in my book: WORD` with slide-back and
// shake, geometry refusals slide back with a silent shake.
export function playCommitSession(): void {
  const snap = sessionStore.getState().snapshot()
  if (snap === null || snap.status !== GameStatus.PLAYING) return
  if (sessionStore.getState().isBot[snap.turn]) return
  const before = gameStore.getState()
  if (before.pending.length === 0) return
  const fallbackWord = before.pending.map((p) => displayFace(p)).join('')
  const specs: PlaceSpec[] = before.pending.map((p) => {
    if (p.isBlank) return { square: p.sq, face: '?', as: p.blankAs ?? '' }
    return { square: p.sq, face: p.face }
  })
  const result = sessionStore.getState().placeMove(specs)
  // place() resolves to PlaceOk or IntentFail; the `in` guard keeps the
  // other ok variants (pass/chat/...) out of the commit path by type.
  if (result.ok && 'points' in result) {
    const squares = before.pending.map((p) => p.sq)
    playThunk()
    syncGameFromSession()
    gameStore.setState({ lastMove: squares, lastScore: result.points })
    if (typeof document !== 'undefined') {
      appendFloatScore(result.points)
      markCommitSlam()
      paintSessionTable()
      try {
        const after = sessionStore.getState().snapshot()
        if (after === null || after.status !== GameStatus.PLAYING) {
          navigate('recap')
        }
      } catch {
        // Headless commit: ending is visible through the snapshot.
      }
    }
    return
  }
  if (result.ok) return
  if (result.reason === 'BLANK_NO_LETTER') {
    const undesignated = gameStore
      .getState()
      .pending.find((p) => p.isBlank && !p.blankAs)
    if (undesignated) {
      uiStore.getState().openBlankPicker({
        rackIndex: -1,
        sq: undesignated.sq,
        pendingId: undesignated.id,
      })
    }
    return
  }
  if (result.reason === 'EMPTY_MOVE') return
  // Refused words slide back to the rack (recall), then the table shakes
  // the rack and raises the toast. Only lexicon refusals name the word;
  // geometry refusals (FIRST_MOVE_STAR, NOT_CONNECTED, NOT_CONTIGUOUS,
  // TILE_CONFLICT, OUT_OF_BOUNDS, BAD_TILES) shake silently.
  gameStore.getState().recall()
  if (result.reason === 'NOT_IN_LEXICON') {
    const word = (result.word ?? fallbackWord).trim().toUpperCase()
    showToastText(`Not in my book: ${word}`)
  }
  if (typeof document !== 'undefined') {
    try {
      shakeRack(document.getElementById('rack'))
    } catch {
      // No rack node: the slide-back already restored the tiles.
    }
    paintSessionTable()
  }
}

function guardPlacement(e: Event): void {
  // While the exchange panel is open, board/rack gestures (including
  // drag-drop, which never passes through the tile-click funnel) must
  // not place: selection toggles instead.
  if (uiStore.getState().exchangeOpen) {
    e.stopPropagation()
    e.preventDefault()
    return
  }
  if (sessionAllowsPlacement()) return
  e.stopPropagation()
  e.preventDefault()
}

export function mountHotSeatTable(
  root: HTMLElement,
  onPass?: () => void,
): void {
  const boardHost = root.querySelector<HTMLElement>('.board-host')
  const rack = root.querySelector<HTMLElement>('#rack')
  const actions = root.querySelector<HTMLElement>('#rack-actions')
  const commit = root.querySelector<HTMLElement>('#commit-button')
  const pass = root.querySelector<HTMLElement>('#pass-button')
  const picker = root.querySelector<HTMLElement>('#blank-picker')
  const toast = root.querySelector<HTMLElement>('#toast')
  if (boardHost) {
    mountBoardInteractions(boardHost)
    // Capture-phase guards run before the bubble-phase Board delegation on
    // the same host: a stopped bot-turn event never reaches the placement
    // funnel or the pending-return click.
    boardHost.addEventListener('click', guardPlacement, true)
    boardHost.addEventListener('drop', guardPlacement, true)
    boardHost.addEventListener('dragover', guardPlacement, true)
  }
  if (rack) {
    mountRack(rack)
    rack.addEventListener('click', guardPlacement, true)
    rack.addEventListener('dragstart', guardPlacement, true)
  }
  if (actions) mountRackActions(actions)
  mountExchange(root, {
    mode: 'offline',
    onExchanged: () => {
      syncGameFromSession()
      if (typeof document === 'undefined') return
      try {
        const host = document.getElementById('screen')
        if (host) renderHotSeatTable(host)
        const after = sessionStore.getState().snapshot()
        if (after === null || after.status !== GameStatus.PLAYING) {
          navigate('recap')
        }
      } catch {
        // Headless exchange: the stores stay authoritative.
      }
    },
  })
  if (picker) mountBlankPicker(picker)
  if (toast) mountToast(toast)
  commit?.addEventListener('click', () => {
    playCommitSession()
  })
  pass?.addEventListener('click', () => {
    if (onPass) {
      onPass()
      return
    }
    sessionStore.getState().passTurn()
    const snap = sessionStore.getState().snapshot()
    if (snap !== null && snap.status !== GameStatus.PLAYING) {
      navigate('recap')
    }
  })
  // A fresh skeleton starts unselected: turn changes clear stale cursors.
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  renderHotSeatTable(root)
}
