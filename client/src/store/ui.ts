// UI store stub — vanilla Zustand, no React. Holds transient table UI
// state (screen, selection, toast) for later screens to build on.

import { createStore } from 'zustand/vanilla'

export type Screen = 'table'

interface UiState {
  screen: Screen
  selected: string | null
  selectedRack: number | null
  toast: string | null
  select: (sq: string | null) => void
  selectRack: (index: number | null) => void
  showToast: (msg: string) => void
  clearToast: () => void
}

export const uiStore = createStore<UiState>()((set) => ({
  screen: 'table',
  selected: null,
  selectedRack: null,
  toast: null,
  select: (sq) => set({ selected: sq }),
  // Transient tap-tap cursor for rack→square placement. The game store is
  // the placement authority; this mirrors its selectedRack for components
  // that only read UI state. Cleared on every successful place and recall.
  selectRack: (index) => {
    if (index !== null && (!Number.isInteger(index) || index < 0)) return
    set({ selectedRack: index })
  },
  showToast: (msg) => set({ toast: msg }),
  clearToast: () => set({ toast: null }),
}))
