// Chat panel (issue #9): `#chat-panel` with the `#chat-log` message list,
// a three-emote row (👏 😂 👍 in that order) and a 200-char text input.
// Offline sends echo through `uiStore.sendChat`; online sends (issue #16)
// ride `net.sendChat`/`net.sendEmote` and the broadcast repopulates the
// log via handleFrame, so blank input shows nothing either way.
// `reconnecting` counts as offline (issue #57): the socket is not open,
// so those sends take the local-echo branch, and a closed-socket race on
// the `online` branch falls back to local echo on NOT_CONNECTED.

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
    '<div class="chat-header"><span class="chat-title">Chat</span>' +
    '<button type="button" data-action="close-chat" aria-label="Close chat">×</button></div>' +
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

// Online only while the socket is open (issue #57): `reconnecting`
// takes the synchronous offline branch below, so a send on a flaky
// network echoes locally instead of dropping as NOT_CONNECTED.
function isOnline(): boolean {
  try {
    const s = netStore.getState()
    if (typeof s.code !== 'string' || s.code === '') return false
    if (typeof s.token !== 'string' || s.token === '') return false
    return s.status === 'online'
  } catch {
    return false
  }
}

// Replies that mean the frame never left the client: the text must still
// land in the log via local echo instead of silently dropping.
function isConnectionError(reply: { ok: boolean; error?: string }): boolean {
  return (
    !reply.ok &&
    (reply.error === 'NOT_CONNECTED' || reply.error === 'DISCONNECTED')
  )
}

// Local-echo preservation for the online race: never throws out of the
// event handler, never surfaces a toast (the log entry is the surfacing).
function preserveLocal(value: string): void {
  try {
    uiStore.getState().sendChat(value)
  } catch {
    // Best-effort like every other store touch in this file.
  }
}

function sendInputText(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('.chat-input')
  if (!input) return
  if (input.value.trim() === '') return
  if (isOnline()) {
    // The broadcast repopulates the log via handleFrame on success; a
    // closed-socket race resolves NOT_CONNECTED, so fall back to local
    // echo and the text still lands in the log instead of dropping.
    const value = input.value
    input.value = ''
    void net.sendChat(value).then(
      (reply) => {
        if (isConnectionError(reply)) preserveLocal(value)
      },
      () => {
        preserveLocal(value)
      },
    )
    return
  }
  if (uiStore.getState().sendChat(input.value)) input.value = ''
}

// Secondary close affordances (issue #92): Escape and outside-click.
// Registered once per page (same idempotence idiom as dataset.panelMounted
// above); clicks inside #chat-root (bubble or panel) never close. The
// try/catch keeps fake-DOM hosts without a document from throwing.
let chatGlobalMounted = false

function mountChatGlobals(): void {
  if (chatGlobalMounted) return
  chatGlobalMounted = true
  try {
    const doc = (
      globalThis as unknown as {
        document?: {
          addEventListener: (
            type: string,
            fn: (e: unknown) => void,
            opts?: unknown,
          ) => void
        }
      }
    ).document
    if (!doc || typeof doc.addEventListener !== 'function') return
    // Capture phase: the panel/bubble repaint replaces #chat-root innerHTML
    // synchronously on toggle, detaching the click target mid-dispatch, so a
    // bubble-phase outside-click check would misread the detached target as
    // outside and snap the panel shut again. Capture runs first, while the
    // target is still attached, so the #chat-root test stays exact.
    doc.addEventListener(
      'click',
      (e) => {
        try {
          if (!uiStore.getState().chatOpen) return
          const target = (e as { target?: unknown }).target as
            | { closest?: (selector: string) => unknown }
            | null
            | undefined
          if (target?.closest?.('#chat-root')) return
          uiStore.getState().setChatOpen(false)
        } catch {
          // Best-effort like every other store touch in this file.
        }
      },
      true,
    )
    doc.addEventListener('keydown', (e) => {
      try {
        if ((e as { key?: string }).key !== 'Escape') return
        if (!uiStore.getState().chatOpen) return
        try {
          ;(e as { preventDefault?: () => void }).preventDefault?.()
        } catch {
          // Focus handling is decorative; the close still counts.
        }
        uiStore.getState().setChatOpen(false)
      } catch {
        // Best-effort like every other store touch in this file.
      }
    })
  } catch {
    // No document (hermetic tests): the panel-level handlers still work.
  }
}

export function mountChatPanel(el: HTMLElement): void {
  if (el.dataset.panelMounted === '1') return
  el.dataset.panelMounted = '1'
  mountChatGlobals()
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const close = target.closest?.('[data-action="close-chat"]')
    if (close && el.contains(close)) {
      uiStore.getState().setChatOpen(false)
      return
    }
    const emote = target.closest?.('[data-emote]')
    if (emote && el.contains(emote)) {
      const value = emote.getAttribute('data-emote') ?? ''
      if (value.trim() === '') return
      if (isOnline()) {
        void net.sendEmote(value).then(
          (reply) => {
            if (isConnectionError(reply)) preserveLocal(value)
          },
          () => {
            preserveLocal(value)
          },
        )
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
