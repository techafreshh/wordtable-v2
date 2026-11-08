// Router boot (issue #10) — hash-routed offline hot-seat loop over the
// session store: Start → Setup → Lobby → Table → Recap. The session wraps
// LocalGame, so turns, six-pass endings and rematch come from the engine;
// this module only guards routes and paints the matching screen module.
//
// The start route (issue #86) paints only the StartScreen (nickname +
// Create/Join/Play now) with its own #toast node. Placement lives on the
// session table (#/table, issue #85), so `?rack/?seats/?turn` boot only
// seeds the hook-observable stores and never paints a board on `#/`.
// Hot-seat routes (#/setup, #/lobby, #/table, #/recap) render only their
// screen module, keeping `.seat` counts exact for the loop probes.

import './styles/tokens.css'
import './styles/board.css'
import './styles/fx.css'
import './styles/hud.css'
import './styles/screens.css'
import { GameStatus } from '../../shared/engine/game'
import type {
  IntentResult,
  LocalSnapshot,
  PlaceSpec,
} from '../../shared/engine/local'
import { parseRoute, navigate, startRouter, type Route } from './router'
import {
  buildStartScreenHTML,
  mountStartScreen,
  readNickname,
} from './components/StartScreen'
import { buildSetupHTML, mountSetup } from './components/Setup'
import { buildLobbyHTML, mountLobby } from './components/Lobby'
import { buildChatBubbleHTML } from './components/ChatBubble'
import { buildChatPanelHTML } from './components/ChatPanel'
import {
  buildHotSeatTableHTML,
  mountHotSeatTable,
  renderHotSeatTable,
  syncGameFromSession,
} from './components/HotSeatTable'
import {
  buildOnlineLobbyHTML,
  mountOnlineLobby,
  renderOnlineLobby,
} from './components/OnlineLobby'
import {
  buildOnlineTableHTML,
  mountOnlineTable,
  renderOnlineTable,
} from './components/OnlineTable'
import { buildRecapHTML, mountRecap } from './components/Recap'
import { buildToastHTML, mountToast } from './components/Toast'
import { ensureReconnectOverlay } from './components/ReconnectOverlay'
import { gameStore, boardToTiles, displayFace, provScoreText } from './store/game'
import { DEFAULT_SEAT_NAMES, uiStore } from './store/ui'
import { sessionStore } from './store/session'
import {
  connectAndRejoin,
  hasServerUrlParam,
  net,
  netStore,
  readPersistedNet,
  type NetReply,
  type PlacedTile,
} from './store/net'
import { TileBag } from '../../shared/engine/bag'
import { isBackdropDisabled } from './three/backdrop-guard'

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
  // Online guards (issue #88): both online routes need a live seat — a
  // deep link with no code+token bounces to start exactly like the
  // session-snapshot guards above bounce to setup.
  else if (route === 'online-lobby' || route === 'online-table') {
    const auth = netStore.getState()
    if (auth.code === null || auth.token === null) route = 'start'
  }
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
  // Reconnect overlay (issue #15): every route hosts `#reconnect-overlay`
  // so a mid-game drop shows `Reconnecting…` wherever the user is. The
  // node is (re)mounted after each paint because route branches replace
  // `host.innerHTML`, which would destroy a top-of-render node.
  const ensureOverlay = (): void => {
    try {
      ensureReconnectOverlay(host)
    } catch {
      // Overlay mount is decorative; route paint stays authoritative.
    }
  }
  switch (route) {
    case 'start': {
      // Start route (issue #86): StartScreen only — no legacy Table.
      // Offline Create/Join toasts surface through this route's own
      // #toast node, mirroring the setup/lobby pattern.
      host.innerHTML =
        buildStartScreenHTML(readNickname()) +
        buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountStartScreen(host, () => navigate('setup'))
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
      // The placement scratch mirrors the engine snapshot: bot moves and
      // commits land here before the skeleton paints, so the rack and the
      // provisional chip always read the current turn seat.
      syncGameFromSession()
      host.innerHTML =
        buildHotSeatTableHTML(tableSnap) +
        buildToastHTML(uiStore.getState().toast)
      const toast = host.querySelector<HTMLElement>('#toast')
      if (toast) mountToast(toast)
      mountHotSeatTable(host)
      break
    }
    case 'online-lobby': {
      // Online lobby (issue #88): room code + seats from the net/ui
      // stores; host controls derive from seat 0 inside the builder.
      const auth = netStore.getState()
      host.innerHTML =
        buildOnlineLobbyHTML(
          auth.code ?? '',
          uiStore.getState().seats,
          auth.seat === 0,
        ) + buildToastHTML(uiStore.getState().toast)
      const onlineToast = host.querySelector<HTMLElement>('#toast')
      if (onlineToast) mountToast(onlineToast)
      mountOnlineLobby(host)
      break
    }
    case 'online-table': {
      // Online table (issue #88): the placement scratch mirrors the
      // authoritative projection — state_sync already landed in the
      // game/ui stores via net.handleFrame before this paint.
      host.innerHTML =
        buildOnlineTableHTML() +
        buildToastHTML(uiStore.getState().toast)
      const tableToast = host.querySelector<HTMLElement>('#toast')
      if (tableToast) mountToast(tableToast)
      mountOnlineTable(host)
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
  ensureOverlay()
  paintedHash = window.location.hash
}

// Lobby chat repaint (issue #16): the lobby route hosts the same
// `#chat-root` bubble/panel as the table, so uiStore chat traffic
// (broadcasts via net.handleFrame, badge bumps, toggles) repaints it
// without a full route render. Draft text is preserved like the table.
function repaintLobbyChat(): void {
  if (currentRoute() !== 'lobby') return
  const host = screenHost()
  const chatRoot = host?.querySelector<HTMLElement>('#chat-root')
  if (!chatRoot) return
  const ui = uiStore.getState()
  const next =
    buildChatBubbleHTML(ui.unread, ui.chatOpen) +
    buildChatPanelHTML(ui.chat, ui.chatOpen)
  if (chatRoot.innerHTML !== next) chatRoot.innerHTML = next
}
// Online lobby repaint (issue #88): seat broadcasts repaint the plaques
// while the lobby is showing, and the `started` flip auto-advances to
// the online table — mirroring the session table's ended → recap hop.
function repaintOnlineLobby(): void {
  const state = netStore.getState()
  if (state.started === true && currentRoute() === 'online-lobby') {
    navigate('online-table')
    return
  }
  if (currentRoute() !== 'online-lobby') return
  const host = screenHost()
  if (!host || !host.querySelector('#online-lobby')) return
  try {
    renderOnlineLobby(host)
  } catch {
    // Patch is decorative; the route render stays authoritative.
  }
}
// Online table patch (issue #88): state_sync projections (board/rack
// via gameStore, turn/scores/chat via uiStore) repaint the live regions
// without a full route render, mirroring repaintSessionTable.
function repaintOnlineTable(): void {
  if (currentRoute() !== 'online-table') return
  const host = screenHost()
  if (!host || !host.querySelector('#online-table')) return
  try {
    renderOnlineTable(host)
  } catch {
    // Patch is decorative; the route render stays authoritative.
  }
}
// Session table patch (issue #85): game/ui intents (placements, prov
// chip, selection, toast-adjacent cursors) repaint the live regions
// without rebuilding mounts. Session intents keep the full render() path
// above so bot moves resync and endings navigate.
function repaintSessionTable(): void {
  if (currentRoute() !== 'table') return
  const host = screenHost()
  if (!host || !host.querySelector('.screen-table')) return
  try {
    renderHotSeatTable(host)
  } catch {
    // Patch is decorative; the route render stays authoritative.
  }
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
      sendChatOnline: (text: string) => Promise<NetReply>
      sendEmote: (emote: string) => Promise<NetReply>
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
        boardTiles: Record<string, string>
      }
      reset: () => void
      placeOnline: (tiles: PlacedTile[]) => Promise<NetReply>
      passOnline: () => Promise<NetReply>
      connect: (url?: string) => Promise<NetReply>
      createRoom: (name: string) => Promise<NetReply>
      joinRoom: (code: string, name: string) => Promise<NetReply>
      rejoin: () => Promise<NetReply>
      disconnect: () => void
      startGame: () => Promise<NetReply>
      addBot: () => Promise<NetReply>
      netState: () => {
        url: string
        status: string
        code: string | null
        token: string | null
        seat: number | null
        started: boolean
      }
      pass: () => void
      exchangeTiles: (faces: string[]) => IntentResult
      exchangeOnline: (countOrFaces: number | string[]) => Promise<NetReply>
      placeTableMove: (specs: PlaceSpec[]) => IntentResult
      rematch: () => void
      snapshot: () => LocalSnapshot | null
      startSession: (names: string[], bots?: boolean[], seed?: number) => void
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
    sendChatOnline: (text: string) => net.sendChat(text),
    sendEmote: (emote: string) => net.sendEmote(emote),
    placeOnline: (tiles: PlacedTile[]) => net.placeTiles(tiles),
    passOnline: () => net.passTurn(),
    getState: () => {
      const state = gameStore.getState()
      const ui = uiStore.getState()
      return {
        rack: state.rack.map((t) => (t.isBlank ? '?' : t.face)),
        rackCount: state.rack.length,
        pending: state.pending.map((p) => ({ sq: p.sq, face: displayFace(p) })),
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
        boardTiles: boardToTiles(state.board),
      }
    },
    reset: () => {
      gameStore.getState().reset()
      uiStore.getState().resetTable()
      uiStore.getState().clearToast()
      uiStore.getState().closeBlankPicker()
      bootHudFromURL()
    },
    connect: (url?: string) => net.connect(url),
    createRoom: (name: string) => net.createRoom(name),
    joinRoom: (code: string, name: string) => net.joinRoom(code, name),
    rejoin: () => net.rejoin(),
    disconnect: () => net.disconnect(),
    startGame: () => net.startGame(),
    addBot: () => net.addBot(),
    netState: () => ({ ...netStore.getState() }),
    pass: () => {
      sessionStore.getState().passTurn()
    },
    // Exchange seams (issue #89): offline through the session intent
    // (plus scratch resync), online straight to the server.
    exchangeTiles: (faces: string[]) => {
      const result = sessionStore.getState().exchangeTiles(faces)
      syncGameFromSession()
      return result
    },
    exchangeOnline: (countOrFaces: number | string[]) =>
      net.exchange(countOrFaces),
    // Scripted session play (issue #85): engine-level commit for the
    // turn seat plus scratch resync, so a headless human→bot game runs
    // on the hook alone (placeTableMove → bot timer → snapshot).
    placeTableMove: (specs: PlaceSpec[]) => {
      const result: IntentResult = sessionStore.getState().placeMove(specs)
      syncGameFromSession()
      return result
    },
    rematch: () => {
      sessionStore.getState().rematch()
      navigate('table')
    },
    snapshot: () => sessionStore.getState().snapshot(),
    startSession: (names: string[], bots?: boolean[], seed?: number) => {
      sessionStore.getState().startSession(names, bots ?? [], seed)
    },
  }
}

