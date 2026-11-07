// Reconnect UX (issue #15): overlay copy, backoff schedule, drop→rejoin
// state equality, WRONGTOK rejection, and tab-reload resume — over the
// same FakeSocket + stubbed-storage harness as tests/client/net.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildReconnectOverlayHTML,
  ensureReconnectOverlay,
  mountReconnectOverlay,
} from '../../client/src/components/ReconnectOverlay'
import {
  boardToTiles,
  gameStore,
} from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  NET_CODE_KEY,
  NET_TOKEN_KEY,
  RECONNECT_DELAYS_MS,
  connectAndRejoin,
  net,
  netStore,
  reconnectDelayMs,
  resetNetForTests,
  stopReconnect,
} from '../../client/src/store/net'
import { tableSkeletonHTML } from '../../client/src/components/Table'
import { RoomRegistry } from '../../server/src/rooms'
import { createBinding } from '../../server/src/binding'

type Handler = (ev: unknown) => void

// Browser-native WebSocket stand-in: records sends, lets the test drive
// open/message/close exactly like the wire would.
class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  url: string
  readyState = 0
  sent: string[] = []
  private handlers = new Map<string, Handler[]>()

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? []
    list.push(fn)
    this.handlers.set(type, list)
  }

  removeEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? []
    this.handlers.set(
      type,
      list.filter((h) => h !== fn),
    )
  }

  send(data: string): void {
    this.sent.push(String(data))
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close', {})
  }

  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  receive(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) fn(ev)
  }
}

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  const api = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(String(key), String(value))
    },
    removeItem: (key: string): void => {
      store.delete(key)
    },
    clear: (): void => {
      store.clear()
    },
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    get length(): number {
      return store.size
    },
  }
  ;(globalThis as Record<string, unknown>).localStorage = api
}

let prevSocket: unknown
let prevDocument: unknown

function lastSocket(): FakeSocket {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1]
  if (!sock) throw new Error('no socket dialled')
  return sock
}

