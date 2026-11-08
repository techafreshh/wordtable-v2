// Screens and offline hot-seat loop (issue #10): route parsing, seat
// picker collection/clamping, strip/podium builder counts, the six-pass
// ending plus rematch through the real LocalGame, bot auto-pass timing
// and the both-paths screens.css markers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRoute, navigate } from '../../client/src/router'
import {
  buildStartScreenHTML,
  persistNickname,
  NICKNAME_KEY,
} from '../../client/src/components/StartScreen'
import { buildSetupHTML, collectSetup } from '../../client/src/components/Setup'
import { buildLobbyHTML } from '../../client/src/components/Lobby'
import {
  buildTableBoardHTML,
  buildHotSeatTableHTML,
  sessionAllowsPlacement,
  syncGameFromSession,
} from '../../client/src/components/HotSeatTable'
import { buildRecapHTML } from '../../client/src/components/Recap'
import {
  sessionStore,
  resetSessionForTests,
  BOT_PASS_MS,
} from '../../client/src/store/session'
import { GameStatus, GameEndReason } from '../../shared/engine/game'
import { LocalGame } from '../../shared/engine/local'

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

// Minimal form stub: collectSetup only walks querySelectorAll('.seat')
// plus per-row .seat-name/.seat-bot lookups, so plain objects suffice.
function fakeForm(rows: { name: string; bot: boolean }[]): HTMLFormElement {
  const seats = rows.map((r) => ({
    querySelector: (sel: string): { value: string; checked: boolean } | null => {
      if (sel.includes('seat-name')) return { value: r.name, checked: false }
      if (sel.includes('seat-bot')) return { value: '', checked: r.bot }
      return null
    },
  }))
  return {
    querySelectorAll: (sel: string): unknown[] =>
      sel === '.seat' ? seats : [],
  } as unknown as HTMLFormElement
}

beforeEach(() => {
  stubLocalStorage()
  resetSessionForTests()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetSessionForTests()
})

describe('router', () => {
  it('parses all five hashes', () => {
    expect(parseRoute('')).toBe('start')
    expect(parseRoute('#/')).toBe('start')
    expect(parseRoute('#/setup')).toBe('setup')
    expect(parseRoute('#/lobby')).toBe('lobby')
    expect(parseRoute('#/table')).toBe('table')
    expect(parseRoute('#/recap')).toBe('recap')
  })

  it('falls back to start for unknown hashes', () => {
    expect(parseRoute('#/nope')).toBe('start')
    expect(parseRoute('#/table/extra')).toBe('table')
  })

  it('navigate sets the table hash', () => {
    const location = { hash: '' }
    const listeners: Record<string, () => void> = {}
    ;(globalThis as Record<string, unknown>).window = {
      location,
      addEventListener: (type: string, fn: () => void): void => {
        listeners[type] = fn
      },
      removeEventListener: (type: string): void => {
        delete listeners[type]
      },
    }
    navigate('table')
    expect(location.hash).toBe('#/table')
    delete (globalThis as Record<string, unknown>).window
  })
})

