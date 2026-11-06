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

  const paint = (): void => {
    if (uiStore.getState().blankPending) pickerEl.removeAttribute('hidden')
    else pickerEl.setAttribute('hidden', '')
  }
  paint()
  uiStore.subscribe(paint)
}
