// Offline lobby (issue #10) — plaques for the hot-seat lineup with bot
// badges, then Start into the table or Edit back to the seat picker.
// Pure string builder plus a mount, Board.ts style.

import { navigate } from '../router'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildLobbyHTML(names: string[], bots: boolean[]): string {
  const plaques = names
    .map((raw, i) => {
      const name = escapeHTML(String(raw ?? ''))
      const bot = i === 0 ? false : Boolean(bots[i])
      return (
        `<div class="seat${bot ? ' bot' : ''}" data-seat="${i}">` +
        `<span class="seat-name">${name}</span>` +
        (bot ? '<span class="bot-badge">Bot</span>' : '') +
        '</div>'
      )
    })
    .join('')
  return (
    '<main class="screen screen-lobby">' +
    '<section id="lobby" aria-label="Offline lobby">' +
    '<h1 class="screen-title">Lobby</h1>' +
    `<div class="lobby-seats">${plaques}</div>` +
    '<div class="screen-actions">' +
    '<button type="button" id="lobby-edit">Edit seats</button>' +
    '<button type="button" id="lobby-start">Start</button>' +
    '</div>' +
    '</section>' +
    '</main>'
  )
}

export function mountLobby(
  root: HTMLElement,
  opts?: { onStart?: () => void; onEdit?: () => void },
): void {
  root.querySelector('#lobby-start')?.addEventListener('click', () => {
    if (opts?.onStart) opts.onStart()
    else navigate('table')
  })
  root.querySelector('#lobby-edit')?.addEventListener('click', () => {
    if (opts?.onEdit) opts.onEdit()
    else navigate('setup')
  })
}
