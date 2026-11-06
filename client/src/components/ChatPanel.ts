// Chat panel (issue #9): `#chat-panel` with the `#chat-log` message list,
// a three-emote row (👏 😂 👍 in that order) and a 200-char text input.
// Sends go through `uiStore.sendChat`, so blank input shows nothing and
// long input truncates — mirroring the engine chat contract.

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

function sendInputText(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('.chat-input')
  if (!input) return
  if (uiStore.getState().sendChat(input.value)) input.value = ''
}

export function mountChatPanel(el: HTMLElement): void {
  if (el.dataset.panelMounted === '1') return
  el.dataset.panelMounted = '1'
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const emote = target.closest?.('[data-emote]')
    if (emote && el.contains(emote)) {
      uiStore.getState().sendChat(emote.getAttribute('data-emote') ?? '')
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
