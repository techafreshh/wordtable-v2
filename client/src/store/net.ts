// Client net layer (issue #14) — connects the DOM table to the authoritative
// Node `ws` server without forking state. The server's `viewFor` snapshot is
// the only truth: every `m: 'state_sync'` frame is projected into the
// existing game/ui stores (which the Table already renders), and the client
// never validates moves locally. One request flies at a time — the v1
// protocol has no correlation ids, so the first frame after a send is always
// that request's reply and later frames are broadcasts.

import { createStore } from 'zustand/vanilla'
import { gameStore } from './game'
import { uiStore } from './ui'

export const DEFAULT_SERVER_URL = 'ws://localhost:9080'
export const NET_CODE_KEY = 'wordtable.net.code'
export const NET_TOKEN_KEY = 'wordtable.net.token'

export type NetStatus = 'offline' | 'connecting' | 'online'

export interface NetReply {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export interface NetState {
  url: string
  status: NetStatus
  code: string | null
  token: string | null
  seat: number | null
}

// Browser-native transport only: the server's `ws` package must never enter
// the client bundle. Tests stub `globalThis.WebSocket` with a fake class.
type SocketCtor = new (url: string) => WebSocket

function socketCtor(): SocketCtor | null {
  try {
    const ctor = (globalThis as unknown as { WebSocket?: SocketCtor }).WebSocket
    return typeof ctor === 'function' ? ctor : null
  } catch {
    return null
  }
}

// `ws` OPEN is 1 by spec; the constructor's static may be missing on fakes.
function socketOpen(): number {
  try {
    const ctor = (globalThis as unknown as { WebSocket?: { OPEN?: unknown } })
      .WebSocket
    return typeof ctor?.OPEN === 'number' ? ctor.OPEN : 1
  } catch {
    return 1
  }
}

function readSearch(search?: string): string {
  if (typeof search === 'string') return search
  try {
    return typeof window !== 'undefined' ? (window.location?.search ?? '') : ''
  } catch {
    return ''
  }
}

function readEnv(
  env?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (env !== undefined) return env
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | undefined>
    }
    return meta.env ?? {}
  } catch {
    return {}
  }
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

// URL resolution: trimmed `?server-url=` (case-insensitive key) wins over
// `VITE_WORDTABLE_SERVER_URL` / `WORDTABLE_SERVER_URL`, else the default.
// Precedence mirrors `server/src/config.ts` CLI-over-env-over-default.
export function resolveServerUrl(opts?: {
  search?: string
  env?: Record<string, string | undefined>
}): string {
  try {
    const params = new URLSearchParams(readSearch(opts?.search))
    let found: string | null = null
    params.forEach((value, key) => {
      if (found === null && key.trim().toLowerCase() === 'server-url') {
        found = value
      }
    })
    // Read back through `unknown`: assignments inside the forEach
    // callback are invisible to narrowing, so `found` still looks null.
    const hit: unknown = found
    if (typeof hit === 'string' && hit.trim() !== '') return normalizeUrl(hit)
  } catch {
    // URL unavailable (SSR/tests): fall through to env/default.
  }
  const env = readEnv(opts?.env)
  for (const key of ['VITE_WORDTABLE_SERVER_URL', 'WORDTABLE_SERVER_URL']) {
    const raw = env[key]
    if (typeof raw === 'string' && raw.trim() !== '') return normalizeUrl(raw)
  }
  return DEFAULT_SERVER_URL
}

