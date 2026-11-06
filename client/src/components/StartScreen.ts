// Start screen (issue #10) — nickname plus Create/Join/Play-now. Offline
// ships first, so Create/Join raise the offline toast instead of
// networking; Play now persists the nickname and enters seat setup.

import { navigate } from '../router'
import { uiStore } from '../store/ui'

export const NICKNAME_KEY = 'wordtable.nickname'
export const MAX_NICKNAME_LEN = 16

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function readNickname(): string {
  try {
    return String(localStorage.getItem(NICKNAME_KEY) ?? '')
  } catch {
    // Storage unavailable (private mode, tests): start blank.
    return ''
  }
}

export function persistNickname(value: string): string {
  const nick = String(value ?? '')
    .trim()
    .slice(0, MAX_NICKNAME_LEN)
  try {
    localStorage.setItem(NICKNAME_KEY, nick)
  } catch {
    // Storage unavailable: the trimmed name still returns for callers.
  }
  return nick
}

function currentNickname(root: HTMLElement): string {
  const input = root.querySelector<HTMLInputElement>('#nickname')
  return persistNickname(input?.value ?? '')
}

export function buildStartScreenHTML(nickname: string): string {
  const nick = escapeHTML(
    String(nickname ?? '').slice(0, MAX_NICKNAME_LEN),
  )
  return (
    '<main class="screen screen-start">' +
    '<h1 class="screen-title">Wordtable</h1>' +
    '<p class="screen-sub">Offline hot-seat word game</p>' +
    '<label class="nick-label" for="nickname">Nickname</label>' +
    `<input id="nickname" name="nickname" maxlength="${MAX_NICKNAME_LEN}" value="${nick}" autocomplete="nickname" />` +
    '<div class="screen-actions">' +
    '<button type="button" data-action="create">Create</button>' +
    '<button type="button" data-action="join">Join</button>' +
    '<button type="button" data-action="play">Play now</button>' +
    '</div>' +
    '</main>'
  )
}

export function mountStartScreen(
  root: HTMLElement,
  onPlayNow?: () => void,
): void {
  root
    .querySelector('[data-action="play"]')
    ?.addEventListener('click', () => {
      currentNickname(root)
      if (onPlayNow) onPlayNow()
      else navigate('setup')
    })
  const offline = (): void => {
    currentNickname(root)
    uiStore.getState().showToast('Offline mode: rooms are not available yet')
  }
  root.querySelector('[data-action="create"]')?.addEventListener('click', offline)
  root.querySelector('[data-action="join"]')?.addEventListener('click', offline)
}
