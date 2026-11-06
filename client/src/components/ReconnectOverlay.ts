// Reconnect overlay — the visible half of the drop UX (issue #15).
// `#reconnect-overlay` covers the table while the net layer redials, so a
// killed socket reads as `Reconnecting…` instead of a frozen board. Shape
// mirrors Toast.ts: a pure HTML builder plus an idempotent `mount*`
// guarded by `dataset.mounted` and repainted from the vanilla store.

import { netStore, reconnectOverlayText } from '../store/net'

export function buildReconnectOverlayHTML(
  visible: boolean,
  attempt: number,
): string {
  if (!visible) {
    return '<div id=\"reconnect-overlay\" role=\"status\" aria-live=\"polite\" hidden></div>'
  }
  return `<div id=\"reconnect-overlay\" role=\"status\" aria-live=\"polite\">${escapeHTML(reconnectOverlayText(attempt))}</div>`
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
}

export function setReconnectVisible(visible: boolean): void {
  try {
    const el =
      typeof document !== 'undefined'
        ? document.getElementById('reconnect-overlay')
        : null
    if (!el) return
    if (visible) el.removeAttribute('hidden')
    else el.setAttribute('hidden', '')
  } catch {
    // Overlay paint is best-effort; the net store stays authoritative.
  }
}

export function setReconnectAttempt(attempt: number): void {
  try {
    const el =
      typeof document !== 'undefined'
        ? document.getElementById('reconnect-overlay')
        : null
    if (!el) return
    el.textContent = reconnectOverlayText(attempt)
  } catch {
    // Overlay paint is best-effort; the net store stays authoritative.
  }
}

export function mountReconnectOverlay(el: HTMLElement): void {
  if (el.dataset.mounted === '1') return
  el.dataset.mounted = '1'

  const paint = (): void => {
    const state = netStore.getState()
    if (state.status === 'reconnecting') {
      el.removeAttribute('hidden')
      // textContent keeps the `Reconnecting…` copy byte-exact.
      el.textContent = reconnectOverlayText(state.reconnectAttempt)
    } else {
      el.setAttribute('hidden', '')
      el.textContent = ''
    }
  }
  paint()
  netStore.subscribe(paint)
}

// Every route hosts exactly one overlay node: a document-wide lookup wins
// over the passed root so re-renders never stack duplicates.
export function ensureReconnectOverlay(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument ?? document
  const existing = doc.getElementById('reconnect-overlay')
  if (existing) {
    mountReconnectOverlay(existing as HTMLElement)
    return existing as HTMLElement
  }
  const holder = doc.createElement('div')
  holder.innerHTML = buildReconnectOverlayHTML(false, 0)
  const el = holder.firstElementChild as HTMLElement
  root.appendChild(el)
  mountReconnectOverlay(el)
  return el
}
