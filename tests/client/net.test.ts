// Client net module (issue #14): URL resolution, reply shape/persistence,
// snapshot→store projection and broadcast dispatch, all over a fake socket.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildTableBoardHTML } from '../../client/src/components/HotSeatTable'
import {
  boardToTiles,
  gameStore,
} from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  DEFAULT_SERVER_URL,
  NET_CODE_KEY,
  NET_TOKEN_KEY,
  handleFrame,
  hasServerUrlParam,
  net,
  netStore,
  resetNetForTests,
  resolveServerUrl,
} from '../../client/src/store/net'

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

  receiveRaw(text: string): void {
    this.emit('message', { data: text })
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
  resetNetForTests()
  gameStore.getState().reset()
  uiStore.getState().resetTable()
})

afterEach(() => {
  resetNetForTests()
  if (prevSocket === undefined) {
    delete (globalThis as Record<string, unknown>).WebSocket
  } else {
    ;(globalThis as Record<string, unknown>).WebSocket = prevSocket
  }
})

describe('resolveServerUrl', () => {
  it('defaults to ws://localhost:9080', () => {
    expect(resolveServerUrl({ search: '', env: {} })).toBe('ws://localhost:9080')
    expect(DEFAULT_SERVER_URL).toBe('ws://localhost:9080')
  })

  it('prefers ?server-url= over env', () => {
    expect(
      resolveServerUrl({
        search: '?server-url=ws://x:1',
        env: { VITE_WORDTABLE_SERVER_URL: 'ws://env:2' },
      }),
    ).toBe('ws://x:1')
  })

  it('matches the key case-insensitively and trims a trailing slash', () => {
    expect(resolveServerUrl({ search: '?SERVER-URL=ws://y:2/', env: {} })).toBe(
      'ws://y:2',
    )
  })

  it('falls back to VITE_ then plain WORDTABLE_SERVER_URL env', () => {
    expect(
      resolveServerUrl({
        search: '',
        env: { VITE_WORDTABLE_SERVER_URL: 'wss://a.example' },
      }),
    ).toBe('wss://a.example')
    expect(
      resolveServerUrl({
        search: '',
        env: { WORDTABLE_SERVER_URL: 'wss://b.example' },
      }),
    ).toBe('wss://b.example')
  })

  it('hasServerUrlParam detects the override key', () => {
    expect(hasServerUrlParam('')).toBe(false)
    expect(hasServerUrlParam('?rack=HELLO')).toBe(false)
    expect(hasServerUrlParam('?server-url=ws://x:1')).toBe(true)
  })
})

