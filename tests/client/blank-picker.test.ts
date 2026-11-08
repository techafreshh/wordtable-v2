// Blank picker viewport clamp + dialog keyboard contract (issue #90):
// the sheet fits short viewports with an internally scrolling grid,
// Escape cancels, Tab wraps focus, opening autofocuses A, and the
// 26-letter contract stays intact. Headless — FakeHost stand-ins with
// captured listeners, like tests/client/chat-reconnect.test.ts.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildBlankPickerHTML,
  mountBlankPicker,
} from '../../client/src/components/BlankPicker'
import { gameStore } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'

const SRC_STYLES = new URL('../../client/src/styles/', import.meta.url)

function css(name: string): string {
  return readFileSync(new URL(name, SRC_STYLES), 'utf8')
}

// First `{…}` block after the selector (no nesting in fx.css).
function ruleBlock(src: string, selector: string): string {
  const at = src.indexOf(selector)
  if (at === -1) return ''
  const open = src.indexOf('{', at)
  const close = src.indexOf('}', open)
  if (open === -1 || close === -1) return ''
  return src.slice(open, close)
}

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

type Handler = (ev: never) => void

// Minimal focusable button: identity is what the trap compares, focus()
// records so wrap assertions stay observable without a DOM.
class FakeButton {
  focused = false
  constructor(
    readonly selector: string,
    readonly letter: string | null = null,
  ) {}

  getAttribute(name: string): string | null {
    if (name === 'data-letter') return this.letter
    if (name === 'data-action' && this.selector.includes('cancel-picker')) {
      return 'cancel-picker'
    }
    return null
  }

  closest(selector: string): FakeButton | null {
    return this.selector === selector ||
      (selector === 'button[data-letter]' && this.letter !== null)
      ? this
      : null
  }

  focus(): void {
    this.focused = true
  }
}

// Minimal picker host: hidden-attribute tracking plus captured
// click/keydown listeners the test fires directly.
class FakeHost {
  dataset: Record<string, string> = {}
  hidden = true
  buttons: FakeButton[] = []
  private listeners = new Map<string, Handler[]>()

  constructor() {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      this.buttons.push(
        new FakeButton('button[data-letter]', letter),
      )
    }
    this.buttons.push(new FakeButton('button[data-action="cancel-picker"]'))
  }

  get first(): FakeButton {
    return this.buttons[0] as FakeButton
  }

  get last(): FakeButton {
    return this.buttons[this.buttons.length - 1] as FakeButton
  }

  get buttonA(): FakeButton {
    return this.buttons[0] as FakeButton
  }

  querySelector(selector: string): FakeButton | null {
    if (selector === 'button[data-letter="A"]') return this.buttonA
    return null
  }

  querySelectorAll(selector: string): FakeButton[] {
    if (selector === '.picker-sheet button:not([disabled])') {
      return [...this.buttons]
    }
    return []
  }

  contains(node: unknown): boolean {
    return (this.buttons as unknown[]).includes(node)
  }

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  setAttribute(name: string, _value: string): void {
    if (name === 'hidden') this.hidden = true
  }

  removeAttribute(name: string): void {
    if (name === 'hidden') this.hidden = false
  }

  keydown(
    target: FakeButton,
    key: string,
    shiftKey = false,
  ): { prevented: boolean } {
    let prevented = false
    const ev = {
      key,
      target,
      shiftKey,
      preventDefault: () => {
        prevented = true
      },
    }
    for (const fn of this.listeners.get('keydown') ?? []) {
      fn(ev as never)
    }
    return { prevented }
  }
}

function mount(): FakeHost {
  const host = new FakeHost()
  mountBlankPicker(host as unknown as HTMLElement)
  return host
}

beforeEach(() => {
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
})

