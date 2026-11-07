// Chat send during `reconnecting` (issue #57): a send on a flaky network
// must echo into the sender's `#chat-log` instead of dropping as
// NOT_CONNECTED. Fake-panel harness (no DOM): the panel only needs
// querySelector/contains/addEventListener/dataset, so minimal stand-ins
// keep the suite hermetic like the other client suites.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountChatPanel } from '../../client/src/components/ChatPanel'
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

// Minimal event target: matches itself against the one selector the
// panel queries for it, like Element.closest does for a direct hit.
class FakeTarget {
  value = ''
  constructor(
    readonly selectors: string[],
    readonly attrs: Record<string, string> = {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }

  closest(selector: string): FakeTarget | null {
    return this.selectors.includes(selector) ? this : null
  }
}

// Minimal panel host: the input, the send button and the emote trio,
// with captured click/keydown listeners the test fires directly.
class FakeHost {
  dataset: Record<string, string> = {}
  input = new FakeTarget(['.chat-input'])
  send = new FakeTarget(['[data-action="send-chat"]'])
  emotes = ['👏', '😂', '👍'].map(
    (emote) => new FakeTarget(['[data-emote]'], { 'data-emote': emote }),
  )
  private listeners = new Map<string, Handler[]>()

  querySelector(selector: string): FakeTarget | null {
    return selector === '.chat-input' ? this.input : null
  }

  contains(node: unknown): boolean {
    return (
      node === this.input ||
      node === this.send ||
      this.emotes.includes(node as FakeTarget)
    )
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  click(target: FakeTarget): void {
    for (const fn of this.listeners.get('click') ?? []) fn({ target })
  }

  keydown(target: FakeTarget, key: string): void {
    for (const fn of this.listeners.get('keydown') ?? [])
      fn({ key, target, preventDefault: () => {} })
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

const GOOD_REPLY = {
  m: 'create_room',
  ok: true,
  code: 'ABCD',
  token: 'token-0123456789',
  seat: 0,
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
  sock.open()
  await expect(pending).resolves.toEqual({ ok: true })
  expect(netStore.getState().status).toBe('online')
  return sock
}

async function seated(): Promise<FakeSocket> {
  const sock = await connected()
  const created = net.createRoom('Ann')
  sock.receive(GOOD_REPLY)
  await created
  sock.sent.length = 0
  return sock
}

function mountPanel(): FakeHost {
  const host = new FakeHost()
  mountChatPanel(host as unknown as HTMLElement)
  return host
}

function texts(): string[] {
  return uiStore.getState().chat.map((m) => m.text)
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  stubLocalStorage()
  prevSocket = (globalThis as Record<string, unknown>).WebSocket
  ;(globalThis as Record<string, unknown>).WebSocket = FakeSocket as unknown as new (
    url: string,
  ) => WebSocket
  FakeSocket.instances = []
  resetNetForTests()
  uiStore.getState().resetTable()
})

afterEach(() => {
  resetNetForTests()
  uiStore.getState().resetTable()
  if (prevSocket === undefined) {
    delete (globalThis as Record<string, unknown>).WebSocket
  } else {
    ;(globalThis as Record<string, unknown>).WebSocket = prevSocket
  }
})

describe('chat send during reconnecting (issue #57)', () => {
  it('click-send during reconnecting echoes locally and clears the input', () => {
    netStore.setState({
      code: 'ABCD',
      token: 'token-0123456789',
      status: 'reconnecting',
    })
    expect(FakeSocket.instances).toHaveLength(0)
    const host = mountPanel()
    host.input.value = 'hello flaky'
    host.click(host.send)
    expect(texts()).toContain('hello flaky')
    expect(host.input.value).toBe('')
  })

  it('Enter-key send during reconnecting echoes locally', () => {
    netStore.setState({
      code: 'ABCD',
      token: 'token-0123456789',
      status: 'reconnecting',
    })
    const host = mountPanel()
    host.input.value = 'enter on flaky'
    host.keydown(host.input, 'Enter')
    expect(texts()).toContain('enter on flaky')
    expect(host.input.value).toBe('')
  })

  it('emote click during reconnecting echoes locally with no socket frame', () => {
    netStore.setState({
      code: 'ABCD',
      token: 'token-0123456789',
      status: 'reconnecting',
    })
    const host = mountPanel()
    host.click(host.emotes[1]!)
    expect(texts()).toContain('😂')
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('online NOT_CONNECTED race reply falls back to local echo', async () => {
    const sock = await seated()
    const host = mountPanel()
    host.input.value = 'race me'
    host.click(host.send)
    expect(host.input.value).toBe('')
    expect(sock.sent).toHaveLength(1)
    expect(texts()).toHaveLength(0)
    sock.receive({ m: 'chat', ok: false, error: 'NOT_CONNECTED' })
    await flush()
    expect(texts()).toContain('race me')
  })

  it('healthy online send emits exactly one socket frame with no local duplicate', async () => {
    const sock = await seated()
    const host = mountPanel()
    host.input.value = 'hi table'
    host.click(host.send)
    expect(sock.sent).toHaveLength(1)
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'chat',
      code: 'ABCD',
      text: 'hi table',
    })
    expect(texts()).toHaveLength(0)
    sock.receive({ m: 'chat', ok: true })
    await flush()
    expect(texts()).toHaveLength(0)
    handleFrame({ m: 'chat', from: 'Ann', text: 'hi table' })
    expect(texts()).toEqual(['hi table'])
  })
})
