// Chat draft lifecycle (issue #93): sending clears the *live* post-repaint
// input, while unrelated repaints keep a mid-typing draft. Fake-host
// harness (no DOM): the root's `innerHTML` setter regenerates a fresh
// input node like a real DOM replace, and a subscribed `repaintChatRoot`
// plays the Table/lobby repaint role, so the old detached-node clear
// fails exactly like the browser did.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mountChatPanel,
  repaintChatRoot,
} from '../../client/src/components/ChatPanel'
import { uiStore } from '../../client/src/store/ui'
import { resetNetForTests } from '../../client/src/store/net'

type Handler = (ev: unknown) => void

// Shared fake document: `focus()` parks the node as the active element,
// mirroring `ownerDocument.activeElement` for the helper's snapshot.
class FakeDocument {
  activeElement: unknown = null
}

// Fresh node per repaint: `value` starts empty and `focus()` marks it
// active, like a newly parsed `<input>` in a replaced `#chat-root`.
class FakeInput {
  value = ''
  constructor(readonly doc: FakeDocument) {}

  get ownerDocument(): FakeDocument {
    return this.doc
  }

  closest(selector: string): FakeInput | null {
    return selector === '.chat-input' ? this : null
  }

  focus(): void {
    this.doc.activeElement = this
  }
}

// Minimal event target: matches itself against the one selector the
// panel queries for it, like Element.closest does for a direct hit.
class FakeTarget {
  value = ''
  constructor(readonly selectors: string[]) {}

  closest(selector: string): FakeTarget | null {
    return this.selectors.includes(selector) ? this : null
  }
}

// Minimal chat root: setting `innerHTML` swaps in a fresh input node,
// so clearing a pre-repaint reference leaves the visible draft behind.
class FakeChatRoot {
  dataset: Record<string, string> = {}
  send = new FakeTarget(['[data-action="send-chat"]'])
  private doc = new FakeDocument()
  private current = new FakeInput(this.doc)
  private html = ''
  private listeners = new Map<string, Handler[]>()

  get input(): FakeInput {
    return this.current
  }

  get document(): FakeDocument {
    return this.doc
  }

  get innerHTML(): string {
    return this.html
  }

  set innerHTML(next: string) {
    this.html = String(next)
    this.current = new FakeInput(this.doc)
  }

  querySelector(selector: string): FakeInput | null {
    return selector === '.chat-input' ? this.current : null
  }

  contains(node: unknown): boolean {
    return node === this.current || node === this.send
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  click(target: FakeTarget): void {
    for (const fn of this.listeners.get('click') ?? []) fn({ target })
  }

  keydown(target: FakeInput, key: string): void {
    for (const fn of this.listeners.get('keydown') ?? [])
      fn({ key, target, preventDefault: () => {} })
  }
}

let unsub: (() => void) | null = null

function mountRoot(): FakeChatRoot {
  const root = new FakeChatRoot()
  mountChatPanel(root as unknown as HTMLElement)
  unsub = uiStore.subscribe(() =>
    repaintChatRoot(root as unknown as HTMLElement),
  )
  return root
}

function texts(): string[] {
  return uiStore.getState().chat.map((m) => m.text)
}

beforeEach(() => {
  resetNetForTests()
  uiStore.getState().resetTable()
})

afterEach(() => {
  unsub?.()
  unsub = null
  resetNetForTests()
  uiStore.getState().resetTable()
})

describe('chat draft lifecycle (issue #93)', () => {
  it('click-send lands in the log and the live input is empty', () => {
    const root = mountRoot()
    root.input.value = 'hello table'
    root.click(root.send)
    expect(texts()).toContain('hello table')
    expect(root.input.value).toBe('')
  })

  it('Enter-key send clears the live input too', () => {
    const root = mountRoot()
    root.input.value = 'hello table'
    root.keydown(root.input, 'Enter')
    expect(texts()).toContain('hello table')
    expect(root.input.value).toBe('')
  })

  it('a successful send keeps focus on the live input for follow-ups', () => {
    const root = mountRoot()
    root.input.focus()
    root.input.value = 'hello table'
    root.click(root.send)
    expect(root.document.activeElement).toBe(root.input)
    expect(root.input.value).toBe('')
  })

  it('an unrelated repaint while mid-typing retains the draft', () => {
    const root = mountRoot()
    root.input.value = 'half-typed'
    uiStore.getState().receiveChat('Rival', 'hi there')
    expect(texts()).toContain('hi there')
    expect(root.input.value).toBe('half-typed')
  })

  it('blank send keeps the draft and appends nothing', () => {
    const root = mountRoot()
    root.input.value = '   '
    root.click(root.send)
    expect(texts()).toHaveLength(0)
    expect(root.input.value).toBe('   ')
  })

  it('helper with an empty unfocused draft leaves the fresh input empty', () => {
    const root = mountRoot()
    expect(root.input.value).toBe('')
    uiStore.getState().receiveChat('Rival', 'hi there')
    expect(root.input.value).toBe('')
  })
})