async function connected(url = 'ws://localhost:9080'): Promise<FakeSocket> {
  const pending = net.connect(url)
  const sock = lastSocket()
  expect(sock.url).toBe(url)
  sock.open()
  await expect(pending).resolves.toEqual({ ok: true })
  expect(netStore.getState().status).toBe('online')
  return sock
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (cond()) return
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${what}`)
    await sleep(25)
  }
}

const GOOD_REPLY = {
  m: 'create_room',
  ok: true,
  code: 'ABCD',
  token: 'token-0123456789',
  seat: 0,
}

beforeEach(() => {
  stubLocalStorage()
  prevSocket = (globalThis as Record<string, unknown>).WebSocket
  ;(globalThis as Record<string, unknown>).WebSocket = FakeSocket as unknown as new (
    url: string,
  ) => WebSocket
  FakeSocket.instances = []
  prevDocument = (globalThis as Record<string, unknown>).document
  resetNetForTests()
  gameStore.getState().reset()
  uiStore.getState().resetTable()
  uiStore.getState().clearToast()
})

afterEach(() => {
  resetNetForTests()
  stopReconnect()
  gameStore.getState().reset()
  uiStore.getState().resetTable()
  uiStore.getState().clearToast()
  if (prevSocket === undefined) {
    delete (globalThis as Record<string, unknown>).WebSocket
  } else {
    ;(globalThis as Record<string, unknown>).WebSocket = prevSocket
  }
  if (prevDocument === undefined) {
    delete (globalThis as Record<string, unknown>).document
  } else {
    ;(globalThis as Record<string, unknown>).document = prevDocument
  }
})

describe('reconnect overlay markup', () => {
  it('renders #reconnect-overlay with Reconnecting copy when visible', () => {
    const html = buildReconnectOverlayHTML(true, 0)
    expect(html).toContain('id=\"reconnect-overlay\"')
    expect(html).toContain('Reconnecting')
    expect(html).toContain('role=\"status\"')
    expect(html).not.toContain('hidden')
  })

  it('hides via the hidden attribute when not reconnecting', () => {
    const html = buildReconnectOverlayHTML(false, 0)
    expect(html).toContain('id=\"reconnect-overlay\"')
    expect(html).toContain('hidden')
    expect(html).not.toContain('Reconnecting')
  })

  it('names the redial attempt in the copy', () => {
    expect(buildReconnectOverlayHTML(true, 2)).toContain('3')
  })

  it('ships in the table skeleton beside the toast node', () => {
    const html = tableSkeletonHTML()
    expect(html).toContain('id=\"reconnect-overlay\"')
    expect(html).toContain('id=\"toast\"')
  })

  it('both screens.css copies style #reconnect-overlay with a hidden rule', () => {
    for (const rel of [
      '../../client/styles/screens.css',
      '../../client/src/styles/screens.css',
    ]) {
      const css = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(css).toContain('#reconnect-overlay')
      expect(css).toContain('#reconnect-overlay[hidden]')
    }
  })
})

describe('backoff schedule', () => {
  it('starts at 250ms so the first retry lands inside 500ms', () => {
    expect(RECONNECT_DELAYS_MS[0]).toBe(250)
    for (let i = 0; i < 25; i++) {
      expect(reconnectDelayMs(0)).toBeLessThanOrEqual(500)
    }
  })

  it('caps at 5s for large attempts', () => {
    for (const attempt of [4, 5, 10, 100]) {
      for (let i = 0; i < 10; i++) {
        expect(reconnectDelayMs(attempt)).toBeLessThanOrEqual(5000)
      }
    }
  })

  it('grows attempt over attempt (250 base vs capped base)', () => {
    for (let i = 0; i < 25; i++) {
      expect(reconnectDelayMs(0)).toBeLessThan(reconnectDelayMs(4))
    }
  })

  it('tolerates nonsense input without throwing or going negative', () => {
    expect(reconnectDelayMs(-1)).toBeLessThanOrEqual(500)
    expect(reconnectDelayMs(Number.NaN)).toBeLessThanOrEqual(500)
    expect(reconnectDelayMs(2)).toBeGreaterThanOrEqual(0)
  })
})

describe('drop → overlay → rejoin resync', () => {
  const SNAPSHOT = {
    m: 'state_sync',
    ok: true,
    turn: 1,
    scores: [10, 4],
    board_tiles: [
      { square: 'H8', letter: 'A', blank: false },
      { row: 7, col: 8, letter: 'B', blank: false },
      { square: 'H10', letter: 'C', blank: true },
    ],
    rack: ['A', 'B', 'C', 'D', 'E', 'F', '?'],
    you: 1,
    seat: 1,
  }

  it('shows Reconnecting synchronously on socket kill', async () => {
    // Minimal document stand-in: the store layer repaints a mounted node
    // directly so the 500ms window holds with no subscription delay.
    const attrs = new Map<string, string>()
    const el = {
      textContent: '',
      dataset: {} as Record<string, string>,
      removeAttribute: (name: string): void => {
        attrs.delete(name)
      },
      setAttribute: (name: string, value: string): void => {
        attrs.set(name, value)
      },
      has: (name: string): boolean => attrs.has(name),
    }
    ;(globalThis as Record<string, unknown>).document = {
      getElementById: (id: string): unknown =>
        id === 'reconnect-overlay' ? el : null,
    }
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created

    sock.close()
    expect(netStore.getState().status).toBe('reconnecting')
    expect(el.textContent).toContain('Reconnecting')
    expect(el.has('hidden')).toBe(false)
  })

  it('rejoin with the same code+token restores the exact snapshot', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    sock.receive(SNAPSHOT)
    const beforeBoard = JSON.stringify(boardToTiles(gameStore.getState().board))
    const beforeScores = [...uiStore.getState().scores]
    const beforeTurn = uiStore.getState().turn
    expect(Object.keys(JSON.parse(beforeBoard))).toHaveLength(3)

    sock.close()
    expect(netStore.getState().status).toBe('reconnecting')

    await waitFor(
      () => FakeSocket.instances.length === 2,
      3000,
      'redial socket',
    )
    const redial = FakeSocket.instances[1]
    expect(redial.url).toBe('ws://localhost:9080')
    redial.open()
    await waitFor(() => redial.sent.length >= 1, 3000, 'rejoin payload')
    const payload = JSON.parse(redial.sent[0] ?? '{}') as Record<string, unknown>
    expect(payload).toMatchObject({
      v: 1,
      m: 'rejoin',
      code: 'ABCD',
      token: 'token-0123456789',
    })

    redial.receive({ ...SNAPSHOT, m: 'rejoin', token: 'token-0123456789' })
    await waitFor(
      () => netStore.getState().status === 'online',
      3000,
      'online after rejoin',
    )
    expect(JSON.stringify(boardToTiles(gameStore.getState().board))).toBe(
      beforeBoard,
    )
    expect(uiStore.getState().scores).toEqual(beforeScores)
    expect(uiStore.getState().turn).toBe(beforeTurn)
    expect(netStore.getState().code).toBe('ABCD')
    expect(netStore.getState().token).toBe('token-0123456789')
  })

  it('explicit disconnect stays offline with no redial', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created

    sock.close()
    expect(netStore.getState().status).toBe('reconnecting')
    const count = FakeSocket.instances.length
    net.disconnect()
    expect(netStore.getState().status).toBe('offline')
    await sleep(900)
    expect(FakeSocket.instances.length).toBe(count)
    expect(netStore.getState().status).toBe('offline')
  })

  it('BAD_TOKEN rejoin stops the loop, clears creds, and toasts', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    expect(localStorage.getItem(NET_CODE_KEY)).toBe('ABCD')

    sock.close()
    expect(netStore.getState().status).toBe('reconnecting')
    await waitFor(
      () => FakeSocket.instances.length === 2,
      3000,
      'redial socket',
    )
    const redial = FakeSocket.instances[1]
    redial.open()
    await waitFor(() => redial.sent.length >= 1, 3000, 'rejoin payload')
    redial.receive({ m: 'rejoin', ok: false, error: 'BAD_TOKEN' })
    await waitFor(
      () => netStore.getState().status === 'offline',
      3000,
      'offline after refusal',
    )
    expect(localStorage.getItem(NET_CODE_KEY)).toBeNull()
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBeNull()
    expect(uiStore.getState().toast).toBe('BAD_TOKEN')
    const count = FakeSocket.instances.length
    await sleep(900)
    expect(FakeSocket.instances.length).toBe(count)
  })
})

describe('server token guard (no seat minted)', () => {
  it('rejoin with WRONGTOK replies ok:false BAD_TOKEN and keeps the seat count', () => {
    const registry = new RoomRegistry()
    const binding = createBinding(registry, { isWord: () => true })
    const created = binding.handleMessage({
      v: 1,
      m: 'create_room',
      name: 'Ann',
    })
    expect(created['ok']).toBe(true)
    const code = String(created['code'])
    const reply = binding.handleMessage({
      v: 1,
      m: 'rejoin',
      code,
      token: 'WRONGTOK',
    })
    expect(reply).toMatchObject({ ok: false, error: 'BAD_TOKEN' })
    expect(registry.get(code)?.seats).toHaveLength(1)
  })
})

describe('tab-reload resume', () => {
  it('connectAndRejoin sends the persisted code+token with no new entry', async () => {
    localStorage.setItem(NET_CODE_KEY, 'ABCD')
    localStorage.setItem(NET_TOKEN_KEY, 'token-0123456789')
    const pending = connectAndRejoin('ws://localhost:9080')
    const sock = lastSocket()
    sock.open()
    await waitFor(() => sock.sent.length >= 1, 3000, 'rejoin payload')
    const payload = JSON.parse(sock.sent[0] ?? '{}') as Record<string, unknown>
    expect(payload).toMatchObject({
      v: 1,
      m: 'rejoin',
      code: 'ABCD',
      token: 'token-0123456789',
    })
    sock.receive({
      m: 'rejoin',
      ok: true,
      code: 'ABCD',
      token: 'token-0123456789',
      seat: 0,
      you: 0,
      turn: 2,
      scores: [6, 8],
      board_tiles: [],
      rack: [],
    })
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(netStore.getState().status).toBe('online')
    expect(netStore.getState().code).toBe('ABCD')
    expect(uiStore.getState().turn).toBe(2)
  })

  it('empty-memory persisted-creds rejoin hydrates store, storage, and board', async () => {
    const sock = await connected()
    expect(netStore.getState().code).toBeNull()
    expect(netStore.getState().token).toBeNull()
    localStorage.setItem(NET_CODE_KEY, 'ABCD')
    localStorage.setItem(NET_TOKEN_KEY, 'token-0123456789')
    const pending = net.rejoin()
    await waitFor(() => sock.sent.length >= 1, 3000, 'rejoin payload')
    const payload = JSON.parse(sock.sent[0] ?? '{}') as Record<string, unknown>
    expect(payload).toMatchObject({
      v: 1,
      m: 'rejoin',
      code: 'ABCD',
      token: 'token-0123456789',
    })
    // Non-canonical reply code proves the shared accept path normalizes.
    sock.receive({
      m: 'rejoin',
      ok: true,
      code: ' abcd ',
      token: 'token-0123456789',
      seat: 1,
      you: 1,
      turn: 1,
      scores: [10, 4],
      board_tiles: [{ square: 'H8', letter: 'A', blank: false }],
      rack: [],
    })
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(netStore.getState().code).toBe('ABCD')
    expect(netStore.getState().token).toBe('token-0123456789')
    expect(netStore.getState().seat).toBe(1)
    expect(localStorage.getItem(NET_CODE_KEY)).toBe('ABCD')
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBe('token-0123456789')
    expect(uiStore.getState().scores).toEqual([10, 4, 0, 0])
    expect(uiStore.getState().turn).toBe(1)
    expect(Object.keys(boardToTiles(gameStore.getState().board))).toHaveLength(1)
  })

  it('rotated token from the rejoin reply refreshes persisted storage', async () => {
    const sock = await connected()
    localStorage.setItem(NET_CODE_KEY, 'ABCD')
    localStorage.setItem(NET_TOKEN_KEY, 'token-old-0123456789')
    const pending = net.rejoin()
    await waitFor(() => sock.sent.length >= 1, 3000, 'rejoin payload')
    sock.receive({
      m: 'rejoin',
      ok: true,
      code: 'ABCD',
      token: 'token-new-9876543210',
      seat: 0,
      you: 0,
      turn: 0,
      scores: [0, 0],
      board_tiles: [],
      rack: [],
    })
    await expect(pending).resolves.toMatchObject({
      ok: true,
      token: 'token-new-9876543210',
    })
    expect(netStore.getState().code).toBe('ABCD')
    expect(netStore.getState().token).toBe('token-new-9876543210')
    expect(localStorage.getItem(NET_CODE_KEY)).toBe('ABCD')
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBe('token-new-9876543210')
  })

  it('malformed rejoin reply resolves BAD_REPLY without mutation', async () => {
    const sock = await connected()
    localStorage.setItem(NET_CODE_KEY, 'ABCD')
    localStorage.setItem(NET_TOKEN_KEY, 'token-0123456789')
    const beforeBoard = JSON.stringify(
      boardToTiles(gameStore.getState().board),
    )
    const beforeScores = [...uiStore.getState().scores]
    const beforeTurn = uiStore.getState().turn
    const pending = net.rejoin()
    await waitFor(() => sock.sent.length >= 1, 3000, 'rejoin payload')
    sock.receive({
      m: 'rejoin',
      ok: true,
      code: 'BAD!',
      token: 'short',
      seat: 0,
      you: 0,
      turn: 5,
      scores: [99, 99],
      board_tiles: [{ square: 'H8', letter: 'Z', blank: false }],
      rack: [],
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'BAD_REPLY' })
    expect(netStore.getState().code).toBeNull()
    expect(netStore.getState().token).toBeNull()
    expect(netStore.getState().seat).toBeNull()
    expect(localStorage.getItem(NET_CODE_KEY)).toBe('ABCD')
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBe('token-0123456789')
    expect(JSON.stringify(boardToTiles(gameStore.getState().board))).toBe(
      beforeBoard,
    )
    expect(uiStore.getState().scores).toEqual(beforeScores)
    expect(uiStore.getState().turn).toBe(beforeTurn)
  })

  it('overlay subscriber repaints on reconnecting status', async () => {
    // Fake-DOM mount: proves the store subscription path (the path the
    // real browser node uses) flips copy without the direct painter.
    const attrs = new Map<string, string>([['hidden', '']])
    const el = {
      textContent: '',
      dataset: {} as Record<string, string>,
      removeAttribute: (name: string): void => {
        attrs.delete(name)
      },
      setAttribute: (name: string, value: string): void => {
        attrs.set(name, value)
      },
      has: (name: string): boolean => attrs.has(name),
    }
    const host = {
      ownerDocument: {
        getElementById: (): unknown => null,
        createElement: (): unknown => ({
          innerHTML: '',
          firstElementChild: el,
        }),
      },
      appendChild: (): void => {},
    }
    const mounted = ensureReconnectOverlay(host as unknown as HTMLElement)
    expect(mounted).toBe(el as unknown)
    mountReconnectOverlay(el as unknown as HTMLElement)
    expect(el.has('hidden')).toBe(true)
    netStore.setState({ status: 'reconnecting', reconnectAttempt: 0 })
    expect(el.has('hidden')).toBe(false)
    expect(String(el.textContent)).toContain('Reconnecting')
    netStore.setState({ status: 'online', reconnectAttempt: 0 })
    expect(el.has('hidden')).toBe(true)
  })
})
