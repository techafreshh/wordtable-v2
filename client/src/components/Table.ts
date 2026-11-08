// Table orchestrator — wires the board↔rack placement loop to the
// commit/reject feedback contract (issue #8). The game store owns the
// pending model and the commit result; this module owns the DOM side
// effects: Play commits (thunk + slam + .last-move + #float-score),
// illegal words refuse (rack shake + slide-back + `Not in my book: WORD`
// toast), and undesignated blanks reopen the picker. Event handling stays
// delegation-style like Board.ts cell markup.

import {
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
import { buildToastHTML, mountToast, showToastText } from './Toast'
import { buildReconnectOverlayHTML } from './ReconnectOverlay'
import { buildPlayerStripHTML, mountPlayerStrip } from './PlayerStrip'
import { buildChatBubbleHTML, mountChatBubble } from './ChatBubble'
import { buildChatPanelHTML, mountChatPanel } from './ChatPanel'
import {
  buildSoundToggleHTML,
  mountSoundToggle,
  repaintSoundToggle,
} from './SoundToggle'
import { isSoundOn } from '../audio/bank'
import {
  boardToTiles,
  displayFace,
  gameStore,
  provScoreText,
} from '../store/game'
import { uiStore } from '../store/ui'
import { playThunk } from '../audio/sounds'

export function tableSkeletonHTML(): string {
  return (
    '<main class="table">' +
    '<h1 class="table-title">Wordtable</h1>' +
    '<div id="player-strip"></div>' +
    '<div id="chat-root"></div>' +
    buildSoundToggleHTML(isSoundOn()) +
    '<div class="board-host"></div>' +
    '<div id="prov-score" role="status" aria-live="polite">0 pts</div>' +
    '<div id="rack" class="rack" role="listbox" aria-label="Rack"></div>' +
    buildRackActionsHTML() +
    '<div class="table-actions">' +
    '<button type="button" data-action="create">Create</button>' +
    '<button type="button" data-action="join">Join</button>' +
    '<button type="button" data-action="play">Play</button>' +
    '</div>' +
    '<div id="float-layer" aria-hidden="true"></div>' +
    buildToastHTML(null) +
    buildReconnectOverlayHTML(false, 0) +
    buildBlankPickerHTML() +
    '</main>'
  )
}

// Score float-up chip: appended synchronously on commit (well inside the
// 500 ms acceptance window); CSS float-up fades it and a timer removes it.
export function buildFloatScoreHTML(points: number): string {
  return `<div id="float-score" class="score-float" role="status">+${points}</div>`
}

let floatTimer: ReturnType<typeof setTimeout> | null = null

// Shared commit feedback (issue #85): the session table reuses the exact
// float/slam behavior, so both stay exported with markup and timing intact.
export function appendFloatScore(points: number): void {
  const layer = document.getElementById('float-layer')
  if (!layer) return
  if (floatTimer !== null) clearTimeout(floatTimer)
  layer.innerHTML = buildFloatScoreHTML(points)
  floatTimer = setTimeout(() => {
    floatTimer = null
    layer.innerHTML = ''
  }, 950)
}

export function markCommitSlam(): void {
  for (const el of Array.from(document.querySelectorAll('.tile.last-move'))) {
    el.classList.add('slam')
  }
}

// Play handler: snapshot the refusal copy up front (commit slides refused
// tiles back, clearing pending), then branch on the engine result.
export function playCommit(): void {
  const before = gameStore.getState()
  const fallbackWord = before.pending.map((p) => displayFace(p)).join('')
  const result = gameStore.getState().commit()
  if (result.ok) {
    playThunk()
    appendFloatScore(result.points)
    markCommitSlam()
    return
  }
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
  // Only lexicon refusals present the `Not in my book: WORD` copy.
  // Geometry refusals (FIRST_MOVE_STAR, NOT_CONNECTED, NOT_CONTIGUOUS,
  // TILE_CONFLICT, OUT_OF_BOUNDS) already slid back via commit's recall;
  // shake the rack for feedback but never mislabel them as lexicon misses.
  if (result.reason === 'NOT_IN_LEXICON') {
    const word = (result.word ?? fallbackWord).trim().toUpperCase()
    showToastText(`Not in my book: ${word}`)
    shakeRack(document.getElementById('rack'))
    return
  }
  shakeRack(document.getElementById('rack'))
}

// HUD chrome (issue #9): the player strip, chat bubble/panel and sound
// toggle paint from the uiStore on every render. The chat draft survives
// repaint: the typed value and focus are restored when the panel markup
// is replaced underneath an active input.
function renderHud(app: HTMLElement): void {
  const ui = uiStore.getState()
  const strip = app.querySelector<HTMLElement>('#player-strip')
  if (strip) {
    const next = buildPlayerStripHTML(ui.seats, ui.scores, ui.turn)
    if (strip.outerHTML !== next) strip.outerHTML = next
  }
  const chatRoot = app.querySelector<HTMLElement>('#chat-root')
  if (chatRoot) {
    const input = chatRoot.querySelector<HTMLInputElement>('.chat-input')
    const draft = input?.value ?? ''
    const focused =
      input !== null &&
      input !== undefined &&
      input.ownerDocument.activeElement === input
    const next =
      buildChatBubbleHTML(ui.unread, ui.chatOpen) +
      buildChatPanelHTML(ui.chat, ui.chatOpen)
    if (chatRoot.innerHTML !== next) {
      chatRoot.innerHTML = next
      if (draft !== '' || focused) {
        const restored = chatRoot.querySelector<HTMLInputElement>('.chat-input')
        if (restored) {
          restored.value = draft
          if (focused) restored.focus()
        }
      }
    }
  }
  const toggle = app.querySelector<HTMLElement>('#sound-toggle')
  if (toggle) repaintSoundToggle(toggle)
}

// Re-render the store-driven regions. #toast and #blank-picker paint
// themselves via their own uiStore subscriptions.
export function renderTable(app: HTMLElement): void {
  const state = gameStore.getState()
  const host = app.querySelector<HTMLElement>('.board-host')
  if (host) {
    host.innerHTML = buildBoardHTMLWithPending(
      boardToTiles(state.board),
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
  if (rack) rack.innerHTML = buildRackTilesHTML(state.rack, state.selectedRack)
  renderHud(app)
}

function ensureMountPoints(app: HTMLElement): void {
  if (!app.querySelector('.board-host')) {
    app.innerHTML = tableSkeletonHTML()
    return
  }
  const boardHost = app.querySelector('.board-host')
  if (!app.querySelector('#player-strip')) {
    const holder = document.createElement('div')
    holder.innerHTML = buildPlayerStripHTML(
      uiStore.getState().seats,
      uiStore.getState().scores,
      uiStore.getState().turn,
    )
    const strip = holder.firstElementChild
    if (strip && boardHost) boardHost.before(strip)
  }
  if (!app.querySelector('#chat-root')) {
    const chatRoot = document.createElement('div')
    chatRoot.id = 'chat-root'
    if (boardHost) boardHost.before(chatRoot)
    else app.append(chatRoot)
  }
  if (!app.querySelector('#sound-toggle')) {
    const holder = document.createElement('div')
    holder.innerHTML = buildSoundToggleHTML(isSoundOn())
    const toggle = holder.firstElementChild
    if (toggle && boardHost) boardHost.before(toggle)
  }
  if (!app.querySelector('#toast')) {
    app.insertAdjacentHTML('beforeend', buildToastHTML(uiStore.getState().toast))
  }
  if (!app.querySelector('#blank-picker')) {
    app.insertAdjacentHTML('beforeend', buildBlankPickerHTML())
  }
  if (!app.querySelector('#float-layer')) {
    app.insertAdjacentHTML('beforeend', '<div id="float-layer" aria-hidden="true"></div>')
  }
  if (!app.querySelector('#reconnect-overlay')) {
    app.insertAdjacentHTML('beforeend', buildReconnectOverlayHTML(false, 0))
  }
}

export function mountTableActions(actionsEl: HTMLElement): void {
  if (actionsEl.dataset.mounted === '1') return
  actionsEl.dataset.mounted = '1'
  actionsEl.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest?.('button[data-action]')
    if (!button || !actionsEl.contains(button)) return
    if (button.getAttribute('data-action') === 'play') playCommit()
  })
}

export function mountTable(app: HTMLElement): void {
  ensureMountPoints(app)
  const strip = app.querySelector<HTMLElement>('#player-strip')
  const chatRoot = app.querySelector<HTMLElement>('#chat-root')
  const soundToggle = app.querySelector<HTMLElement>('#sound-toggle')
  const host = app.querySelector<HTMLElement>('.board-host')
  const rack = app.querySelector<HTMLElement>('#rack')
  const actions = app.querySelector<HTMLElement>('#rack-actions')
  const tableActions = app.querySelector<HTMLElement>('.table-actions')
  const picker = app.querySelector<HTMLElement>('#blank-picker')
  const toast = app.querySelector<HTMLElement>('#toast')
  if (host) mountBoardInteractions(host)
  if (rack) mountRack(rack)
  if (actions) mountRackActions(actions)
  if (tableActions) mountTableActions(tableActions)
  if (picker) mountBlankPicker(picker)
  if (toast) mountToast(toast)
  if (strip) mountPlayerStrip(strip)
  if (chatRoot) {
    mountChatBubble(chatRoot)
    mountChatPanel(chatRoot)
  }
  if (soundToggle) mountSoundToggle(soundToggle)
  renderTable(app)
}
