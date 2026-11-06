// Router boot (issue #10) — hash-routed offline hot-seat loop over the
// session store: Start → Setup → Lobby → Table → Recap. The session wraps
// LocalGame, so turns, six-pass endings and rematch come from the engine;
// this module only guards routes and paints the matching screen module.
//
// Coexistence with the placement Table (issues #7-9): the legacy
// rack/pending/commit loop stays mounted on the `start` route alongside
// the StartScreen (same #screen container, StartScreen first so its
// `data-action="play"` wins global queries and the Table's scoped
// `.table-actions` delegation still commits). `?rack/?seats/?turn` boot,
// `fx.css`, and the game/ui store subscriptions are kept so a bare `/`
// load still shows the rack, provisional chip, Recall/Shuffle, chat and
// sounds. Hot-seat routes (#/setup, #/lobby, #/table, #/recap) render only
// their screen module, keeping `.seat` counts exact for the loop probes.

import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import './styles/hud.css'
import './styles/screens.css'
import { GameStatus } from '../../shared/engine/game'
import type { LocalSnapshot } from '../../shared/engine/local'
import { parseRoute, navigate, startRouter, type Route } from './router'
import {
  buildStartScreenHTML,
  mountStartScreen,
  readNickname,
} from './components/StartScreen'
import { buildSetupHTML, mountSetup } from './components/Setup'
import { buildLobbyHTML, mountLobby } from './components/Lobby'
import { buildHotSeatTableHTML, mountHotSeatTable } from './components/HotSeatTable'
import { buildRecapHTML, mountRecap } from './components/Recap'
import { buildToastHTML, mountToast } from './components/Toast'
import { mountTable, renderTable, tableSkeletonHTML } from './components/Table'
import { gameStore, provScoreText } from './store/game'
import { DEFAULT_SEAT_NAMES, uiStore } from './store/ui'
import { sessionStore } from './store/session'
import { TileBag } from '../../shared/engine/bag'
import { initTableBackdrop } from './three/table'

// Offline table boot (issues #7/#8): the rack plus placement loop lives
// in the client. `?rack=HELLO??` seeds the rack (1-7 chars of A-Z/?,
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

// Seat-picker draft: survives lobby-edit round trips so names are kept
// when the user goes back to tweak seats. Refreshed on every start.
let setupDraft: { count: number; names: string[]; bots: boolean[] } = {
  count: 2,
  names: [],
  bots: [],
}

function screenHost(): HTMLElement | null {
  return document.getElementById('screen')
}

// Every navigate() repaints synchronously, so the trailing hashchange for
// the same hash is a no-op: each navigation paints exactly once and the
// DOM is stable the moment the hash updates for hash-polling readers.
let paintedHash: string | null = null

function handleRoute(): void {
  if (paintedHash === window.location.hash) return
  render()
}

function currentRoute(): Route {
  return parseRoute(window.location.hash)
}

// Legacy region repaint: only the `start` route hosts the Table, so
// game/ui intents on hot-seat routes must not touch HotSeatTable's
// `.board-host` (renderTable would overwrite committed tiles with the
// placement board). Guarded by route, not by node presence.
function repaintLegacyTable(): void {
  if (currentRoute() !== 'start') return
  const host = screenHost()
  if (!host || !host.querySelector('.table')) return
  renderTable(host)
}

