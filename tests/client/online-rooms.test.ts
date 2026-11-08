// Online rooms UI entry (issue #88): the StartScreen Create/Join wiring,
// the host `add_bot` intent + `started` flag, the online lobby/table
// builders and the two new hash routes — over the FakeSocket harness
// from tests/client/net.test.ts (no DOM environment in vitest).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildJoinModalHTML,
  mountStartScreen,
  normalizeJoinCode,
} from '../../client/src/components/StartScreen'
import { buildOnlineLobbyHTML } from '../../client/src/components/OnlineLobby'
import { buildOnlineTableHTML } from '../../client/src/components/OnlineTable'
import { parseRoute, routeHash, ROUTES } from '../../client/src/router'
import { gameStore } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  handleFrame,
  net,
  netStore,
  resetNetForTests,
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

function stubWindow(): { location: { hash: string; search: string } } {
  const location = { hash: '', search: '' }
  ;(globalThis as Record<string, unknown>).window = {
    location,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  }
  return { location }
}

let prevSocket: unknown
let prevWindow: unknown

function lastSocket(): FakeSocket {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1]
  if (!sock) throw new Error('no socket dialled')
  return sock
}

async function connected(): Promise<FakeSocket> {
  const pending = net.connect()
  const sock = lastSocket()
  sock.open()
  await expect(pending).resolves.toEqual({ ok: true })
  expect(netStore.getState().status).toBe('online')
  return sock
}

const GOOD_CREATE = {
  m: 'create_room',
  ok: true,
  code: 'ABCD',
  token: 'token-0123456789',
  seat: 0,
}

// Minimal start-root stub: mountStartScreen only walks
// querySelector/insertAdjacentHTML, so plain objects suffice.
interface StubButton {
  disabled: boolean
  handlers: Array<() => void>
  addEventListener: (type: string, fn: () => void) => void
  click: () => void
}

interface StubModal {
  input: { value: string; addEventListener: (type: string, fn: () => void) => void }
  confirm: StubButton
  cancel: StubButton
  removed: boolean
  querySelector: (sel: string) => unknown
}

function stubButton(): StubButton {
  const button: StubButton = {
    disabled: false,
    handlers: [],
    addEventListener: (type: string, fn: () => void): void => {
      if (type === 'click') button.handlers.push(fn)
    },
    click: (): void => {
      for (const fn of [...button.handlers]) fn()
    },
  }
  return button
}

function stubModal(): StubModal {
  const modal: StubModal = {
    input: { value: '', addEventListener: (): void => {} },
    confirm: stubButton(),
    cancel: stubButton(),
    removed: false,
    querySelector: (sel: string): unknown => {
      if (sel === '#join-code') return modal.input
      if (sel === '#join-confirm') return modal.confirm
      if (sel === '#join-cancel') return modal.cancel
      return null
    },
  }
  return modal
}

function stubStartRoot(nickname: string): {
  root: HTMLElement
  buttons: Record<string, StubButton>
  html: () => string
  modal: () => StubModal | null
} {
  const buttons: Record<string, StubButton> = {
    create: stubButton(),
    join: stubButton(),
    play: stubButton(),
  }
  const state = {
    html: '',
    modal: null as StubModal | null,
    buttons,
    querySelector: (sel: string): unknown => {
      const action = /data-action="(\w+)"/.exec(sel)?.[1]
      if (action && buttons[action]) return buttons[action]
      if (sel === '#nickname') return { value: nickname }
      if (sel === '#join-modal') {
        if (state.modal === null) return null
        return {
          querySelector: state.modal.querySelector,
          remove: (): void => {
            if (state.modal) state.modal.removed = true
            state.modal = null
          },
        }
      }
      return null
    },
    insertAdjacentHTML: (_pos: string, html: string): void => {
      state.html += html
      state.modal = stubModal()
    },
  }
  return {
    root: state as unknown as HTMLElement,
    buttons,
    html: () => state.html,
    modal: () => state.modal,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  stubLocalStorage()
  prevWindow = (globalThis as Record<string, unknown>).window
  stubWindow()
  prevSocket = (globalThis as Record<string, unknown>).WebSocket
  ;(globalThis as Record<string, unknown>).WebSocket = FakeSocket as unknown as new (
    url: string,
  ) => WebSocket
  FakeSocket.instances = []
  resetNetForTests()
  gameStore.getState().reset()
  uiStore.getState().resetTable()
  uiStore.getState().clearToast()
})

