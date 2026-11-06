// UI store stub — vanilla Zustand, no React. Holds transient table UI
// state (screen, selection, toast, blank-picker) for later screens to build on.

import { createStore } from 'zustand/vanilla'

export type Screen = 'table'

// A blank tile awaiting its letter: tap-tile→tap-square (or a drop) parks
// the placement here and opens #blank-picker instead of adding an
// undesignated pending tile. `pendingId` is set only when the picker is
// reopened for an already-placed blank (BLANK_NO_LETTER at commit time).
export interface BlankPending {
  rackIndex: number
  sq: string
  pendingId?: number
}

interface UiState {
  screen: Screen
  selected: string | null
  selectedRack: number | null
  toast: string | null
  blankPending: BlankPending | null
  select: (sq: string | null) => void
  selectRack: (index: number | null) => void
  showToast: (msg: string) => void
  clearToast: () => void
  openBlankPicker: (pending: BlankPending) => void
  closeBlankPicker: () => void
}

// Toast visibility contract (issue #8): every toast stays on screen for at
// least 2 s. A single module timer implements it: each showToast clears the
// prior timer and arms a fresh 2600 ms clearToast, so rapid illegal plays
// replace the copy and restart the clock instead of stacking timers.
const TOAST_MS = 2600

let toastTimer: ReturnType<typeof setTimeout> | null = null

function armToastTimer(clear: () => void): void {
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastTimer = null
    clear()
  }, TOAST_MS)
}

function disarmToastTimer(): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

export const uiStore = createStore<UiState>()((set) => ({
  screen: 'table',
  selected: null,
  selectedRack: null,
  toast: null,
  blankPending: null,
  select: (sq) => set({ selected: sq }),
  // Transient tap-tap cursor for rack→square placement. The game store is
  // the placement authority; this mirrors its selectedRack for components
  // that only read UI state. Cleared on every successful place and recall.
  selectRack: (index) => {
    if (index !== null && (!Number.isInteger(index) || index < 0)) return
    set({ selectedRack: index })
  },
  showToast: (msg) => {
    set({ toast: msg })
    armToastTimer(() => uiStore.getState().clearToast())
  },
  clearToast: () => {
    disarmToastTimer()
    set({ toast: null })
  },
  openBlankPicker: (pending) => set({ blankPending: { ...pending } }),
  closeBlankPicker: () => set({ blankPending: null }),
}))
