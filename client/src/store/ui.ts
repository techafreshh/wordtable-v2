// UI store stub — vanilla Zustand, no React. Holds transient table UI
// state (screen, selection, toast, blank-picker) for later screens to build on.

import { createStore } from 'zustand/vanilla'
import { truncateChatText } from '../../../shared/engine/chat-text'

export type Screen =
  | 'start'
  | 'setup'
  | 'lobby'
  | 'table'
  | 'recap'
  | 'online-lobby'
  | 'online-table'

// A blank tile awaiting its letter: tap-tile→tap-square (or a drop) parks
// the placement here and opens #blank-picker instead of adding an
// undesignated pending tile. `pendingId` is set only when the picker is
// reopened for an already-placed blank (BLANK_NO_LETTER at commit time).
export interface BlankPending {
  rackIndex: number
  sq: string
  pendingId?: number
}

export interface ChatMessage {
  from: string
  text: string
  ts: number
}

// Default table lineup (issue #9): sliced to `?seats=N` (clamped 2-4)
// at boot. Names are capped at 16 chars like the engine facade.
export const DEFAULT_SEAT_NAMES: readonly string[] = [
  'You',
  'Rival 1',
  'Rival 2',
  'Rival 3',
]

interface UiState {
  screen: Screen
  selected: string | null
  selectedRack: number | null
  toast: string | null
  blankPending: BlankPending | null
  exchangeOpen: boolean
  exchangeSelected: number[]
  seats: string[]
  scores: number[]
  turn: number
  turnStartedAt: number
  chat: ChatMessage[]
  chatOpen: boolean
  unread: number
  select: (sq: string | null) => void
  setScreen: (screen: Screen) => void
  selectRack: (index: number | null) => void
  setExchangeOpen: (open: boolean) => void
  toggleExchangeIndex: (index: number) => void
  clearExchange: () => void
  showToast: (msg: string) => void
  clearToast: () => void
  openBlankPicker: (pending: BlankPending) => void
  closeBlankPicker: () => void
  setSeats: (names: string[]) => void
  setScores: (scores: number[]) => void
  setTurn: (index: number) => void
  toggleChat: () => void
  setChatOpen: (open: boolean) => void
  sendChat: (text: string) => boolean
  receiveChat: (from: string, text: string) => boolean
  resetTable: () => void
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

export const uiStore = createStore<UiState>()((set, get) => ({
  screen: 'start',
  selected: null,
  selectedRack: null,
  toast: null,
  blankPending: null,
  exchangeOpen: false,
  exchangeSelected: [],
  seats: [...DEFAULT_SEAT_NAMES],
  scores: [0, 0, 0, 0],
  turn: 0,
  turnStartedAt: Date.now(),
  chat: [],
  chatOpen: false,
  unread: 0,
  select: (sq) => set({ selected: sq }),
  setScreen: (screen) => set({ screen }),
  // Transient tap-tap cursor for rack→square placement. The game store is
  // the placement authority; this mirrors its selectedRack for components
  // that only read UI state. Cleared on every successful place and recall.
  selectRack: (index) => {
    if (index !== null && (!Number.isInteger(index) || index < 0)) return
    set({ selectedRack: index })
  },
  // Transient exchange selection (issue #89): rack indices multi-picked
  // while the exchange panel is open. Closing the panel clears the
  // selection; toggling dedupes, sorts and ignores bad indices.
  setExchangeOpen: (open) => {
    if (!open) set({ exchangeOpen: false, exchangeSelected: [] })
    else set({ exchangeOpen: true })
  },
  toggleExchangeIndex: (index) => {
    if (!Number.isInteger(index) || index < 0) return
    set((s) => {
      if (!s.exchangeOpen) return s
      const has = s.exchangeSelected.includes(index)
      const next = has
        ? s.exchangeSelected.filter((i) => i !== index)
        : [...s.exchangeSelected, index].sort((a, b) => a - b)
      return { exchangeSelected: next }
    })
  },
  clearExchange: () => set({ exchangeOpen: false, exchangeSelected: [] }),
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
  // Seat lineup is always 2-4: overlong lists truncate, short ones pad
  // with the default names so scores/turn stay aligned.
  setSeats: (names) => {
    const clean = names
      .map((n) => String(n ?? '').trim().slice(0, 16))
      .filter((n) => n !== '')
      .slice(0, 4)
    while (clean.length < 2) clean.push(DEFAULT_SEAT_NAMES[clean.length] ?? 'Rival')
    set((s) => {
      const scores = s.scores.slice(0, clean.length)
      while (scores.length < clean.length) scores.push(0)
      return {
        seats: clean,
        scores,
        turn: Math.min(Math.max(0, s.turn), clean.length - 1),
        turnStartedAt: Date.now(),
      }
    })
  },
  // Scores align to the seat lineup: truncate/pad, non-finite → 0.
  setScores: (scores) => {
    set((s) => {
      const next = scores
        .slice(0, s.seats.length)
        .map((v) => (Number.isFinite(v) ? Math.floor(v) : 0))
      while (next.length < s.seats.length) next.push(0)
      return { scores: next }
    })
  },
  // Every turn change restarts the 90 s display clock.
  setTurn: (index) => {
    const seats = get().seats
    if (seats.length === 0) return
    const clamped = Number.isInteger(index)
      ? Math.min(Math.max(0, index), seats.length - 1)
      : 0
    set({ turn: clamped, turnStartedAt: Date.now() })
  },
  // Opening the panel marks everything read.
  toggleChat: () => {
    set((s) => ({
      chatOpen: !s.chatOpen,
      unread: !s.chatOpen ? 0 : s.unread,
    }))
  },
  // Explicit setter for the panel close affordances (issue #92):
  // opening clears the badge, closing preserves it, mirroring toggleChat.
  setChatOpen: (open) => {
    set((s) => ({
      chatOpen: open,
      unread: open ? 0 : s.unread,
    }))
  },
  // Local-echo send: trim, reject blank, truncate to 200 chars.
  // `from` is the current seat name; the net layer will feed remote
  // traffic through receiveChat instead.
  sendChat: (text) => {
    const body = truncateChatText(String(text ?? '').trim())
    if (body === '') return false
    const s = get()
    const from = s.seats[s.turn] ?? s.seats[0] ?? 'You'
    set({ chat: [...s.chat, { from, text: body, ts: Date.now() }] })
    return true
  },
  // Remote seam for the future net module: appends, and bumps the
  // badge only while the panel is closed.
  receiveChat: (from, text) => {
    const body = truncateChatText(String(text ?? '').trim())
    if (body === '') return false
    const name = String(from ?? '').trim().slice(0, 16) || 'Rival'
    const s = get()
    set({
      chat: [...s.chat, { from: name, text: body, ts: Date.now() }],
      unread: s.chatOpen ? s.unread : s.unread + 1,
    })
    return true
  },
  resetTable: () => {
    set({
      exchangeOpen: false,
      exchangeSelected: [],
      seats: [...DEFAULT_SEAT_NAMES],
      scores: [0, 0, 0, 0],
      turn: 0,
      turnStartedAt: Date.now(),
      chat: [],
      chatOpen: false,
      unread: 0,
    })
  },
}))