// True when the boot URL carries an explicit `?server-url=` (any case).
// The offline table is the default: main.ts only dials when this is set.
export function hasServerUrlParam(search?: string): boolean {
  try {
    const params = new URLSearchParams(readSearch(search))
    let found = false
    params.forEach((_value, key) => {
      if (key.trim().toLowerCase() === 'server-url') found = true
    })
    return found
  } catch {
    return false
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function readPersistedNet(): { code: string | null; token: string | null } {
  const store = storage()
  if (store === null) return { code: null, token: null }
  try {
    return { code: store.getItem(NET_CODE_KEY), token: store.getItem(NET_TOKEN_KEY) }
  } catch {
    return { code: null, token: null }
  }
}

function persistNet(code: string, token: string): void {
  try {
    const store = storage()
    if (store === null) return
    store.setItem(NET_CODE_KEY, code)
    store.setItem(NET_TOKEN_KEY, token)
  } catch {
    // Persistence is best-effort; the in-memory store still applies.
  }
}

export function clearPersistedNet(): void {
  try {
    const store = storage()
    if (store === null) return
    store.removeItem(NET_CODE_KEY)
    store.removeItem(NET_TOKEN_KEY)
  } catch {
    // Best-effort like every other storage touch in this module.
  }
}

export interface PlacedTile {
  square: string
  face: string
  as?: string
}

interface QueuedRequest {
  payload: Record<string, unknown>
  resolve: (reply: Record<string, unknown>) => void
}

// Single-flight outbox: payloads serialize behind at most one in-flight
// frame, because without correlation ids concurrent replies are ambiguous.
let socket: WebSocket | null = null
let queue: QueuedRequest[] = []
let awaitingReply = false

function toResult(reply: Record<string, unknown>): NetReply {
  if (reply['ok'] === true) return { ...reply, ok: true }
  const error =
    typeof reply['error'] === 'string' && reply['error'] !== ''
      ? reply['error']
      : typeof reply['reason'] === 'string' && reply['reason'] !== ''
        ? reply['reason']
        : 'BAD_REPLY'
  return { ok: false, error }
}

function failAll(error: string): void {
  const pending = queue
  queue = []
  awaitingReply = false
  for (const item of pending) {
    try {
      item.resolve({ ok: false, error })
    } catch {
      // A settling callback must never break teardown.
    }
  }
}

function pump(): void {
  if (awaitingReply || socket === null) return
  const head = queue[0]
  if (!head) return
  if (socket.readyState !== socketOpen()) return
  try {
    socket.send(JSON.stringify(head.payload))
    awaitingReply = true
  } catch {
    queue.shift()
    try {
      head.resolve({ ok: false, error: 'NOT_CONNECTED' })
    } catch {
      // Ignore settling errors and keep the outbox moving.
    }
    pump()
  }
}

function sendRequest(payload: Record<string, unknown>): Promise<NetReply> {
  if (socket === null || socket.readyState !== socketOpen()) {
    return Promise.resolve({ ok: false, error: 'NOT_CONNECTED' })
  }
  return new Promise<NetReply>((resolve) => {
    queue.push({ payload, resolve: (reply) => resolve(toResult(reply)) })
    pump()
  })
}

// Broadcast path: `state_sync` is the only truth (board, own rack, turn,
// scores), chat/emote ride the uiStore remote seam, everything else is
// ignored so unknown future frames can never corrupt the table.
export function handleFrame(frame: Record<string, unknown>): void {
  const raw = frame['m']
  const m = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (m === 'state_sync') {
    gameStore.getState().applyStateSync(frame)
    if (Array.isArray(frame['scores'])) {
      uiStore.getState().setScores(frame['scores'] as number[])
    }
    if (Number.isInteger(frame['turn'])) {
      uiStore.getState().setTurn(frame['turn'] as number)
    }
    return
  }
  if (m === 'chat' || m === 'emote') {
    uiStore
      .getState()
      .receiveChat(String(frame['from'] ?? ''), String(frame['text'] ?? ''))
  }
}

function onSocketMessage(data: unknown): void {
  let frame: unknown
  try {
    frame = JSON.parse(String(data))
  } catch {
    return
  }
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return
  const record = frame as Record<string, unknown>
  if (awaitingReply) {
    awaitingReply = false
    const head = queue.shift()
    if (head) {
      try {
        head.resolve(record)
      } catch {
        // Ignore settling errors; the broadcast path below still runs.
      }
    }
    pump()
  }
  handleFrame(record)
}

function onSocketClose(): void {
  socket = null
  failAll('DISCONNECTED')
  if (netStore.getState().status !== 'offline') {
    netStore.setState({ status: 'offline' })
  }
}

export const netStore = createStore<NetState>()(() => ({
  url: resolveServerUrl(),
  status: 'offline',
  code: null,
  token: null,
  seat: null,
}))

function seatOf(reply: Record<string, unknown>): number | null {
  const raw = reply['seat'] ?? reply['you']
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isInteger(Number(raw))) {
    const n = Number(raw)
    if (n >= 0) return n
  }
  return null
}

// Acceptance shape: `^[A-Z]{4}$` code, token length >= 8. Anything else is a
// BAD_REPLY that neither persists nor touches the board.
function adoptSeat(reply: Record<string, unknown>): NetReply {
  const code =
    typeof reply['code'] === 'string' ? reply['code'].trim().toUpperCase() : ''
  const token = typeof reply['token'] === 'string' ? reply['token'] : ''
  if (!/^[A-Z]{4}$/.test(code) || token.length < 8) {
    return { ok: false, error: 'BAD_REPLY' }
  }
  persistNet(code, token)
  netStore.setState({ code, token, seat: seatOf(reply) ?? 0 })
  return { ...reply, ok: true }
}

function authFields(): { code: string; token: string } | null {
  const { code, token } = netStore.getState()
  if (typeof code !== 'string' || code === '') return null
  if (typeof token !== 'string' || token === '') return null
  return { code, token }
}

export const net = {
  connect(url?: string): Promise<NetReply> {
    const target =
      typeof url === 'string' && url.trim() !== ''
        ? normalizeUrl(url)
        : resolveServerUrl()
    const Ctor = socketCtor()
    if (Ctor === null) return Promise.resolve({ ok: false, error: 'NO_SOCKET' })
    try {
      if (socket !== null) {
        try {
          socket.close()
        } catch {
          // A stale socket must never block the new dial.
        }
        socket = null
      }
      failAll('DISCONNECTED')
      netStore.setState({ url: target, status: 'connecting' })
      const next = new Ctor(target)
      socket = next
      return new Promise<NetReply>((resolve) => {
        let settled = false
        const settle = (reply: NetReply): void => {
          if (settled) return
          settled = true
          resolve(reply)
        }
        next.addEventListener('open', () => {
          netStore.setState({ status: 'online' })
          settle({ ok: true })
        })
        next.addEventListener('close', () => {
          if (socket === next) onSocketClose()
          settle({ ok: false, error: 'NOT_CONNECTED' })
        })
        next.addEventListener('error', () => {
          if (socket === next) onSocketClose()
          settle({ ok: false, error: 'NOT_CONNECTED' })
        })
        next.addEventListener('message', (ev: Event) => {
          if (socket !== next) return
          onSocketMessage((ev as unknown as { data?: unknown }).data)
        })
      })
    } catch {
      socket = null
      netStore.setState({ status: 'offline' })
      return Promise.resolve({ ok: false, error: 'NOT_CONNECTED' })
    }
  },

  disconnect(): void {
    const sock = socket
    socket = null
    if (sock !== null) {
      try {
        sock.close()
      } catch {
        // Closing is best-effort; state below is authoritative.
      }
    }
    failAll('DISCONNECTED')
    netStore.setState({ status: 'offline' })
  },

  createRoom(name: string): Promise<NetReply> {
    const payload: Record<string, unknown> = {
      v: 1,
      m: 'create_room',
      name: String(name ?? ''),
    }
    return sendRequest(payload).then((reply) => {
      if (!reply.ok) return reply
      return adoptSeat(reply)
    })
  },

  joinRoom(code: string, name: string, token?: string): Promise<NetReply> {
    const payload: Record<string, unknown> = {
      v: 1,
      m: 'join_room',
      code: String(code ?? ''),
      name: String(name ?? ''),
    }
    const explicit = typeof token === 'string' && token !== '' ? token : null
    const stored = explicit ?? netStore.getState().token ?? readPersistedNet().token
    if (stored !== null && stored !== undefined && stored !== '') {
      payload['token'] = stored
    }
    return sendRequest(payload).then((reply) => {
      if (!reply.ok) return reply
      return adoptSeat(reply)
    })
  },

  rejoin(): Promise<NetReply> {
    const auth = authFields() ?? persistedAuth()
    if (auth === null) return Promise.resolve({ ok: false, error: 'NO_ROOM' })
    return sendRequest({ v: 1, m: 'rejoin', ...auth }).then((reply) => {
      if (reply.ok) handleFrame({ ...reply, m: 'state_sync' })
      return reply
    })
  },

  startGame(): Promise<NetReply> {
    const auth = authFields()
    if (auth === null) return Promise.resolve({ ok: false, error: 'NO_ROOM' })
    return sendRequest({ v: 1, m: 'start_game', ...auth })
  },

  placeTiles(tiles: PlacedTile[]): Promise<NetReply> {
    const auth = authFields()
    if (auth === null) return Promise.resolve({ ok: false, error: 'NO_ROOM' })
    const clean = (Array.isArray(tiles) ? tiles : []).map((t) => {
      const entry: Record<string, unknown> = {
        square: String(t.square ?? ''),
        face: String(t.face ?? ''),
      }
      if (typeof t.as === 'string' && t.as !== '') entry['as'] = t.as
      return entry
    })
    return sendRequest({ v: 1, m: 'place_tiles', ...auth, tiles: clean })
  },

  passTurn(): Promise<NetReply> {
    const auth = authFields()
    if (auth === null) return Promise.resolve({ ok: false, error: 'NO_ROOM' })
    return sendRequest({ v: 1, m: 'pass', ...auth })
  },

  exchange(countOrFaces: number | string[]): Promise<NetReply> {
    const auth = authFields()
    if (auth === null) return Promise.resolve({ ok: false, error: 'NO_ROOM' })
    if (typeof countOrFaces === 'number') {
      return sendRequest({ v: 1, m: 'exchange', ...auth, count: countOrFaces })
    }
    const tiles = (Array.isArray(countOrFaces) ? countOrFaces : []).map((f) =>
      String(f ?? ''),
    )
    return sendRequest({ v: 1, m: 'exchange', ...auth, tiles })
  },
};

function persistedAuth(): { code: string; token: string } | null {
  const stored = readPersistedNet()
  if (
    stored.code !== null &&
    stored.code !== '' &&
    stored.token !== null &&
    stored.token !== ''
  ) {
    return { code: stored.code, token: stored.token }
  }
  return null
}

// Test seam: drop the socket and outbox without touching localStorage
// (persisted creds survive reloads by design), mirroring
// `resetSessionForTests` disarm discipline in store/session.ts.
export function resetNetForTests(): void {
  const sock = socket
  socket = null
  if (sock !== null) {
    try {
      sock.close()
    } catch {
      // Teardown never throws.
    }
  }
  queue = []
  awaitingReply = false
  netStore.setState({
    url: DEFAULT_SERVER_URL,
    status: 'offline',
    code: null,
    token: null,
    seat: null,
  })
}


