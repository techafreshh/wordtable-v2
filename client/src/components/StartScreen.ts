// Start screen (issue #10) — nickname plus Create/Join/Play-now. Offline
// ships first, so Create/Join raise the offline toast instead of
// networking; Play now persists the nickname and enters seat setup.

import { navigate } from '../router'
import { net } from '../store/net'
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

// Join-code normalization (issue #88): trimmed + uppercased; anything
// outside `^[A-Z]{4}$` is a local refusal (toast, no dial) so typos never
// burn a socket round-trip. Protocol aliases are 4 letters by contract.
export function normalizeJoinCode(raw: string): string | null {
  const code = String(raw ?? '').trim().toUpperCase()
  return /^[A-Z]{4}$/.test(code) ? code : null
}

// Join modal (issue #88): a 4-char code entry rendered into the start
// root on Join click, mirroring the StartScreen builder idiom.
export function buildJoinModalHTML(): string {
  return (
    '<div id="join-modal" role="dialog" aria-label="Join room">' +
    '<label for="join-code">Room code</label>' +
    '<input id="join-code" name="join-code" maxlength="4" autocomplete="off"' +
    ' placeholder="ABCD" aria-label="4-letter room code" />' +
    '<div class="screen-actions">' +
    '<button type="button" id="join-confirm">Join room</button>' +
    '<button type="button" id="join-cancel">Cancel</button>' +
    '</div>' +
    '</div>'
  )
}

function closeJoinModal(root: HTMLElement): void {
  root.querySelector('#join-modal')?.remove()
}

function setOnlineBusy(root: HTMLElement, busy: boolean): void {
  // Play-now also locks mid-dial so a Create click hijacked by a late
  // navigate cannot strand the user on the wrong route.
  for (const action of ['create', 'join', 'play'] as const) {
    const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
    if (button) button.disabled = busy
  }
}

// Shared create/join tail: dial the configured server, run the intent,
// surface `!ok` as a toast, else seed the lobby lineup optimistically
// and land on the online lobby. Empty nicknames send `''` so the
// server normalizes to Player (no client-side default invention).
async function dialAndEnter(
  root: HTMLElement,
  intent: (name: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<void> {
  const name = currentNickname(root)
  setOnlineBusy(root, true)
  try {
    const dialled = await net.connect()
    if (!dialled.ok) {
      uiStore.getState().showToast(dialled.error ?? 'NOT_CONNECTED')
      return
    }
    const reply = await intent(name)
    if (!reply.ok) {
      uiStore.getState().showToast(reply.error ?? 'BAD_REPLY')
      return
    }
    uiStore.getState().setSeats([name === '' ? 'Player' : name])
    navigate('online-lobby')
  } finally {
    setOnlineBusy(root, false)
  }
}

function openJoinModal(root: HTMLElement): void {
  closeJoinModal(root)
  try {
    root.insertAdjacentHTML('beforeend', buildJoinModalHTML())
  } catch {
    return
  }
  const modal = root.querySelector('#join-modal')
  if (!modal) return
  const input = modal.querySelector<HTMLInputElement>('#join-code')
  try {
    input?.focus()
  } catch {
    // Focus is decorative; the modal still accepts typed codes.
  }
  modal.querySelector('#join-cancel')?.addEventListener('click', () => {
    closeJoinModal(root)
  })
  const submit = (): void => {
    const code = normalizeJoinCode(input?.value ?? '')
    if (code === null) {
      uiStore.getState().showToast('Enter a 4-letter code')
      return
    }
    closeJoinModal(root)
    void dialAndEnter(root, (name) => net.joinRoom(code, name))
  }
  modal.querySelector('#join-confirm')?.addEventListener('click', submit)
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  })
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
  root
    .querySelector('[data-action="create"]')
    ?.addEventListener('click', () => {
      void dialAndEnter(root, (name) => net.createRoom(name))
    })
  root
    .querySelector('[data-action="join"]')
    ?.addEventListener('click', () => {
      openJoinModal(root)
    })
}
