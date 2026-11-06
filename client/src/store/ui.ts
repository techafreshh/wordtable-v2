// UI store stub — vanilla Zustand, no React. Holds transient table UI
// state (screen, selection, toast) for later screens to build on.

import { createStore } from 'zustand/vanilla'

export type Screen = 'table'

interface UiState {
  screen: Screen
  selected: string | null
  toast: string | null
  select: (sq: string | null) => void
  showToast: (msg: string) => void
  clearToast: () => void
}

export const uiStore = createStore<UiState>()((set) => ({
  screen: 'table',
  selected: null,
  toast: null,
  select: (sq) => set({ selected: sq }),
  showToast: (msg) => set({ toast: msg }),
  clearToast: () => set({ toast: null }),
}))
