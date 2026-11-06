// Recap (issue #10) — podium sorted score-desc, the full word history and
// a one-click rematch into the same seats with a fresh bag. Pure string
// builder plus a mount, Board.ts style.

import type { LocalSnapshot } from '../../../shared/engine/local'
import { sessionStore, type WordHistoryEntry } from '../store/session'
import { navigate } from '../router'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildRecapHTML(
  snapshot: LocalSnapshot,
  history: readonly WordHistoryEntry[],
): string {
  const order = snapshot.names
    .map((raw, seat) => ({
      seat,
      name: String(raw ?? ''),
      score: snapshot.scores[seat] ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
  const rows = order
    .map(
      (row, rank) =>
        `<div class="podium-row${rank === 0 ? ' winner' : ''}" data-seat="${row.seat}">` +
        `<span class="podium-rank">${rank + 1}</span>` +
        `<span class="seat-name">${escapeHTML(row.name)}</span>` +
        `<span class="seat-score">${row.score}</span>` +
        '</div>',
    )
    .join('')
  const items =
    history.length === 0
      ? '<li class="history-empty">No words played</li>'
      : history
          .map((e) => {
            const who = escapeHTML(
              String(snapshot.names[e.seat] ?? `Seat ${e.seat + 1}`),
            )
            const words = e.words.map(escapeHTML).join(', ')
            return `<li data-seat="${e.seat}">${who}: ${words} (+${e.points})</li>`
          })
          .join('')
  return (
    '<main class="screen screen-recap">' +
    '<h1 class="screen-title">Results</h1>' +
    `<div class="podium" aria-label="Podium">${rows}</div>` +
    `<ul id="word-history" aria-label="Word history">${items}</ul>` +
    '<div class="screen-actions">' +
    '<button type="button" id="rematch">Rematch</button>' +
    '</div>' +
    '</main>'
  )
}

export function mountRecap(root: HTMLElement, onRematch?: () => void): void {
  root.querySelector('#rematch')?.addEventListener('click', () => {
    if (onRematch) {
      onRematch()
      return
    }
    sessionStore.getState().rematch()
    navigate('table')
  })
}