afterEach(() => {
  resetNetForTests()
  uiStore.getState().clearToast()
  if (prevSocket === undefined) {
    delete (globalThis as Record<string, unknown>).WebSocket
  } else {
    ;(globalThis as Record<string, unknown>).WebSocket = prevSocket
  }
  if (prevWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window
  } else {
    ;(globalThis as Record<string, unknown>).window = prevWindow
  }
})

describe('addBot intent + started flag', () => {
  it('sends add_bot with code+token over the open socket', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_CREATE)
    await expect(created).resolves.toMatchObject({ ok: true })
    sock.sent.length = 0

    const added = net.addBot()
    expect(sock.sent).toHaveLength(1)
    expect(JSON.parse(sock.sent[0] ?? '{}')).toEqual({
      v: 1,
      m: 'add_bot',
      code: 'ABCD',
      token: 'token-0123456789',
    })
    sock.receive({ m: 'add_bot', ok: true, bot: 'Botgomery', bot_seat: 1 })
    await expect(added).resolves.toMatchObject({ ok: true })
  })

  it('refuses addBot without a seat', async () => {
    await expect(net.addBot()).resolves.toEqual({ ok: false, error: 'NO_ROOM' })
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('create → addBot → startGame keep intent order on one socket', async () => {
    const sock = await connected()
    const created = net.createRoom('Ann')
    sock.receive(GOOD_CREATE)
    await created
    const added = net.addBot()
    sock.receive({ m: 'add_bot', ok: true, bot: 'Botgomery', bot_seat: 1 })
    await added
    const started = net.startGame()
    sock.receive({ m: 'start_game', ok: true, started: true, turn: 0 })
    await expect(started).resolves.toMatchObject({ ok: true })
    const methods = sock.sent.map((raw) => (JSON.parse(raw) as { m: string }).m)
    expect(methods).toEqual(['create_room', 'add_bot', 'start_game'])
  })

  it('createRoom accept clears started; startGame accept sets it', async () => {
    const sock = await connected()
    netStore.setState({ started: true })
    const created = net.createRoom('Ann')
    sock.receive(GOOD_CREATE)
    await created
    expect(netStore.getState().started).toBe(false)
    const started = net.startGame()
    sock.receive({ m: 'start_game', ok: true, started: true, turn: 0 })
    await started
    expect(netStore.getState().started).toBe(true)
  })

  it('a state_sync carrying started:true flips the lobby flag', () => {
    expect(netStore.getState().started).toBe(false)
    handleFrame({ m: 'state_sync', started: false, turn: 0, scores: [0, 0] })
    expect(netStore.getState().started).toBe(false)
    handleFrame({ m: 'state_sync', started: true, turn: 0, scores: [0, 0] })
    expect(netStore.getState().started).toBe(true)
  })

  it('disconnect clears the started flag', async () => {
    await connected()
    netStore.setState({ started: true })
    net.disconnect()
    expect(netStore.getState().started).toBe(false)
  })
})

describe('join-code normalization', () => {
  it('trims and uppercases a valid code', () => {
    expect(normalizeJoinCode('abcd')).toBe('ABCD')
    expect(normalizeJoinCode('  abCd  ')).toBe('ABCD')
  })

  it('rejects anything outside 4 letters', () => {
    expect(normalizeJoinCode('')).toBeNull()
    expect(normalizeJoinCode('ABC')).toBeNull()
    expect(normalizeJoinCode('ABCDE')).toBeNull()
    expect(normalizeJoinCode('AB12')).toBeNull()
    expect(normalizeJoinCode('AB C')).toBeNull()
  })

  it('builds a 4-char modal with confirm and cancel', () => {
    const html = buildJoinModalHTML()
    expect(html).toContain('id="join-modal"')
    expect(html).toContain('id="join-code"')
    expect(html).toContain('maxlength="4"')
    expect(html).toContain('id="join-confirm"')
    expect(html).toContain('id="join-cancel"')
  })
})

