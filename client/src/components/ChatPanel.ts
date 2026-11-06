// Chat panel (issue #9): `#chat-panel` with the `#chat-log` message list,
// a three-emote row (👏 😂 👍 in that order) and a 200-char text input.
// Offline sends echo through `uiStore.sendChat`; online sends (issue #16)
// ride `net.sendChat`/`net.sendEmote` and the broadcast repopulates the
// log via handleFrame, so blank input shows nothing either way.

import { net, netStore } from '../store/net'
import { uiStore, type ChatMessage } from '../store/ui'

export const EMOTES: readonly string[] = ['👏', '😂', '👍']

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildChatPanelHTML(chat: ChatMessage[], open: boolean): string {
  const rows = chat
    .map(
      (m) =>
        `<div class="chat-msg" data-from="${escapeHTML(m.from)}">` +
        `<span class="chat-from">${escapeHTML(m.from)}</span>` +
        `<span class="chat-text">${escapeHTML(m.text)}</span>` +
        '</div>',
    )
    .join('')
  const emotes = EMOTES.map(
    (emote) =>
      `<button type="button" data-emote="${emote}" aria-label="Send ${emote}">${emote}</button>`,
  ).join('')
  return (
    `<div id="chat-panel"${open ? '' : ' hidden'}>` +
    `<div id="chat-log" role="log" aria-label="Chat log">${rows}</div>` +
    `<div class="emote-row" role="group" aria-label="Emotes">${emotes}</div>` +
    '<div class="chat-input-row">' +
    '<input type="text" class="chat-input" maxlength="200"' +
    ' placeholder="Say something…" aria-label="Chat message">' +
    '<button type="button" data-action="send-chat">Send</button>' +
    '</div>' +
    '</div>'
  )
}

// Online when the net store holds a seat and the socket is (re)connected.
function isOnline(): boolean {
  try {
    const s = netStore.getState()
    if (typeof s.code !== 'string' || s.code === '') return false
    if (typeof s.token !== 'string' || s.token === '') return false
    return s.status === 'online' || s.status === 'reconnecting'
  } catch {
    return false
  }
}

function sendInputText(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('.chat-input')
  if (!input) return
  if (input.value.trim() === '') return
  if (isOnline()) {
    // Fire-and-forget: the broadcast repopulates the log via handleFrame.
    void net.sendChat(input.value)
    input.value = ''
    return
  }
  if (uiStore.getState().sendChat(input.value)) input.value = ''
}

export function mountChatPanel(el: HTMLElement): void {
  if (el.dataset.panelMounted === '1') return
  el.dataset.panelMounted = '1'
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const emote = target.closest?.('[data-emote]')
    if (emote && el.contains(emote)) {
      const value = emote.getAttribute('data-emote') ?? ''
      if (value.trim() === '') return
      if (isOnline()) {
        void net.sendEmote(value)
        return
      }
      uiStore.getState().sendChat(value)
      return
    }
    const send = target.closest?.('[data-action="send-chat"]')
    if (send && el.contains(send)) sendInputText(el)
  })
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const input = (e.target as HTMLElement).closest?.('.chat-input')
    if (!input || !el.contains(input)) return
    e.preventDefault()
    sendInputText(el)
  })
}
