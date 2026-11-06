// Seat picker (issue #10) — 2-4 named seats with bot checkboxes over a
// plain form. Row 0 is always human (its checkbox is disabled); the rest
// toggle between human and bot. Pure string builders plus a mount that
// wires submit and the 2/3/4 count selector, Board.ts style.

import {
  DEFAULT_SESSION_NAMES,
  MAX_NAME_LEN,
  MAX_SEATS,
  MIN_SEATS,
} from '../store/session'

export interface SeatChoice {
  names: string[]
  bots: boolean[]
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clampCount(count: number): number {
  const n = Math.floor(count)
  if (!Number.isFinite(n)) return MIN_SEATS
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, n))
}

export function buildSetupHTML(
  count: number,
  names: string[] = [],
  bots: boolean[] = [],
): string {
  const n = clampCount(count)
  const rows = Array.from({ length: n }, (_, i) => {
    const name = escapeHTML(String(names[i] ?? ''))
    const botBox =
      i === 0
        ? '<input class="seat-bot" type="checkbox" disabled aria-label="Seat 1 is always human" />'
        : `<input class="seat-bot" type="checkbox"${bots[i] ? ' checked' : ''} aria-label="Seat ${i + 1} bot" />`
    return (
      `<div class="seat" data-seat="${i}">` +
      `<span class="seat-num">${i + 1}</span>` +
      `<input class="seat-name" type="text" maxlength="${MAX_NAME_LEN}" value="${name}" placeholder="Player ${i + 1}" aria-label="Seat ${i + 1} name" />` +
      '<label class="bot-check">' +
      botBox +
      '<span class="bot-label">Bot</span>' +
      '</label>' +
      '</div>'
    )
  }).join('')
  const counts = [MIN_SEATS, 3, MAX_SEATS]
    .map(
      (c) =>
        `<button type="button" data-count="${c}"${c === n ? ' class="selected" aria-pressed="true"' : ''}>${c} seats</button>`,
    )
    .join('')
  return (
    '<main class="screen screen-setup">' +
    '<h1 class="screen-title">Choose seats</h1>' +
    `<div class="seat-count" role="group" aria-label="Seat count">${counts}</div>` +
    `<form id="seat-picker">${rows}` +
    '<button type="submit" id="start-game">Start game</button>' +
    '</form>' +
    '</main>'
  )
}

// Read the live form: one entry per `.seat` row (clamped to 2-4), names
// trimmed and capped at 16 chars with Player-N defaults, row 0 forced
// human regardless of its disabled checkbox.
export function collectSetup(form: HTMLFormElement): SeatChoice {
  const rows = Array.from(form.querySelectorAll('.seat'))
  const n = clampCount(rows.length)
  const names: string[] = []
  const bots: boolean[] = []
  for (let i = 0; i < n; i++) {
    const row = rows[i] as Element | undefined
    const nameInput = row?.querySelector<HTMLInputElement>('.seat-name')
    const botInput = row?.querySelector<HTMLInputElement>('.seat-bot')
    const fallback =
      DEFAULT_SESSION_NAMES[i] ?? `Player ${i + 1}`
    const clean = String(nameInput?.value ?? '')
      .trim()
      .slice(0, MAX_NAME_LEN)
    names.push(clean === '' ? fallback : clean)
    bots.push(i === 0 ? false : Boolean(botInput?.checked))
  }
  return { names, bots }
}

export function mountSetup(
  root: HTMLElement,
  onStart: (choice: SeatChoice) => void,
): void {
  root.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = root.querySelector<HTMLFormElement>('#seat-picker')
      const current: SeatChoice =
        form !== null ? collectSetup(form) : { names: [], bots: [] }
      const next = Number(btn.dataset.count)
      root.innerHTML = buildSetupHTML(next, current.names, current.bots)
      mountSetup(root, onStart)
    })
  })
  const form = root.querySelector<HTMLFormElement>('#seat-picker')
  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    onStart(collectSetup(form))
  })
}
