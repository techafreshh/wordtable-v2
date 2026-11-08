// Chat close affordances (issue #92): the panel header carries an explicit
// × close button, Escape and outside-click close as secondary affordances,
// and the unread badge still re-appears after close. Fake-panel harness
// (no DOM): extends the chat-reconnect FakeHost/FakeTarget idiom with a
// close-button target and a shared FakeDocument for the one-time document
// listeners registered by mountChatPanel.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildChatPanelHTML,
  mountChatPanel,
} from '../../client/src/components/ChatPanel'
import { buildChatBubbleHTML } from '../../client/src/components/ChatBubble'
import { uiStore } from '../../client/src/store/ui'

type Handler = (ev: unknown) => void

// Minimal event target: matches itself against any selector in its list,
// like Element.closest does for a direct hit.
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

// Minimal panel host: the input, the send and close buttons and the emote
// trio, with captured click/keydown listeners the test fires directly.
class FakeHost {
  dataset: Record<string, string> = {}
  input = new FakeTarget(['.chat-input'])
  send = new FakeTarget(['[data-action="send-chat"]'])
  closeBtn = new FakeTarget(['[data-action="close-chat"]'])
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
      node === this.closeBtn ||
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
}

// Shared document stand-in: one instance for the whole file, because the
// chat-global listeners register once (chatGlobalMounted) on the object
// present at the first mount.
class FakeDocument {
  private listeners = new Map<string, Handler[]>()
  private options = new Map<string, unknown>()

  addEventListener(type: string, fn: Handler, opts?: unknown): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
    this.options.set(type, opts)
  }

  captureOf(type: string): unknown {
    return this.options.get(type)
  }

  fire(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev)
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

const doc = new FakeDocument()
let prevDocument: unknown

function mountPanel(): FakeHost {
  const host = new FakeHost()
  mountChatPanel(host as unknown as HTMLElement)
  return host
}

function outsideTarget(): FakeTarget {
  // A tap on the board area: matches nothing, so closest('#chat-root')
  // is null and the panel must close.
  return new FakeTarget([])
}

function insideTarget(): FakeTarget {
  // A tap inside the bubble/panel subtree: closest('#chat-root') hits.
  return new FakeTarget(['#chat-root'])
}

beforeEach(() => {
  stubLocalStorage()
  prevDocument = (globalThis as Record<string, unknown>).document
  ;(globalThis as Record<string, unknown>).document = doc
  uiStore.getState().resetTable()
})

afterEach(() => {
  uiStore.getState().resetTable()
  if (prevDocument === undefined) {
    delete (globalThis as Record<string, unknown>).document
  } else {
    ;(globalThis as Record<string, unknown>).document = prevDocument
  }
})

describe('chat close affordances (issue #92)', () => {
  it('builder emits exactly one Close chat button before the emote row', () => {
    const html = buildChatPanelHTML([], true)
    expect((html.match(/aria-label="Close chat"/g) ?? []).length).toBe(1)
    expect(html).toContain('>×</button>')
    const closeAt = html.indexOf('aria-label="Close chat"')
    expect(closeAt).toBeGreaterThan(html.indexOf('id="chat-panel"'))
    expect(closeAt).toBeLessThan(html.indexOf('id="chat-log"'))
    expect(closeAt).toBeLessThan(html.indexOf('data-emote='))
    // Three emotes plus Send plus the close button.
    expect((html.match(/<button/g) ?? []).length).toBe(5)
  })

  it('clicking the close button flips chatOpen true to false', () => {
    uiStore.getState().setChatOpen(true)
    expect(uiStore.getState().chatOpen).toBe(true)
    const host = mountPanel()
    host.click(host.closeBtn)
    expect(uiStore.getState().chatOpen).toBe(false)
  })

  it('setChatOpen opens clearing the badge and closes preserving it', () => {
    uiStore.getState().receiveChat('Rival 1', 'hi')
    expect(uiStore.getState().unread).toBe(1)
    uiStore.getState().setChatOpen(true)
    expect(uiStore.getState().chatOpen).toBe(true)
    expect(uiStore.getState().unread).toBe(0)
    uiStore.getState().receiveChat('Rival 1', 'still here')
    expect(uiStore.getState().unread).toBe(0)
    uiStore.getState().setChatOpen(false)
    expect(uiStore.getState().chatOpen).toBe(false)
    uiStore.getState().receiveChat('Rival 1', 'again')
    expect(uiStore.getState().unread).toBe(1)
  })

  it('Escape closes only when open and never clears the chat', () => {
    mountPanel()
    uiStore.getState().sendChat('keep me')
    // Closed already: Escape is a no-op, never throws.
    doc.fire('keydown', {
      key: 'Escape',
      preventDefault: () => {},
    })
    expect(uiStore.getState().chatOpen).toBe(false)
    expect(uiStore.getState().chat).toHaveLength(1)
    uiStore.getState().setChatOpen(true)
    doc.fire('keydown', {
      key: 'Escape',
      preventDefault: () => {},
    })
    expect(uiStore.getState().chatOpen).toBe(false)
    expect(uiStore.getState().chat.map((m) => m.text)).toEqual(['keep me'])
  })

  it('outside-#chat-root click closes while inside clicks do not', () => {
    mountPanel()
    // Capture phase: the repaint detaches the click target mid-dispatch,
    // so a bubble-phase check would misread the opener as an outside tap.
    expect(doc.captureOf('click')).toBe(true)
    uiStore.getState().setChatOpen(true)
    doc.fire('click', { target: insideTarget() })
    expect(uiStore.getState().chatOpen).toBe(true)
    doc.fire('click', { target: outsideTarget() })
    expect(uiStore.getState().chatOpen).toBe(false)
    // Closed already: further outside taps stay closed, never throw.
    doc.fire('click', { target: outsideTarget() })
    expect(uiStore.getState().chatOpen).toBe(false)
  })

  it('receiveChat after close still bumps unread and the bubble shows the badge', () => {
    mountPanel()
    uiStore.getState().setChatOpen(true)
    doc.fire('keydown', {
      key: 'Escape',
      preventDefault: () => {},
    })
    expect(uiStore.getState().chatOpen).toBe(false)
    expect(uiStore.getState().receiveChat('Rival 1', 'missed you')).toBe(true)
    expect(uiStore.getState().unread).toBe(1)
    const bubble = buildChatBubbleHTML(
      uiStore.getState().unread,
      uiStore.getState().chatOpen,
    )
    expect(bubble).toContain('id="chat-bubble"')
    expect(bubble).toContain('>1<')
    expect(bubble).toContain('aria-label="Open chat">')
    expect(bubble).not.toContain('unread-badge" hidden')
  })

  it('both hud.css copies dock the panel top on mobile with a header rule', () => {
    const canonical = readFileSync(
      new URL('../../client/styles/hud.css', import.meta.url),
      'utf8',
    )
    const bundled = readFileSync(
      new URL('../../client/src/styles/hud.css', import.meta.url),
      'utf8',
    )
    for (const hud of [canonical, bundled]) {
      expect(hud).toContain('.chat-header')
      expect(hud).toContain('top: 0.75rem')
      expect(hud).toContain('max-height: 44dvh')
    }
  })
})