// Route guards: #/table needs a live session, #/lobby needs one too
// (a deep link with no session bounces to setup instead of painting an
// empty lobby), #/recap needs an ended one. Anything unguarded falls
// back one step (recap → table → setup).
function render(): void {
  const host = screenHost()
  if (!host) return
  const raw = currentRoute()
  const snap = sessionStore.getState().snapshot()
  let route = raw
  if (route === 'table' && snap === null) route = 'setup'
  else if (route === 'lobby' && snap === null) route = 'setup'
  else if (
    route === 'recap' &&
    (snap === null || snap.status !== GameStatus.ENDED)
  ) {
    route = snap === null ? 'setup' : 'table'
  }
  if (route !== raw) {
    navigate(route)
    paintedHash = window.location.hash
    return
  }
  uiStore.getState().setScreen(route)
  switch (route) {
    case 'start': {
      // StartScreen above the legacy Table: offline Create/Join toasts
      // surface through the Table's own #toast node.
      host.innerHTML =
        buildStartScreenHTML(readNickname()) + tableSkeletonHTML()
      mountStartScreen(host, () => navigate('setup'))
      mountTable(host)
      renderTable(host)
      break
    }
    case 'setup': {
      if (setupDraft.names.length === 0) setupDraft.names = [readNickname()]
      host.innerHTML =
        buildSetupHTML(
          setupDraft.count,
          setupDraft.names,
          setupDraft.bots,
        ) + buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountSetup(host, (choice) => {
        sessionStore.getState().startSession(choice.names, choice.bots)
        setupDraft = {
          count: choice.names.length,
          names: choice.names,
          bots: choice.bots,
        }
        navigate('lobby')
      })
      break
    }
    case 'lobby': {
      const state = sessionStore.getState()
      if (state.names.length === 0) {
        navigate('setup')
        paintedHash = window.location.hash
        return
      }
      host.innerHTML =
        buildLobbyHTML(state.names, state.isBot) +
        buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountLobby(host)
      break
    }
    case 'table': {
      const tableSnap = sessionStore.getState().snapshot()
      // Re-checked after the guard: a pass (button, bot timer or hook)
      // may have ended the game while this route was already showing.
      if (tableSnap === null) {
        navigate('setup')
        paintedHash = window.location.hash
        return
      }
      if (tableSnap.status !== GameStatus.PLAYING) {
        navigate('recap')
        paintedHash = window.location.hash
        return
      }
      host.innerHTML =
        buildHotSeatTableHTML(tableSnap) +
        buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountHotSeatTable(host)
      break
    }
    case 'recap': {
      const ended = sessionStore.getState().snapshot()
      if (ended === null) {
        navigate('setup')
        paintedHash = window.location.hash
        return
      }
      host.innerHTML =
        buildRecapHTML(ended, sessionStore.getState().wordHistory()) +
        buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountRecap(host)
      break
    }
  }
  paintedHash = window.location.hash
}

// Test/black-box hook: the legacy placement-table fields (issues #7-9)
// drive their stores, and the session fields force the offline loop
// (six passes, rematch, snapshot) without touching the DOM.
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
      pass: () => void
      rematch: () => void
      snapshot: () => LocalSnapshot | null
      startSession: (names: string[], bots?: boolean[]) => void
    }
  }
}

function installHook(): void {
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
    pass: () => {
      sessionStore.getState().passTurn()
    },
    rematch: () => {
      sessionStore.getState().rematch()
      navigate('table')
    },
    snapshot: () => sessionStore.getState().snapshot(),
    startSession: (names: string[], bots?: boolean[]) => {
      sessionStore.getState().startSession(names, bots ?? [])
    },
  }
}

function boot(): void {
  const app = document.getElementById('app')
  if (!app) return
  bootHudFromURL()
  app.innerHTML = '<div id="screen"></div>'
  startRouter(() => handleRoute())
  gameStore.subscribe(repaintLegacyTable)
  uiStore.subscribe(repaintLegacyTable)
  // Session intents (button passes, bot auto-pass, hook forcing) repaint
  // the table/recap/lobby. Start/setup keep their inputs: no session
  // intent can fire while they are showing (seat 0 is always human).
  sessionStore.subscribe(() => {
    const route = currentRoute()
    if (route === 'start' || route === 'setup') return
    render()
  })
  installHook()
  render()
  gameStore.getState().setRack(readSeededFaces() ?? dealFaces())
  // Table backdrop (issue #11): ambient felt scene behind the board.
  // Board-first boot — the backdrop mounts after the 225-square grid,
  // and any failure (including ?nogl=1) keeps the CSS gradient fallback.
  try {
    const backdrop = document.getElementById('backdrop')
    if (backdrop !== null) initTableBackdrop(backdrop)
  } catch {
    // Decorative only: a backdrop failure must never break the board.
  }
}

boot()
