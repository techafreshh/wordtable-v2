// Online lobby (issue #88) — the waiting room behind the new online
// loop: room code + copy invite, seat plaques, host-only Add bot/Start,
// leave, and the shared corner chat. Pure string builder plus an
// idempotent mount repainted from the vanilla stores, mirroring
// Lobby.ts/Toast.ts; the net layer stays the only server authority.

import { navigate } from '../router'
import { gameStore } from '../store/game'
import { net, netStore } from '../store/net'
import { uiStore } from '../store/ui'
import { buildChatBubbleHTML, mountChatBubble } from './ChatBubble'
import { buildChatPanelHTML, mountChatPanel } from './ChatPanel'
import { mountToast } from './Toast'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildSeatPlaques(names: string[]): string {
  return names
    .map((raw, i) => {
      const name = escapeHTML(String(raw ?? ''))
      const bot = String(raw ?? '') === 'Botgomery'
      return (
        `<div class="seat${bot ? ' bot' : ''}" data-seat="${i}">` +
        `<span class="seat-name">${name}</span>` +
        (bot ? '<span class="bot-badge">Bot</span>' : '') +
        '</div>'
      )
    })
    .join('')
}

export function buildOnlineLobbyHTML(
  code: string,
  names: string[],
  isHost: boolean,
): string {
  const room = escapeHTML(String(code ?? ''))
  return (
    '<main class="screen screen-online-lobby" id="online-lobby">' +
    '<h1 class="screen-title">Online lobby</h1>' +
    `<div id="room-code" aria-label="Room code">${room}</div>` +
    '<button type="button" id="copy-link">Copy invite</button>' +
    `<div class="lobby-seats">${buildSeatPlaques(names)}</div>` +
    '<div class="screen-actions">' +
    (isHost ? '<button type="button" id="add-bot">Add bot</button>' : '') +
    (isHost ? '<button type="button" id="online-start">Start</button>' : '') +
    '<button type="button" id="leave-online">Leave</button>' +
    '</div>' +
    `<div id="chat-root">${buildChatBubbleHTML(uiStore.getState().unread, uiStore.getState().chatOpen)}${buildChatPanelHTML(uiStore.getState().chat, uiStore.getState().chatOpen)}</div>` +
    '</main>'
  )
}

// Seat/host repaint: plaques and host controls refresh from the stores
// without replacing mount points, so chat mounts and listeners survive
// every broadcast. Mirrors the renderHotSeatTable patch discipline.
export function renderOnlineLobby(root: HTMLElement): void {
  const lobby = root.querySelector('#online-lobby')
  if (!lobby) return
  const seats = root.querySelector('.lobby-seats')
  if (seats) {
    const next = buildSeatPlaques(uiStore.getState().seats)
    if (seats.innerHTML !== next) seats.innerHTML = next
  }
  const isHost = netStore.getState().seat === 0
  const actions = lobby.querySelector('.screen-actions')
  if (actions) {
    const want =
      (isHost ? '<button type="button" id="add-bot">Add bot</button>' : '') +
      (isHost ? '<button type="button" id="online-start">Start</button>' : '') +
      '<button type="button" id="leave-online">Leave</button>'
    if (actions.innerHTML !== want) actions.innerHTML = want
  }
}

function copyInvite(root: HTMLElement): void {
  const code = netStore.getState().code ?? ''
  if (code === '') return
  try {
    const clipboard = (
      globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }
    ).navigator?.clipboard
    if (clipboard?.writeText) {
      void clipboard
        .writeText(code)
        .then(
          () => uiStore.getState().showToast('Copied'),
          () => fallbackSelect(root),
        )
      return
    }
  } catch {
    // Clipboard unavailable (tests, insecure contexts): select instead.
  }
  fallbackSelect(root)
}

function fallbackSelect(root: HTMLElement): void {
  try {
    const node = root.querySelector('#room-code')
    if (!node) return
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // Selection is best-effort; the code stays visible regardless.
  }
}

export function mountOnlineLobby(root: HTMLElement): void {
  if (root.dataset.onlineLobbyMounted === '1') return
  root.dataset.onlineLobbyMounted = '1'

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest?.('#copy-link') && root.contains(target)) {
      copyInvite(root)
      return
    }
    if (target.closest?.('#leave-online') && root.contains(target)) {
      net.disconnect()
      gameStore.getState().resetOnline()
      navigate('start')
      return
    }
    if (target.closest?.('#add-bot') && root.contains(target)) {
      void net.addBot().then((reply) => {
        if (!reply.ok) uiStore.getState().showToast(reply.error ?? 'BAD_REPLY')
        else renderOnlineLobby(root)
      })
      return
    }
    if (target.closest?.('#online-start') && root.contains(target)) {
      void net.startGame().then((reply) => {
        if (!reply.ok) uiStore.getState().showToast(reply.error ?? 'BAD_REPLY')
        else navigate('online-table')
      })
    }
  })

  const chatRoot = root.querySelector<HTMLElement>('#chat-root')
  if (chatRoot) {
    mountChatBubble(chatRoot)
    mountChatPanel(chatRoot)
  }
  const toast = root.querySelector<HTMLElement>('#toast')
  if (toast) mountToast(toast)

  const repaint = (): void => {
    renderOnlineLobby(root)
    const nextChatRoot = root.querySelector<HTMLElement>('#chat-root')
    if (nextChatRoot) {
      const ui = uiStore.getState()
      const next =
        buildChatBubbleHTML(ui.unread, ui.chatOpen) +
        buildChatPanelHTML(ui.chat, ui.chatOpen)
      if (nextChatRoot.innerHTML !== next) nextChatRoot.innerHTML = next
    }
  }
  netStore.subscribe(repaint)
  uiStore.subscribe(repaint)
}
