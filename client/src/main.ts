import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import { mountTable, renderTable } from './components/Table'
import { gameStore, provScoreText } from './store/game'
import { uiStore } from './store/ui'
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

function renderAll(): void {
  const app = document.getElementById('app')
  if (!app) return
  renderTable(app)
}

function bootTable(): void {
  const app = document.getElementById('app')
  if (!app) return
  mountTable(app)
  renderAll()
}

// Test-only hook: probes force racks like HELLO?? and read pending/score
// without touching the bag. Gameplay never depends on it.
declare global {
  interface Window {
    __wordtable?: {
      setRack: (faces: string) => void
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
      }
      reset: () => void
    }
  }
}

window.__wordtable = {
  setRack: (faces: string) => {
    gameStore.getState().setRack([...String(faces ?? '')])
  },
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
    }
  },
  reset: () => {
    gameStore.getState().reset()
    uiStore.getState().clearToast()
    uiStore.getState().closeBlankPicker()
  },
}

bootTable()
gameStore.subscribe(renderAll)
uiStore.subscribe(renderAll)
gameStore.getState().setRack(readSeededFaces() ?? dealFaces())