describe('create/join replies', () => {
  it('persists an acceptance-shaped create_room reply', async () => {
    const sock = await connected()
    const pending = net.createRoom('Ann')
    expect(sock.sent).toHaveLength(1)
    const payload = JSON.parse(sock.sent[0] ?? '{}') as Record<string, unknown>
    expect(payload).toEqual({ v: 1, m: 'create_room', name: 'Ann' })
    expect('id' in payload).toBe(false)
    sock.receive(GOOD_REPLY)
    const reply = await pending
    expect(reply.ok).toBe(true)
    expect(netStore.getState().code).toBe('ABCD')
    expect(netStore.getState().token).toBe('token-0123456789')
    expect(netStore.getState().code).toMatch(/^[A-Z]{4}$/)
    expect(netStore.getState().token?.length ?? 0).toBeGreaterThanOrEqual(8)
    expect(localStorage.getItem(NET_CODE_KEY)).toBe('ABCD')
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBe('token-0123456789')
  })

  it('serializes two create_room calls in order', async () => {
    const sock = await connected()
    const first = net.createRoom('Ann')
    const second = net.createRoom('Bo')
    expect(sock.sent).toHaveLength(1)
    sock.receive({ ...GOOD_REPLY, code: 'AAAA', token: 'token-aaaa-0001' })
    await expect(first).resolves.toMatchObject({ ok: true, code: 'AAAA' })
    expect(sock.sent).toHaveLength(2)
    sock.receive({ ...GOOD_REPLY, code: 'BBBB', token: 'token-bbbb-0002' })
    await expect(second).resolves.toMatchObject({ ok: true, code: 'BBBB' })
    expect(netStore.getState().code).toBe('BBBB')
  })

  it('rejects a bad-shaped reply without persisting', async () => {
    const sock = await connected()
    const pending = net.createRoom('Ann')
    sock.receive({ m: 'create_room', ok: true, code: 'AB12', token: 'short' })
    await expect(pending).resolves.toEqual({ ok: false, error: 'BAD_REPLY' })
    expect(netStore.getState().code).toBeNull()
    expect(localStorage.getItem(NET_CODE_KEY)).toBeNull()
    expect(localStorage.getItem(NET_TOKEN_KEY)).toBeNull()
  })

  it('returns ok:false untouched on a refusal', async () => {
    const sock = await connected()
    const pending = net.createRoom('Ann')
    sock.receive({ m: 'create_room', ok: false, error: 'ROOM_FULL' })
    await expect(pending).resolves.toEqual({ ok: false, error: 'ROOM_FULL' })
    expect(boardToTiles(gameStore.getState().board)).toEqual({})
    expect(netStore.getState().code).toBeNull()
  })

  it('joining a different room never sends the stale token', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    expect(netStore.getState().code).toBe('ABCD')
    sock.sent.length = 0

    const join = net.joinRoom('WXYZ', 'Bo')
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'join_room',
      code: 'WXYZ',
    })
    expect('token' in JSON.parse(sock.sent[0] ?? '{}')).toBe(false)
    sock.receive({ m: 'join_room', ok: true, code: 'WXYZ', token: 'token-wxyz-0002', seat: 0 })
    await expect(join).resolves.toMatchObject({ ok: true, code: 'WXYZ' })
    expect(netStore.getState().code).toBe('WXYZ')
  })

  it('rejoining the same room code reclaims with the stored token', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    sock.sent.length = 0

    const join = net.joinRoom('abcd', 'Ann')
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'join_room',
      token: 'token-0123456789',
    })
    sock.receive({ ...GOOD_REPLY, seat: 0 })
    await expect(join).resolves.toMatchObject({ ok: true })
  })

  it('an explicit token arg is always attached', async () => {
    const sock = await connected()
    const join = net.joinRoom('WXYZ', 'Bo', 'explicit-token-1')
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'join_room',
      code: 'WXYZ',
      token: 'explicit-token-1',
    })
    sock.receive({ m: 'join_room', ok: true, code: 'WXYZ', token: 'explicit-token-1', seat: 0 })
    await expect(join).resolves.toMatchObject({ ok: true })
  })

  it('refuses to send while offline', async () => {
    await expect(net.createRoom('Ann')).resolves.toEqual({
      ok: false,
      error: 'NOT_CONNECTED',
    })
    await expect(net.placeTiles([])).resolves.toEqual({
      ok: false,
      error: 'NO_ROOM',
    })
  })

  it('disconnect drops back to offline', async () => {
    await connected()
    net.disconnect()
    expect(netStore.getState().status).toBe('offline')
  })
})

describe('intent payloads', () => {
  it('sends join/start/place/pass/exchange over the same socket', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    sock.sent.length = 0

    const join = net.joinRoom('ABCD', 'Bo')
    sock.receive({ ...GOOD_REPLY, seat: 1 })
    await expect(join).resolves.toMatchObject({ ok: true, seat: 1 })
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'join_room',
      code: 'ABCD',
      name: 'Bo',
    })

    const start = net.startGame()
    sock.receive({ m: 'start_game', ok: true, turn: 0, scores: [0, 0] })
    await expect(start).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[1] ?? '{}')).toMatchObject({
      v: 1,
      m: 'start_game',
      code: 'ABCD',
    })

    const place = net.placeTiles([{ square: 'H8', face: 'A' }])
    sock.receive({ m: 'place_tiles', ok: true, accepted: true })
    await expect(place).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[2] ?? '{}')).toMatchObject({
      v: 1,
      m: 'place_tiles',
      tiles: [{ square: 'H8', face: 'A' }],
    })

    const pass = net.passTurn()
    sock.receive({ m: 'pass', ok: true, accepted: true })
    await expect(pass).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[3] ?? '{}')).toMatchObject({ v: 1, m: 'pass' })

    const byCount = net.exchange(3)
    sock.receive({ m: 'exchange', ok: true, accepted: true })
    await expect(byCount).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[4] ?? '{}')).toMatchObject({
      v: 1,
      m: 'exchange',
      count: 3,
    })

    const byFaces = net.exchange(['A', 'B'])
    sock.receive({ m: 'exchange', ok: true, accepted: true })
    await expect(byFaces).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[5] ?? '{}')).toMatchObject({
      v: 1,
      m: 'exchange',
      tiles: ['A', 'B'],
    })
  })
})

