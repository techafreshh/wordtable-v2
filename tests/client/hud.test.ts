// HUD chrome tests (issue #9): player strip with active glow and timer
// ring, chat bubble/panel with emotes, and the persisted sound toggle.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPlayerStripHTML } from '../../client/src/components/PlayerStrip'
import { buildChatBubbleHTML } from '../../client/src/components/ChatBubble'
import {
  buildChatPanelHTML,
  EMOTES,
} from '../../client/src/components/ChatPanel'
import { buildSoundToggleHTML } from '../../client/src/components/SoundToggle'
import { isSoundOn, setSoundOn } from '../../client/src/audio/bank'
import { isSoundEnabled, setSoundEnabled } from '../../client/src/audio/sounds'
import { uiStore } from '../../client/src/store/ui'

const CLIENT_STYLES = new URL('../../client/styles/', import.meta.url)
const SRC_STYLES = new URL('../../client/src/styles/', import.meta.url)

function css(dir: URL, name: string): string {
  return readFileSync(new URL(name, dir), 'utf8')
}

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  const api = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, String(value))
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

beforeEach(() => {
  stubLocalStorage()
  uiStore.getState().resetTable()
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
  setSoundOn(true)
})

describe('Player strip builder', () => {
  it('yields N .seats with exactly one .active at index 1 for 3 seats', () => {
    const html = buildPlayerStripHTML(['You', 'Rival 1', 'Rival 2'], [0, 0, 0], 1)
    expect(html).toContain('id="player-strip"')
    expect(count(/class="seat[ "]/g, html)).toBe(3)
    expect(count(/data-seat="/g, html)).toBe(3)
    expect(count(/seat active/g, html)).toBe(1)
    expect(html).toContain('class="seat active" data-seat="1"')
  })

  it('renders the #timer-ring inside the active seat only', () => {
    const html = buildPlayerStripHTML(['You', 'Rival 1', 'Rival 2'], [0, 0, 0], 1)
    expect(html).toContain('id="timer-ring"')
    expect(count(/id="timer-ring"/g, html)).toBe(1)
    expect(html).toContain('stroke-dashoffset')
  })

  it('renders seat names and scores', () => {
    const html = buildPlayerStripHTML(['You', 'Rival 1'], [10, 4], 0)
    expect(html).toContain('You')
    expect(html).toContain('Rival 1')
    expect(html).toContain('>10<')
    expect(html).toContain('>4<')
    expect(count(/seat-score/g, html)).toBe(2)
  })

  it('store setTurn moves .active to the new seat', () => {
    uiStore.getState().setSeats(['You', 'Rival 1', 'Rival 2'])
    uiStore.getState().setTurn(1)
    let html = buildPlayerStripHTML(
      uiStore.getState().seats,
      uiStore.getState().scores,
      uiStore.getState().turn,
    )
    expect(html).toContain('class="seat active" data-seat="1"')
    uiStore.getState().setTurn(2)
    html = buildPlayerStripHTML(
      uiStore.getState().seats,
      uiStore.getState().scores,
      uiStore.getState().turn,
    )
    expect(html).toContain('class="seat active" data-seat="2"')
    expect(count(/seat active/g, html)).toBe(1)
  })
})

describe('Chat bubble and panel', () => {
  it('uses exactly the 👏 😂 👍 emote trio in order', () => {
    expect(EMOTES).toEqual(['👏', '😂', '👍'])
    const html = buildChatPanelHTML([], true)
    expect(count(/data-emote="/g, html)).toBe(3)
    const order = [...html.matchAll(/data-emote="([^"]*)"/g)].map((m) => m[1])
    expect(order).toEqual(['👏', '😂', '👍'])
  })

  it('emote 👏 sent via the store appears in the panel #chat-log', () => {
    uiStore.getState().setSeats(['You', 'Rival 1', 'Rival 2'])
    expect(uiStore.getState().sendChat('👏')).toBe(true)
    const html = buildChatPanelHTML(uiStore.getState().chat, true)
    expect(html).toContain('id="chat-log"')
    expect(html).toContain('👏')
    expect(count(/class="chat-msg"/g, html)).toBe(1)
    expect(html).toContain('data-from="You"')
  })

  it('blank text sends nothing', () => {
    expect(uiStore.getState().sendChat('   ')).toBe(false)
    expect(uiStore.getState().chat).toHaveLength(0)
    const html = buildChatPanelHTML(uiStore.getState().chat, true)
    expect(count(/class="chat-msg"/g, html)).toBe(0)
  })

  it('250-char input truncates to 200', () => {
    expect(uiStore.getState().sendChat('x'.repeat(250))).toBe(true)
    expect(uiStore.getState().chat[0]?.text).toHaveLength(200)
  })

  it('sendChat never splits a surrogate pair on an emoji run', () => {
    expect(uiStore.getState().sendChat('😀'.repeat(250))).toBe(true)
    const text = uiStore.getState().chat[0]?.text ?? ''
    expect(Array.from(text)).toHaveLength(200)
    expect(text).toBe('😀'.repeat(200))
  })

  it('receiveChat truncates emoji runs without lone surrogates and bumps the badge', () => {
    expect(uiStore.getState().receiveChat('Rival 1', '😀'.repeat(250))).toBe(true)
    const text = uiStore.getState().chat[0]?.text ?? ''
    expect(Array.from(text)).toHaveLength(200)
    expect(text).toBe('😀'.repeat(200))
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expect(uiStore.getState().unread).toBe(1)
  })

  it('receiveChat while closed bumps the badge; opening clears it', () => {
    expect(uiStore.getState().receiveChat('Rival 1', 'hi')).toBe(true)
    expect(uiStore.getState().unread).toBe(1)
    let bubble = buildChatBubbleHTML(
      uiStore.getState().unread,
      uiStore.getState().chatOpen,
    )
    expect(bubble).toContain('id="chat-bubble"')
    expect(bubble).toContain('unread-badge')
    expect(bubble).toContain('>1<')
    uiStore.getState().toggleChat()
    expect(uiStore.getState().chatOpen).toBe(true)
    expect(uiStore.getState().unread).toBe(0)
    bubble = buildChatBubbleHTML(
      uiStore.getState().unread,
      uiStore.getState().chatOpen,
    )
    expect(bubble).toContain('hidden')
  })
})

describe('Sound bank and toggle', () => {
  it('round-trips localStorage wordtable.sound On→Off', () => {
    setSoundOn(true)
    expect(localStorage.getItem('wordtable.sound')).toBe('On')
    expect(isSoundOn()).toBe(true)
    setSoundOn(false)
    expect(localStorage.getItem('wordtable.sound')).toBe('Off')
    expect(isSoundOn()).toBe(false)
  })

  it('toggle label reads exactly Sound: On / Sound: Off', () => {
    expect(buildSoundToggleHTML(true)).toContain('Sound: On')
    expect(buildSoundToggleHTML(false)).toContain('Sound: Off')
    setSoundOn(false)
    expect(buildSoundToggleHTML(isSoundOn())).toContain('id="sound-toggle"')
    expect(buildSoundToggleHTML(isSoundOn())).toContain('Sound: Off')
  })

  it('the legacy shim delegates without diverging keys', () => {
    setSoundEnabled(false)
    expect(isSoundEnabled()).toBe(false)
    expect(localStorage.getItem('wordtable.sound')).toBe('Off')
    setSoundEnabled(true)
    expect(isSoundEnabled()).toBe(true)
    expect(localStorage.getItem('wordtable.sound')).toBe('On')
  })
})

describe('HUD stylesheets', () => {
  it('ships hud.css on both style paths with the chrome markers', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const hud = css(dir, 'hud.css')
      for (const marker of [
        '#player-strip',
        '.seat',
        '.seat.active',
        '#timer-ring',
        '#chat-bubble',
        '.unread-badge',
        '#chat-panel',
        '#chat-log',
        '.emote-row',
        '#sound-toggle',
      ]) {
        expect(hud).toContain(marker)
      }
    }
  })

  it('keeps the active glow brass without new keyframes', () => {
    const hud = css(CLIENT_STYLES, 'hud.css')
    expect(hud).toContain('box-shadow')
    expect(hud).toContain('--brass')
    expect(hud).not.toContain('@keyframes')
  })
})
