// Chat bubble (issue #9): the fixed corner opener with an unread badge.
// The badge hides when `unread` is 0; the bubble itself hides while the
// panel is open (the panel owns its own close control).

import { uiStore } from '../store/ui'

export function buildChatBubbleHTML(unread: number, open: boolean): string {
  const count = Number.isInteger(unread) && unread > 0 ? unread : 0
  const badge =
    count === 0
      ? '<span class="unread-badge" hidden></span>'
      : `<span class="unread-badge">${count}</span>`
  return (
    `<button type="button" id="chat-bubble" aria-label="Open chat"${open ? ' hidden' : ''}>` +
    '<span aria-hidden="true">💬</span>' +
    badge +
    '</button>'
  )
}

export function mountChatBubble(el: HTMLElement): void {
  if (el.dataset.bubbleMounted === '1') return
  el.dataset.bubbleMounted = '1'
  el.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest?.('#chat-bubble')
    if (!button || !el.contains(button)) return
    uiStore.getState().toggleChat()
  })
}
