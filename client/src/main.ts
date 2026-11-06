import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import './styles/hud.css'
import { mountTable, renderTable } from './components/Table'
import { gameStore, provScoreText } from './store/game'
import { DEFAULT_SEAT_NAMES, uiStore } from './store/ui'
import { TileBag } from '../../shared/engine/bag'

// Offline table boot (issues #7/#8): the rack plus placement loop lives
// entirely in the client. Board, rack, provisional chip, Recall/Shuffle and
// Play commit/reject render on load so an offline game is always playable.
// `?rack=HELLO??` seeds the rack (1-7 chars of A-Z/?, case-insensitive) for
// deterministic probes, otherwise seven tiles come from TileBag(1).

function readSeededFaces(): string[] | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('rack')
    if (!raw) return null
    const faces = [...raw.toUpperCase()]
      .filter((ch) => ch === '?' || (ch >= 'A' && ch <= 'Z'))
      .slice(0, 7)
    return faces.length > 0 ? faces : null
  } catch {
    return null
  }
}

function dealFaces(): string[] {
  return new TileBag(1).draw(7).map((t) => (t.isBlank ? '?' : t.face))
}

// HUD boot (issue #9): `?seats=N` (clamped 2-4) selects the lineup,
// `?turn=K` the starting seat. Invalid values keep the store defaults.
function bootHudFromURL(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const rawSeats = params.get('seats')
    if (rawSeats !== null) {
      const n = Number(rawSeats)
      if (Number.isInteger(n)) {
        const count = Math.min(4, Math.max(2, n))
        uiStore.getState().setSeats(DEFAULT_SEAT_NAMES.slice(0, count))
      }
    }
    const rawTurn = params.get('turn')
    if (rawTurn !== null) {
      const t = Number(rawTurn)
      if (Number.isInteger(t)) uiStore.getState().setTurn(t)
    }
  } catch {
    // URL unavailable (tests): keep the store defaults.
  }
}

function renderAll(): void {
  const app = document.getElementById('app')
  if (!app) return
  renderTable(app)
}

function bootTable(): void {
  const app = document.getElementById('app')
  if (!app) return
  bootHudFromURL()
  mountTable(app)
  renderAll()
}

// Test-only hook: probes force racks like HELLO?? and read pending/score
// without touching the bag. Gameplay never depends on it.
declare global {
  interface Window {
    __wordtable?: {
      setRack: (faces: string) => void
      setSeats: (n: number) => void
      setTurn: (i: number) => void
      setScores: (s: number[]) => void
      sendChat: (text: string) => boolean
      receiveChat: (from: string, text: string) => boolean
      getState: () => {
        rack: string[]
        rackCount: number
        pending: { sq: string; face: string }[]
        pendingCount: number
        provScore: number
        provWords: string[]
        provText: string
        selectedRack: number | null
        lastMove: string[]
        lastScore: number | null
        toast: string | null
        blankPending: { rackIndex: number; sq: string } | null
        seats: string[]
        scores: number[]
        turn: number
        chat: { from: string; text: string; ts: number }[]
        chatOpen: boolean
        unread: number
      }
      reset: () => void
    }
  }
}

window.__wordtable = {
  setRack: (faces: string) => {
    gameStore.getState().setRack([...String(faces ?? '')])
  },
  setSeats: (n: number) => {
    if (!Number.isInteger(n)) return
    const count = Math.min(4, Math.max(2, n))
    uiStore.getState().setSeats(DEFAULT_SEAT_NAMES.slice(0, count))
  },
  setTurn: (i: number) => {
    uiStore.getState().setTurn(i)
  },
  setScores: (s: number[]) => {
    uiStore.getState().setScores([...(s ?? [])])
  },
  sendChat: (text: string) => uiStore.getState().sendChat(text),
  receiveChat: (from: string, text: string) =>
    uiStore.getState().receiveChat(from, text),
  getState: () => {
    const state = gameStore.getState()
    const ui = uiStore.getState()
    return {
      rack: state.rack.map((t) => (t.isBlank ? '?' : t.face)),
      rackCount: state.rack.length,
      pending: state.pending.map((p) => ({ sq: p.sq, face: p.isBlank ? '?' : p.face })),
      pendingCount: state.pending.length,
      provScore: state.provScore,
      provWords: [...state.provWords],
      provText: provScoreText(state.provScore),
      selectedRack: state.selectedRack,
      lastMove: [...state.lastMove],
      lastScore: state.lastScore,
      toast: ui.toast,
      blankPending: ui.blankPending ? { ...ui.blankPending } : null,
      seats: [...ui.seats],
      scores: [...ui.scores],
      turn: ui.turn,
      chat: ui.chat.map((m) => ({ ...m })),
      chatOpen: ui.chatOpen,
      unread: ui.unread,
    }
  },
  reset: () => {
    gameStore.getState().reset()
    uiStore.getState().resetTable()
    uiStore.getState().clearToast()
    uiStore.getState().closeBlankPicker()
    bootHudFromURL()
  },
}

bootTable()
gameStore.subscribe(renderAll)
uiStore.subscribe(renderAll)
gameStore.getState().setRack(readSeededFaces() ?? dealFaces())