describe('state_sync projection', () => {
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

  it('maps board_tiles and rack into the game store', () => {
    gameStore.getState().applyStateSync(SNAPSHOT)
    const tiles = boardToTiles(gameStore.getState().board)
    expect(Object.keys(tiles)).toHaveLength(3)
    expect(tiles['H8']).toBe('A')
    expect(tiles['I8']).toBe('B')
    expect(tiles['H10']).toBe('C')
    const rack = gameStore.getState().rack
    expect(rack).toHaveLength(7)
    expect(rack.filter((t) => t.isBlank)).toHaveLength(1)
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().lastMove).toHaveLength(3)
    expect(gameStore.getState().lastScore).toBeNull()
  })

  it('clears pending predictions on sync', () => {
    gameStore.getState().setRack(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    expect(gameStore.getState().pending).toHaveLength(1)
    gameStore.getState().applyStateSync(SNAPSHOT)
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().selectedRack).toBeNull()
  })

  it('skips unknown squares without throwing', () => {
    expect(() =>
      gameStore.getState().applyStateSync({
        board_tiles: [
          { square: 'Z9', letter: 'X', blank: false },
          { row: 99, col: 99, letter: 'Y', blank: false },
          { square: 'A1', letter: 'Q', blank: false },
          { square: 'H8', letter: '7', blank: false },
        ],
        rack: [],
      }),
    ).not.toThrow()
    const tiles = boardToTiles(gameStore.getState().board)
    expect(Object.keys(tiles)).toHaveLength(1)
    expect(tiles['A1']).toBe('Q')
  })

  it('dispatches a 5-tile state_sync to board, scores and turn', () => {
    uiStore.getState().setSeats(['You', 'Rival 1'])
    const tiles = ['B2', 'C2', 'D2', 'E2', 'F2'].map((square, i) => ({
      square,
      letter: String.fromCharCode(65 + i),
      blank: false,
    }))
    handleFrame({
      m: 'state_sync',
      ok: true,
      turn: 1,
      scores: [10, 4],
      board_tiles: tiles,
      rack: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    })
    expect(uiStore.getState().turn).toBe(1)
    expect(uiStore.getState().scores).toEqual([10, 4])
    const html = buildTableBoardHTML(boardToTiles(gameStore.getState().board))
    expect((html.match(/class="tile committed"/g) ?? []).length).toBe(5)
  })

  it('routes chat through receiveChat and ignores unknown frames', () => {
    expect(uiStore.getState().chat).toHaveLength(0)
    handleFrame({ m: 'chat', from: 'Rival 1', text: 'gl hf' })
    expect(uiStore.getState().chat).toHaveLength(1)
    expect(uiStore.getState().chat[0]?.text).toBe('gl hf')
    expect(() => handleFrame({ m: 'lobby_ping', seats: 2 })).not.toThrow()
    expect(() => handleFrame({})).not.toThrow()
    expect(uiStore.getState().chat).toHaveLength(1)
  })

  it('tolerates malformed socket frames', async () => {
    const sock = await connected()
    const before = boardToTiles(gameStore.getState().board)
    expect(() => sock.receiveRaw('not json{{')).not.toThrow()
    expect(() => sock.receive([1, 2, 3])).not.toThrow()
    expect(boardToTiles(gameStore.getState().board)).toEqual(before)
  })

  it('resetOnline clears the authoritative board', () => {
    gameStore.getState().applyStateSync(SNAPSHOT)
    expect(Object.keys(boardToTiles(gameStore.getState().board))).toHaveLength(3)
    gameStore.getState().resetOnline()
    expect(boardToTiles(gameStore.getState().board)).toEqual({})
    expect(gameStore.getState().rack).toHaveLength(0)
    expect(gameStore.getState().lastMove).toHaveLength(0)
  })
})

describe('online chat intents (issue #16)', () => {
  it('sends chat/emote payloads with auth over the same socket', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_REPLY)
    await created
    sock.sent.length = 0

    const chat = net.sendChat('hello table')
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'chat',
      code: 'ABCD',
      token: 'token-0123456789',
      text: 'hello table',
    })
    sock.receive({ m: 'chat', ok: true, chat_ok: true, from: 'Ann', text: 'hello table' })
    await expect(chat).resolves.toMatchObject({ ok: true })

    const emote = net.sendEmote('👏')
    expect(JSON.parse(sock.sent[1] ?? '{}')).toMatchObject({
      v: 1,
      m: 'emote',
      code: 'ABCD',
      token: 'token-0123456789',
      text: '👏',
      emote: '👏',
    })
    sock.receive({ m: 'emote', ok: true, emote_ok: true, from: 'Ann', text: '👏', emote: '👏' })
    await expect(emote).resolves.toMatchObject({ ok: true })
  })

  it('refuses chat intents without a seat', async () => {
    await expect(net.sendChat('hi')).resolves.toEqual({ ok: false, error: 'NO_ROOM' })
    await expect(net.sendEmote('👏')).resolves.toEqual({ ok: false, error: 'NO_ROOM' })
  })

  it('routes emote frames via the emote alias and bumps unread when closed', () => {
    expect(uiStore.getState().chatOpen).toBe(false)
    expect(uiStore.getState().chat).toHaveLength(0)
    handleFrame({ m: 'emote', from: 'Rival 1', emote: '👏' })
    expect(uiStore.getState().chat).toHaveLength(1)
    expect(uiStore.getState().chat[0]?.text).toBe('👏')
    expect(uiStore.getState().unread).toBe(1)
  })
})
