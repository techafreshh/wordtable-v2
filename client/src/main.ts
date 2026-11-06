// Router boot (issue #10) — hash-routed offline hot-seat loop over the
// session store: Start → Setup → Lobby → Table → Recap. The session wraps
// LocalGame, so turns, six-pass endings and rematch come from the engine;
// this module only guards routes and paints the matching screen module.
// A persistent #toast host sits outside the routed #screen so the offline
// toast survives route repaints.

import './styles/tokens.css'
import './styles/board.css'
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
import { gameStore } from './store/game'
import { uiStore } from './store/ui'
import { sessionStore } from './store/session'

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

// Route guards: #/table needs a live session, #/recap needs an ended one.
// Anything unguarded falls back one step (recap → table → setup).
function render(): void {
  const host = screenHost()
  if (!host) return
  const raw = currentRoute()
  const snap = sessionStore.getState().snapshot()
  let route = raw
  if (route === 'table' && snap === null) route = 'setup'
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
      host.innerHTML = buildStartScreenHTML(readNickname())
      mountStartScreen(host, () => navigate('setup'))
      break
    }
    case 'setup': {
      if (setupDraft.names.length === 0) setupDraft.names = [readNickname()]
      host.innerHTML = buildSetupHTML(
        setupDraft.count,
        setupDraft.names,
        setupDraft.bots,
      )
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
      host.innerHTML = buildLobbyHTML(state.names, state.isBot)
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
      host.innerHTML = buildHotSeatTableHTML(tableSnap)
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
      host.innerHTML = buildRecapHTML(
        ended,
        sessionStore.getState().wordHistory(),
      )
      mountRecap(host)
      break
    }
  }
  paintedHash = window.location.hash
}

// Test/black-box hook: the legacy placement-table fields (issues #7-9)
// keep working against their stores, and the session fields force the
// offline loop (six passes, rematch, snapshot) without touching the DOM.
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
      uiStore.getState().setSeats(['You', 'Rival 1', 'Rival 2', 'Rival 3'].slice(0, count))
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
        provText: `${state.provScore} pts`,
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
  app.innerHTML = '<div id="screen"></div>' + buildToastHTML(null)
  const toast = app.querySelector<HTMLElement>('#toast')
  if (toast) mountToast(toast)
  startRouter(() => handleRoute())
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
}

boot()