describe('StartScreen online wiring', () => {
  it('Create dials, creates the room and lands on the online lobby', async () => {
    const { root, buttons } = stubStartRoot('Ann')
    const win = (globalThis as Record<string, unknown>).window as {
      location: { hash: string }
    }
    mountStartScreen(root)
    buttons['create']?.click()
    await flush()
    const sock = lastSocket()
    sock.open()
    await flush()
    expect(sock.sent.map((raw) => (JSON.parse(raw) as { m: string }).m)).toEqual([
      'create_room',
    ])
    sock.receive(GOOD_CREATE)
    await flush()
    expect(netStore.getState().code).toBe('ABCD')
    expect(win.location.hash).toBe('#/online-lobby')
    // The lineup pads to two seats per the uiStore contract; the real
    // roster arrives on the first state_sync broadcast.
    expect(uiStore.getState().seats).toEqual(['Ann', 'Rival 1'])
  })

  it('Create refusal surfaces a toast and stays on start', async () => {
    const { root, buttons } = stubStartRoot('Ann')
    const win = (globalThis as Record<string, unknown>).window as {
      location: { hash: string }
    }
    mountStartScreen(root)
    buttons['create']?.click()
    await flush()
    const sock = lastSocket()
    sock.open()
    await flush()
    sock.receive({ m: 'create_room', ok: false, error: 'ROOM_FULL' })
    await flush()
    expect(uiStore.getState().toast).toBe('ROOM_FULL')
    expect(win.location.hash).not.toBe('#/online-lobby')
  })

  it('Join opens the modal and joins a normalized code', async () => {
    const { root, buttons, html, modal } = stubStartRoot('Bo')
    const win = (globalThis as Record<string, unknown>).window as {
      location: { hash: string }
    }
    mountStartScreen(root)
    buttons['join']?.click()
    expect(html()).toContain('id="join-modal"')
    expect(modal()).not.toBeNull()
    modal()!.input.value = 'abcd'
    modal()!.confirm.click()
    await flush()
    const sock = lastSocket()
    sock.open()
    await flush()
    const payload = JSON.parse(sock.sent[sock.sent.length - 1] ?? '{}') as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({ v: 1, m: 'join_room', code: 'ABCD', name: 'Bo' })
    sock.receive({
      m: 'join_room',
      ok: true,
      code: 'ABCD',
      token: 'token-join-0002',
      seat: 1,
    })
    await flush()
    expect(netStore.getState().code).toBe('ABCD')
    expect(win.location.hash).toBe('#/online-lobby')
  })

  it('Join with a bad code toasts without dialing', async () => {
    const { root, buttons, html, modal } = stubStartRoot('Bo')
    mountStartScreen(root)
    buttons['join']?.click()
    modal()!.input.value = 'AB12'
    modal()!.confirm.click()
    await flush()
    expect(uiStore.getState().toast).toBe('Enter a 4-letter code')
    expect(FakeSocket.instances).toHaveLength(0)
  })
})

describe('online lobby builder', () => {
  it('shows the code, host buttons and seat plaques', () => {
    const html = buildOnlineLobbyHTML('ABCD', ['Ann'], true)
    expect(html).toContain('id="online-lobby"')
    expect(html).toContain('id="room-code"')
    expect(html).toContain('>ABCD<')
    expect(html).toContain('id="copy-link"')
    expect(html).toContain('id="add-bot"')
    expect(html).toContain('id="online-start"')
    expect(html).toContain('id="leave-online"')
    expect(html).toContain('id="chat-root"')
    expect(html).toContain('Ann')
  })

  it('badges Botgomery and hides host controls from guests', () => {
    const host = buildOnlineLobbyHTML('WXYZ', ['Ann', 'Botgomery'], true)
    expect(host).toContain('Botgomery')
    expect(host).toContain('bot-badge')
    const guest = buildOnlineLobbyHTML('WXYZ', ['Ann', 'Bo'], false)
    expect(guest).not.toContain('id="add-bot"')
    expect(guest).not.toContain('id="online-start"')
    expect(guest).toContain('id="leave-online"')
  })
})

describe('online table builder', () => {
  it('renders the placement skeleton with commit/pass/exchange', () => {
    gameStore.getState().setRack(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    uiStore.getState().setSeats(['Ann', 'Bo'])
    const html = buildOnlineTableHTML()
    expect(html).toContain('id="online-table"')
    expect(html).toContain('id="score-line"')
    expect(html).toContain('id="turn-line"')
    expect(html).toContain('board-host')
    expect(html).toContain('id="prov-score"')
    expect(html).toContain('id="rack"')
    expect(html).toContain('id="commit-button"')
    expect(html).toContain('>Play<')
    expect(html).toContain('id="pass-button"')
    expect(html).toContain('id="exchange-button"')
    expect(html).toContain('id="chat-root"')
  })
})

describe('online routes', () => {
  it('declares both online routes', () => {
    expect(ROUTES).toContain('online-lobby')
    expect(ROUTES).toContain('online-table')
  })

  it('round-trips the new hashes and keeps the start fallback', () => {
    expect(parseRoute('#/online-lobby')).toBe('online-lobby')
    expect(parseRoute('#/online-table')).toBe('online-table')
    expect(routeHash('online-lobby')).toBe('#/online-lobby')
    expect(routeHash('online-table')).toBe('#/online-table')
    expect(parseRoute('#/nope')).toBe('start')
  })
})