describe('Start screen builder', () => {
  it('renders #nickname and all three data-action buttons', () => {
    const html = buildStartScreenHTML('')
    expect(html).toContain('id="nickname"')
    expect(html).toContain('maxlength="16"')
    expect(count(/data-action="/g, html)).toBe(3)
    expect(html).toContain('data-action="create"')
    expect(html).toContain('data-action="join"')
    expect(html).toContain('data-action="play"')
    expect(html).toContain('Play now')
  })

  it('persists the trimmed nickname under wordtable.nickname', () => {
    expect(persistNickname('  Ann  ')).toBe('Ann')
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('Ann')
    expect(buildStartScreenHTML('Ann')).toContain('value="Ann"')
  })
})

describe('seat picker', () => {
  it('renders exactly N .seat rows for counts 2/3/4', () => {
    for (const n of [2, 3, 4]) {
      const html = buildSetupHTML(n)
      expect(html).toContain('id="seat-picker"')
      expect(count(/class="seat[ "]/g, html)).toBe(n)
      expect(html).toContain('id="start-game"')
    }
  })

  it('tags rows with data-seat indices and disables row 0 bot box', () => {
    const html = buildSetupHTML(3)
    for (const i of [0, 1, 2]) {
      expect(html).toContain(`data-seat="${i}"`)
    }
    expect(count(/class="seat-bot"/g, html)).toBe(3)
    expect(count(/disabled/g, html)).toBe(1)
    expect(count(/data-count="/g, html)).toBe(3)
  })

  it('collectSetup clamps empty names to defaults and trims to 16 chars', () => {
    const { names, bots } = collectSetup(
      fakeForm([
        { name: '  Ann  ', bot: true },
        { name: '', bot: true },
      ]),
    )
    expect(names).toEqual(['Ann', 'Player 2'])
    // Row 0 is always human even when its box reads checked.
    expect(bots).toEqual([false, true])
  })

  it('collectSetup trims overlong names to 16 chars', () => {
    const { names } = collectSetup(
      fakeForm([
        { name: '0123456789abcdefGHI', bot: false },
        { name: 'Bo', bot: false },
      ]),
    )
    expect(names[0]).toBe('0123456789abcdef')
    expect(names[0]).toHaveLength(16)
  })
})

describe('lobby builder', () => {
  it('renders one .seat plaque per name with a bot badge and both buttons', () => {
    const html = buildLobbyHTML(['Ann', 'Bo'], [false, true])
    expect(html).toContain('id="lobby"')
    expect(count(/class="seat[ "]/g, html)).toBe(2)
    expect(count(/bot-badge/g, html)).toBe(1)
    expect(html).toContain('id="lobby-start"')
    expect(html).toContain('id="lobby-edit"')
  })
})

describe('hot-seat table builder', () => {
  it('promotes tiles to .tile.committed', () => {
    const html = buildTableBoardHTML({ H8: 'A' })
    expect(count(/class="tile committed"/g, html)).toBe(1)
    expect(html).not.toContain('tile pending')
  })

  it('renders an empty board with zero committed tiles', () => {
    expect(count(/tile committed/g, buildTableBoardHTML())).toBe(0)
  })

  it('renders a two-seat strip and a 0 - 0 score line', () => {
    const snap = new LocalGame(['Ann', 'Bo']).getState()
    const html = buildHotSeatTableHTML(snap)
    expect(count(/class="seat[ "]/g, html)).toBe(2)
    expect(html).toContain('id="score-line"')
    expect(html).toContain('>0 - 0<')
    expect(html).toContain('id="pass-button"')
  })

  it('renders the session placement skeleton around the strip', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false])
    syncGameFromSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap).not.toBeNull()
    if (snap === null) return
    const html = buildHotSeatTableHTML(snap)
    expect(html).toContain('class="screen screen-table"')
    expect(count(/class="seat[ "]/g, html)).toBe(2)
    expect(html).toContain('id="score-line"')
    expect(html).toContain('>0 - 0<')
    expect(html).toContain('id="turn-line"')
    expect(count(/class="sq /g, html)).toBe(225)
    expect(html).toContain('id="prov-score"')
    expect(html).toContain('role="status"')
    expect(html).toContain('>0 pts<')
    expect(html).toContain('id="rack"')
    expect(html).toContain('role="listbox"')
    expect(count(/data-rack-index="/g, html)).toBe(7)
    expect(html).toContain('id="rack-actions"')
    expect(html).toContain('data-action="recall"')
    expect(html).toContain('data-action="shuffle"')
    expect(html).toContain('id="commit-button"')
    expect(html).toContain('data-action="play"')
    expect(html).toContain('id="pass-button"')
    expect(html).toContain('id="float-layer"')
    expect(html).toContain('id="blank-picker"')
    expect(count(/data-letter="/g, html)).toBe(26)
    expect(sessionAllowsPlacement()).toBe(true)
  })

  it('marks the rack inert on a bot-seat turn', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true])
    sessionStore.getState().passTurn()
    syncGameFromSession()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.turn).toBe(1)
    expect(sessionAllowsPlacement()).toBe(false)
    if (snap === null) return
    expect(buildHotSeatTableHTML(snap)).toContain('aria-disabled="true"')
  })
})

