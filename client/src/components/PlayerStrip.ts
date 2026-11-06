// Player strip (issue #9): pure string builder plus a ticker mount,
// following the Board.ts idiom. One `.seat[data-seat]` per seat with the
// name and `.seat-score`; exactly one `.seat.active` at the turn index.
// The active seat carries `#timer-ring`, an SVG circle whose `ring-fg`
// dashoffset sweeps over TURN_CLOCK_MS (display-only: expiry never
// auto-passes offline).

import { uiStore } from '../store/ui'

export const TURN_CLOCK_MS = 90_000
const RING_R = 14
const RING_C = 2 * Math.PI * RING_R
const RING_DASH = RING_C.toFixed(2)

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ringHTML(): string {
  return (
    '<span id="timer-ring" role="timer" aria-label="Turn clock">' +
    '<svg viewBox="0 0 32 32" aria-hidden="true">' +
    `<circle class="ring-bg" cx="16" cy="16" r="${RING_R}"></circle>` +
    `<circle class="ring-fg" cx="16" cy="16" r="${RING_R}"` +
    ` stroke-dasharray="${RING_DASH}" stroke-dashoffset="0"></circle>` +
    '</svg>' +
    '</span>'
  )
}

export function buildPlayerStripHTML(
  seats: string[],
  scores: number[],
  turn: number,
): string {
  const active =
    seats.length === 0 ? 0 : Math.min(Math.max(0, turn), seats.length - 1)
  const seatsHTML = seats
    .map((name, i) => {
      const score = scores[i] ?? 0
      return (
        `<div class="seat${i === active ? ' active' : ''}" data-seat="${i}"` +
        ` role="listitem" aria-current="${i === active ? 'true' : 'false'}">` +
        `<span class="seat-name">${escapeHTML(String(name ?? ''))}</span>` +
        `<span class="seat-score">${score}</span>` +
        (i === active ? ringHTML() : '') +
        '</div>'
      )
    })
    .join('')
  return `<div id="player-strip" role="list" aria-label="Players">${seatsHTML}</div>`
}

let stripMounted = false

export function mountPlayerStrip(el: HTMLElement): void {
  if (stripMounted) return
  const doc = el.ownerDocument
  if (!doc) return
  stripMounted = true

  const paint = (): void => {
    try {
      const host = doc.getElementById('player-strip')
      if (!host) return
      const s = uiStore.getState()
      const next = buildPlayerStripHTML(s.seats, s.scores, s.turn)
      if (host.outerHTML !== next) host.outerHTML = next
    } catch {
      // The strip must never break the table.
    }
  }

  const tick = (): void => {
    try {
      const ring = doc.querySelector('#timer-ring .ring-fg')
      if (!ring) return
      const elapsed = Date.now() - uiStore.getState().turnStartedAt
      const progress = Math.min(1, Math.max(0, elapsed / TURN_CLOCK_MS))
      ring.setAttribute('stroke-dashoffset', (RING_C * progress).toFixed(2))
    } catch {
      // The clock must never break the table.
    }
  }

  paint()
  uiStore.subscribe(paint)
  tick()
  window.setInterval(tick, 250)
}
