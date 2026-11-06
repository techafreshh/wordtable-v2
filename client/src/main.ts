import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import { buildBoardHTMLWithPending, mountBoardInteractions } from './components/Board'
import {
  buildRackActionsHTML,
  buildRackTilesHTML,
  mountRack,
  mountRackActions,
} from './components/Rack'
import { gameStore, provScoreText } from './store/game'
import { uiStore } from './store/ui'
import { TileBag } from '../../shared/engine/bag'

// Offline table boot (issue #7): the rack plus placement loop lives entirely
// in the client. Board, rack, provisional chip and Recall/Shuffle render on
// load so an offline game is always playable; Play re-renders the same
// table idempotically. `?rack=HELLO??` seeds the rack (1-7 chars of A-Z/?,
// case-insensitive) for deterministic probes, otherwise seven tiles come
// from TileBag(1).

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
  const state = gameStore.getState()
  const host = app.querySelector<HTMLElement>('.board-host')
  if (host) host.innerHTML = buildBoardHTMLWithPending({}, state.pending)
  const score = app.querySelector<HTMLElement>('#prov-score')
  if (score) {
    score.textContent = provScoreText(state.provScore)
    score.title = state.provWords.join(' ')
  }
  const rack = app.querySelector<HTMLElement>('#rack')
  if (rack) rack.innerHTML = buildRackTilesHTML(state.rack, state.selectedRack)
}

function bootTable(): void {
  const app = document.getElementById('app')
  if (!app) return
  if (!app.querySelector('.board-host')) {
    app.innerHTML =
      '<main class="table">' +
      '<h1 class="table-title">Wordtable</h1>' +
      '<div class="board-host"></div>' +
      '<div id="prov-score" role="status" aria-live="polite">0 pts</div>' +
      '<div id="rack" class="rack" role="listbox" aria-label="Rack"></div>' +
      buildRackActionsHTML() +
      '<div class="table-actions">' +
      '<button type="button" data-action="create">Create</button>' +
      '<button type="button" data-action="join">Join</button>' +
      '<button type="button" data-action="play">Play</button>' +
      '</div></main>'
  }
  const host = app.querySelector<HTMLElement>('.board-host')
  const rack = app.querySelector<HTMLElement>('#rack')
  const actions = app.querySelector<HTMLElement>('#rack-actions')
  if (host) mountBoardInteractions(host)
  if (rack) mountRack(rack)
  if (actions) mountRackActions(actions)
  const tableActions = app.querySelector<HTMLElement>('.table-actions')
  if (tableActions && tableActions.dataset.mounted !== '1') {
    tableActions.dataset.mounted = '1'
    tableActions.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button[data-action="play"]')) renderAll()
    })
  }
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
    return {
      rack: state.rack.map((t) => (t.isBlank ? '?' : t.face)),
      rackCount: state.rack.length,
      pending: state.pending.map((p) => ({ sq: p.sq, face: p.isBlank ? '?' : p.face })),
      pendingCount: state.pending.length,
      provScore: state.provScore,
      provWords: [...state.provWords],
      provText: provScoreText(state.provScore),
      selectedRack: state.selectedRack,
    }
  },
  reset: () => {
    gameStore.getState().reset()
  },
}

bootTable()
gameStore.subscribe(renderAll)
uiStore.subscribe(renderAll)
gameStore.getState().setRack(readSeededFaces() ?? dealFaces())
