// Blank picker — the A-Z letter modal a blank tile demands before it may
// join the pending placement (issue #8). Pure template-string markup like
// Board.ts: buildBlankPickerHTML always renders exactly 26
// <button data-letter="A"…"Z"> plus one cancel button (no data-letter, so
// letter counts stay exact); visibility is the [hidden] attribute on the
// #blank-picker root. Letter clicks resolve the uiStore.blankPending slot:
// pre-place pendings go through gameStore.placeTileAs, already-placed
// undesignated blanks through gameStore.designateBlank.

import { gameStore } from '../store/game'
import { uiStore } from '../store/ui'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function letterButtons(): string {
  let out = ''
  for (const letter of LETTERS) {
    out += `<button type="button" data-letter="${letter}">${letter}</button>`
  }
  return out
}

export function buildBlankPickerHTML(): string {
  return (
    '<div id="blank-picker" hidden>' +
    '<div class="picker-sheet" role="dialog" aria-modal="true" aria-label="Choose a letter">' +
    '<p class="picker-title">Choose a letter</p>' +
    `<div class="picker-grid">${letterButtons()}</div>` +
    '<button type="button" data-action="cancel-picker">Cancel</button>' +
    '</div></div>'
  )
}

// Park a blank placement and open the picker synchronously (same task as
// the tap/drop), so no undesignated pending tile ever hits the board.
export function openBlankPickerFor(rackIndex: number, sq: string): void {
  uiStore.getState().openBlankPicker({ rackIndex, sq })
}

function resolveLetter(letter: string): void {
  const pending = uiStore.getState().blankPending
  if (!pending) return
  if (pending.pendingId !== undefined && pending.pendingId !== null) {
    gameStore.getState().designateBlank(pending.pendingId, letter)
  } else {
    gameStore.getState().placeTileAs(pending.rackIndex, pending.sq, letter)
  }
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().closeBlankPicker()
}

function cancelPicker(): void {
  const pending = uiStore.getState().blankPending
  // Cancelling a reopened (already-placed) blank slides it back to the
  // rack; cancelling a pre-place blank just leaves the tile where it was.
  if (
    pending !== null &&
    pending.pendingId !== undefined &&
    pending.pendingId !== null
  ) {
    gameStore.getState().returnTile(pending.pendingId)
  }
  uiStore.getState().closeBlankPicker()
}

export function mountBlankPicker(pickerEl: HTMLElement): void {
  if (pickerEl.dataset.mounted === '1') return
  pickerEl.dataset.mounted = '1'

  pickerEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const letterBtn = target.closest?.('button[data-letter]')
    if (letterBtn && pickerEl.contains(letterBtn)) {
      const letter = letterBtn.getAttribute('data-letter') ?? ''
      if (/^[A-Z]$/.test(letter)) resolveLetter(letter)
      return
    }
    const cancelBtn = target.closest?.('button[data-action="cancel-picker"]')
    if (cancelBtn && pickerEl.contains(cancelBtn)) cancelPicker()
  })

  // Dialog keyboard contract (matches role="dialog" aria-modal="true"):
  // Escape cancels, Tab wraps focus among the sheet buttons.
  pickerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelPicker()
      return
    }
    if (e.key !== 'Tab') return
    let buttons: HTMLElement[]
    try {
      const list = pickerEl.querySelectorAll(
        '.picker-sheet button:not([disabled])',
      )
      buttons = Array.from(list) as HTMLElement[]
    } catch {
      return
    }
    if (buttons.length === 0) return
    const first = buttons[0] as HTMLElement
    const last = buttons[buttons.length - 1] as HTMLElement
    const current = (e.target as HTMLElement | null) ?? null
    if (e.shiftKey) {
      if (current === first) {
        e.preventDefault()
        try {
          last.focus()
        } catch {
          // Focus is decorative; the wrap still counts as handled.
        }
      }
    } else if (current === last) {
      e.preventDefault()
      try {
        first.focus()
      } catch {
        // Focus is decorative; the wrap still counts as handled.
      }
    }
  })

  // Autofocus the A button on the closed → open transition only; every
  // repaint while open leaves focus alone. Guarded like StartScreen so
  // fake-DOM hosts without focus support never throw.
  let wasOpen = false
  const paint = (): void => {
    const open = uiStore.getState().blankPending !== null
    if (open) pickerEl.removeAttribute('hidden')
    else pickerEl.setAttribute('hidden', '')
    if (open && !wasOpen) {
      try {
        pickerEl
          .querySelector<HTMLButtonElement>('button[data-letter="A"]')
          ?.focus()
      } catch {
        // Focus is decorative; the sheet still opens.
      }
    }
    wasOpen = open
  }
  paint()
  uiStore.subscribe(paint)
}