describe('blank picker viewport clamp (issue #90)', () => {
  it('veils with padding so the centered sheet never touches the edges', () => {
    const veil = ruleBlock(css('fx.css'), '#blank-picker')
    expect(veil).toContain('padding: 1rem')
    expect(veil).toContain('box-sizing: border-box')
  })

  it('clamps the sheet height to the viewport with dvh + vh fallback', () => {
    const sheet = ruleBlock(css('fx.css'), '.picker-sheet')
    expect(sheet).toContain('max-height: calc(100vh - 2rem)')
    expect(sheet).toContain('max-height: calc(100dvh - 2rem)')
    expect(sheet).toContain('min-height: 0')
    expect(sheet).toContain('width: min(92vw, 22rem)')
  })

  it('scrolls only the letter grid so title and Cancel stay pinned', () => {
    const grid = ruleBlock(css('fx.css'), '.picker-grid')
    expect(grid).toContain('overflow-y: auto')
    expect(grid).toContain('min-height: 0')
    expect(grid).toContain('overscroll-behavior: contain')
  })
})

describe('blank picker dialog keyboard contract (issue #90)', () => {
  it('Escape cancels a pre-place blank without touching the rack', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    expect(host.hidden).toBe(false)
    const { prevented } = host.keydown(host.first, 'Escape')
    expect(prevented).toBe(true)
    expect(uiStore.getState().blankPending).toBeNull()
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(3)
  })

  it('Escape on a reopened blank returns the tile via pendingId', () => {
    gameStore.getState().setRack(['?', 'A', 'B'])
    expect(gameStore.getState().placeTile(0, 'H8')).toBe(true)
    const id = gameStore.getState().pending[0]?.id as number
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: -1, sq: 'H8', pendingId: id })
    const { prevented } = host.keydown(host.first, 'Escape')
    expect(prevented).toBe(true)
    expect(uiStore.getState().blankPending).toBeNull()
    expect(gameStore.getState().pending).toHaveLength(0)
    expect(gameStore.getState().rack).toHaveLength(3)
  })

  it('Tab on the last button wraps to the first', () => {
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    const { prevented } = host.keydown(host.last, 'Tab')
    expect(prevented).toBe(true)
    expect(host.first.focused).toBe(true)
  })

  it('Shift+Tab on the first button wraps to the last', () => {
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    const { prevented } = host.keydown(host.first, 'Tab', true)
    expect(prevented).toBe(true)
    expect(host.last.focused).toBe(true)
  })

  it('Tab elsewhere in the sheet does not steal focus', () => {
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    // Autofocus lands on A at open; clear it so the Tab itself is observed.
    for (const button of host.buttons) button.focused = false
    const middle = host.buttons[13] as FakeButton
    const { prevented } = host.keydown(middle, 'Tab')
    expect(prevented).toBe(false)
    expect(host.first.focused).toBe(false)
    expect(host.last.focused).toBe(false)
  })

  it('opening the picker autofocuses the A button', () => {
    const host = mount()
    expect(host.buttonA.focused).toBe(false)
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    expect(host.buttonA.focused).toBe(true)
  })

  it('repainting while open does not refocus A', () => {
    const host = mount()
    uiStore.getState().openBlankPicker({ rackIndex: 0, sq: 'H8' })
    expect(host.buttonA.focused).toBe(true)
    host.buttonA.focused = false
    // A no-op store touch repaints while staying open.
    uiStore.getState().selectRack(null)
    expect(host.buttonA.focused).toBe(false)
  })
})

describe('blank picker markup contract', () => {
  it('renders exactly 26 letter buttons plus one cancel', () => {
    const html = buildBlankPickerHTML()
    expect(count(/data-letter="[A-Z]"/g, html)).toBe(26)
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(html).toContain(`data-letter="${letter}"`)
    }
    expect(count(/data-action="cancel-picker"/g, html)).toBe(1)
    expect(html).toContain('Cancel')
  })

  it('keeps the dialog role and modal announcement', () => {
    const html = buildBlankPickerHTML()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
  })
})