function boot(): void {
  const app = document.getElementById('app')
  if (!app) return
  bootHudFromURL()
  app.innerHTML = '<div id="screen"></div>'
  startRouter(() => handleRoute())
  gameStore.subscribe(repaintSessionTable)
  uiStore.subscribe(repaintLobbyChat)
  uiStore.subscribe(repaintSessionTable)
  // Online loop (issue #88): broadcasts repaint the lobby/table live
  // regions and flip the lobby into the table on `started`.
  netStore.subscribe(repaintOnlineLobby)
  gameStore.subscribe(repaintOnlineTable)
  uiStore.subscribe(repaintOnlineTable)
  // Session intents (button passes, bot auto-pass, hook forcing) repaint
  // the table/recap/lobby. Start/setup keep their inputs: no session
  // intent can fire while they are showing (seat 0 is always human).
  sessionStore.subscribe(() => {
    const route = currentRoute()
    if (route === 'start' || route === 'setup') return
    render()
  })
  installHook()
  // PWA shell (issue #21): register the versioned service worker so the
  // table installs and replays offline. Decorative like the backdrop — a
  // failed registration must never break the board, hence never-throw.
  try {
    if ('serviceWorker' in navigator) {
      let proto = ''
      try {
        proto = window.location?.protocol ?? ''
      } catch {
        proto = ''
      }
      if (proto === 'http:' || proto === 'https:') {
        void navigator.serviceWorker.register('/sw.js').catch(() => {})
      }
    }
  } catch {
    // Offline-capable install is best-effort; the table stays playable.
  }
  render()
  gameStore.getState().setRack(readSeededFaces() ?? dealFaces())
  // Online table (issue #14): dial only when the boot URL carries an
  // explicit `?server-url=`. A bare `/` load stays offline so the
  // `#/start` probes never see a socket.
  // Tab-reload resume (issue #15): persisted code+token reclaim the same
  // seat via `rejoin`, restoring the turn without re-entering the code.
  try {
    ensureReconnectOverlay(app)
    if (hasServerUrlParam()) {
      const stored = readPersistedNet()
      if (stored.code && stored.token) void connectAndRejoin()
      else void net.connect()
    }
  } catch {
    // Offline boot is the default; a failed dial never breaks the table.
  }
  // Table backdrop (issue #11): ambient felt scene behind the board.
  // Board-first boot — the backdrop mounts after the 225-square grid,
  // and any failure (including ?nogl=1) keeps the CSS gradient fallback.
  // Deferred (issue #45): Three ships as a separate async chunk loaded
  // at idle so first paint never pays for the decorative scene; ?nogl=1
  // returns early and never fetches the chunk.
  try {
    const backdrop = document.getElementById('backdrop')
    if (backdrop !== null) {
      let search = ''
      try {
        search = window.location.search
      } catch {
        search = ''
      }
      if (!isBackdropDisabled(search)) {
        const load = (): void => {
          void import('./three/table')
            .then((m) => m.initTableBackdrop(backdrop))
            .catch(() => {})
        }
        try {
          const ric = (
            window as unknown as {
              requestIdleCallback?: (cb: () => void) => number
            }
          ).requestIdleCallback
          if (typeof ric === 'function') ric.call(window, load)
          else setTimeout(load, 0)
        } catch {
          // Decorative only: a backdrop failure must never break the board.
        }
      }
    }
  } catch {
    // Decorative only: a backdrop failure must never break the board.
  }
}

boot()