describe('recap builder', () => {
  it('renders a two-row podium, history node and rematch', () => {
    const game = new LocalGame(['Ann', 'Bo'])
    for (let i = 0; i < 6; i++) game.pass(game.getState().turn)
    const snap = game.getState()
    expect(snap.status).toBe(GameStatus.ENDED)
    const html = buildRecapHTML(snap, [])
    expect(count(/class="podium-row/g, html)).toBe(2)
    expect(html).toContain('id="word-history"')
    expect(html).toContain('class="history-empty"')
    expect(html).toContain('id="rematch"')
    expect(html).toContain('Rematch')
  })

  it('sorts the winner first', () => {
    const snap = new LocalGame(['Ann', 'Bo']).getState()
    const scored = { ...snap, names: ['Ann', 'Bo'], scores: [4, 10] }
    const html = buildRecapHTML(scored, [])
    const order = [...html.matchAll(/data-seat="(\d)"/g)].map((m) => m[1])
    expect(order[0]).toBe('1')
    expect(html).toContain('class="podium-row winner" data-seat="1"')
  })
})

describe('session store over LocalGame', () => {
  it('starts a 2-seat PLAYING session', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false])
    const snap = sessionStore.getState().snapshot()
    expect(snap?.names).toEqual(['Ann', 'Bo'])
    expect(snap?.status).toBe(GameStatus.PLAYING)
    expect(sessionStore.getState().wordHistory()).toEqual([])
  })

  it('reaches ENDED/SIX_SCORELESS after six passTurn calls', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false])
    for (let i = 0; i < 6; i++) sessionStore.getState().passTurn()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.status).toBe(GameStatus.ENDED)
    expect(snap?.endReason).toBe(GameEndReason.SIX_SCORELESS)
  })

  it('rematch returns scores [0,0] with an empty board grid', () => {
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false])
    for (let i = 0; i < 6; i++) sessionStore.getState().passTurn()
    sessionStore.getState().rematch()
    const snap = sessionStore.getState().snapshot()
    expect(snap?.status).toBe(GameStatus.PLAYING)
    expect(snap?.scores).toEqual([0, 0])
    expect(
      snap?.board.flat().every((cell) => cell === null),
    ).toBe(true)
  })

  it('auto-passes a bot seat after 700 ms', () => {
    vi.useFakeTimers()
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true])
    expect(sessionStore.getState().snapshot()?.turn).toBe(0)
    sessionStore.getState().passTurn()
    expect(sessionStore.getState().snapshot()?.turn).toBe(1)
    vi.advanceTimersByTime(BOT_PASS_MS)
    expect(sessionStore.getState().snapshot()?.turn).toBe(0)
  })

  it('greedy bot commits a scoring placement instead of a bare pass', () => {
    vi.useFakeTimers()
    // Seed 3 gives the bot a WE hook with the fallback lexicon.
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true], 3)
    expect(sessionStore.getState().snapshot()?.turn).toBe(0)
    sessionStore.getState().passTurn()
    expect(sessionStore.getState().snapshot()?.turn).toBe(1)
    vi.advanceTimersByTime(BOT_PASS_MS)
    const snap = sessionStore.getState().snapshot()
    expect(snap?.turn).toBe(0)
    const boardHasTiles = snap?.board.flat().some((cell) => cell !== null) ?? false
    const history = sessionStore.getState().wordHistory()
    // Either a placement scored (board non-empty, history grew, or scores moved).
    expect(boardHasTiles || history.length > 0 || (snap?.scores[1] ?? 0) > 0).toBe(true)
  })

  it('rematch disarms a pending bot pass', () => {
    vi.useFakeTimers()
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, true])
    sessionStore.getState().passTurn()
    expect(sessionStore.getState().snapshot()?.turn).toBe(1)
    sessionStore.getState().rematch()
    vi.advanceTimersByTime(BOT_PASS_MS)
    expect(sessionStore.getState().snapshot()?.turn).toBe(0)
  })
})

describe('screen stylesheets', () => {
  it('ships screens.css on both style paths with the screen markers', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const screens = css(dir, 'screens.css')
      for (const marker of [
        '.seat',
        '.podium',
        '#word-history',
        '#pass-button',
        '#rematch',
        '#score-line',
        '.screen',
        'var(--brass)',
        'var(--ivory)',
        'min-height: 44px',
      ]) {
        expect(screens).toContain(marker)
      }
    }
  })

  it('tightens the layout at 480px', () => {
    const screens = css(CLIENT_STYLES, 'screens.css')
    expect(screens).toContain('max-width: 480px')
  })

  it('ships the session placement layout on both style paths', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const screens = css(dir, 'screens.css')
      for (const marker of [
        '.screen-table',
        '#prov-score',
        '#rack',
        '#rack-actions',
        '#commit-button',
        '#float-layer',
        '#float-score',
        '#blank-picker',
      ]) {
        expect(screens).toContain(marker)
      }
    }
  })
})
