// Exchange proofs (issue #89): the shared exchange surface over the
// session/net stores. Headless by design like session-table.test.ts:
// every proof runs through the stores (sessionStore + gameStore +
// uiStore + netStore) with no DOM, exactly like scripted black-box probes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildExchangeHTML,
  offlineExchangeBlocked,
  onlineExchangeBlocked,
} from '../../client/src/components/Exchange'
import {
  buildHotSeatTableHTML,
  syncGameFromSession,
} from '../../client/src/components/HotSeatTable'
import { buildOnlineTableHTML } from '../../client/src/components/OnlineTable'
import { buildRackTilesHTML } from '../../client/src/components/Rack'
import { gameStore } from '../../client/src/store/game'
import { uiStore } from '../../client/src/store/ui'
import {
  sessionStore,
  resetSessionForTests,
} from '../../client/src/store/session'
import {
  handleFrame,
  net,
  netStore,
  resetNetForTests,
} from '../../client/src/store/net'
import { toAlgebra } from '../../shared/engine/board'

// Permissive lexicon for the bag-draining gate test: the scripted snake
// of single-tile commits forms arbitrary long row-words no finite list
// could enumerate. (The real SOWPODS list is covered by the engine and
// lexicon suites; exchange itself never consults the lexicon.)
vi.mock('../../client/src/store/lexicon', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../client/src/store/lexicon')>()
  return { ...actual, isLegalWord: () => true }
})

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

type Handler = (ev: unknown) => void

// Minimal FakeSocket mirroring tests/client/net.test.ts: records sends so
// the test can drive open/message exactly like the wire would.
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

  send(data: string): void {
    this.sent.push(String(data))
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    const cbs = this.handlers.get('close') ?? []
    for (const fn of cbs) fn({})
  }

  open(): void {
    this.readyState = 1
    const cbs = this.handlers.get('open') ?? []
    for (const fn of cbs) fn({})
  }

  receive(frame: unknown): void {
    const cbs = this.handlers.get('message') ?? []
    for (const fn of cbs) fn({ data: JSON.stringify(frame) })
  }
}

function lastSocket(): FakeSocket {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1]
  if (!sock) throw new Error('no socket dialled')
  return sock
}

function stubSockets(): void {
  ;(globalThis as Record<string, unknown>).WebSocket =
    FakeSocket as unknown as typeof WebSocket
}

// Seed 5 deals seat 0 `AWDTACN`; sync installs the turn-seat rack.
function startHumanSeed5(): void {
  sessionStore.getState().startSession(['Ann', 'Bo'], [false, false], 5)
  syncGameFromSession()
}

// Non-blank faces from the current scratch rack (blanks ride as '?').
function scratchFaces(n: number): string[] {
  const rack = gameStore.getState().rack
  const faces: string[] = []
  for (const tile of rack) {
    if (faces.length >= n) break
    if (!tile.isBlank) faces.push(tile.face)
  }
  expect(faces).toHaveLength(n)
  return faces
}

beforeEach(() => {
  resetSessionForTests()
  resetNetForTests()
  FakeSocket.instances.length = 0
  gameStore.getState().reset()
  gameStore.getState().selectRack(null)
  uiStore.getState().selectRack(null)
  uiStore.getState().clearToast()
  uiStore.getState().closeBlankPicker()
  uiStore.getState().clearExchange()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  uiStore.getState().clearToast()
  uiStore.getState().clearExchange()
  resetSessionForTests()
  resetNetForTests()
})

describe('exchange ui state', () => {
  it('toggles, dedupes, sorts and clears the selection', () => {
    const ui = uiStore.getState()
    // Toggling while closed is a no-op: selection needs the open panel.
    ui.toggleExchangeIndex(2)
    expect(uiStore.getState().exchangeSelected).toEqual([])
    ui.setExchangeOpen(true)
    uiStore.getState().toggleExchangeIndex(2)
    uiStore.getState().toggleExchangeIndex(0)
    uiStore.getState().toggleExchangeIndex(2)
    // 2 added, 0 added, 2 removed → [0], sorted.
    expect(uiStore.getState().exchangeSelected).toEqual([0])
    // Bad indices never enter the selection.
    uiStore.getState().toggleExchangeIndex(-1)
    uiStore.getState().toggleExchangeIndex(1.5)
    expect(uiStore.getState().exchangeSelected).toEqual([0])
    // Closing clears.
    uiStore.getState().setExchangeOpen(false)
    expect(uiStore.getState().exchangeOpen).toBe(false)
    expect(uiStore.getState().exchangeSelected).toEqual([])
    uiStore.getState().setExchangeOpen(true)
    uiStore.getState().toggleExchangeIndex(3)
    uiStore.getState().clearExchange()
    expect(uiStore.getState().exchangeSelected).toEqual([])
  })
})

describe('offline exchange', () => {
  it('happy path: swaps faces, refills to 7 and advances the turn', () => {
    startHumanSeed5()
    const bagBefore = sessionStore.getState().snapshot()?.bagRemaining
    const faces = scratchFaces(2)
    const result = sessionStore.getState().exchangeTiles(faces)
    expect(result.ok).toBe(true)
    const snap = sessionStore.getState().snapshot()
    expect(snap?.turn).toBe(1)
    // Exchange draws as many as it returns, so the bag is unchanged and
    // both racks stay full.
    expect(snap?.bagRemaining).toBe(bagBefore)
    for (const rack of snap?.racks ?? []) expect(rack).toHaveLength(7)
    syncGameFromSession()
    expect(gameStore.getState().rack).toHaveLength(7)
  })

  it('refuses without a session and on unknown tiles with no state change', () => {
    expect(sessionStore.getState().exchangeTiles(['A'])).toEqual({
      ok: false,
      reason: 'BAD_STATE',
    })
    startHumanSeed5()
    const before = sessionStore.getState().snapshot()
    const turn = before?.turn
    const rackFaces = (before?.racks[turn ?? 0] ?? []).map((t) =>
      t.isBlank ? '?' : t.face,
    )
    const result = sessionStore
      .getState()
      .exchangeTiles(['Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('BAD_TILES')
    const after = sessionStore.getState().snapshot()
    expect(after?.turn).toBe(turn)
    expect((after?.racks[turn ?? 0] ?? []).map((t) => (t.isBlank ? '?' : t.face))).toEqual(
      rackFaces,
    )
  })

  it('empty-bag gate: EXCHANGE_GATE with no state change', () => {
    // A scripted snake of single-tile commits drains the bag: the first
    // move covers the star with two tiles, the rest extend row by row
    // with one tile each, drawing exactly one replacement per commit.
    sessionStore.getState().startSession(['Ann', 'Bo'], [false, false], 5)
    syncGameFromSession()
    // First move covers the star with two tiles; the rest snakes row by
    // row, each commit drawing exactly one replacement.
    const squares: string[] = []
    for (let row = 7; row < 15 && squares.length < 90; row++) {
      const cols =
        row % 2 === 1
          ? Array.from({ length: 15 }, (_, k) => k)
          : Array.from({ length: 15 }, (_, k) => 14 - k)
      for (const col of cols) {
        if (row === 7 && col < 7) continue
        squares.push(toAlgebra(row, col))
      }
    }
    let used = 0
    {
      const snap = sessionStore.getState().snapshot()
      expect(snap).not.toBeNull()
      const rack = snap?.racks[snap.turn] ?? []
      const picks = rack
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => !t.isBlank)
        .slice(0, 2)
      expect(picks).toHaveLength(2)
      const res = sessionStore.getState().placeMove(
        picks.map(({ t }, k) => ({
          square: squares[k],
          face: t.face,
        })),
      )
      expect(res.ok).toBe(true)
      used = 2
    }
    let guard = 0
    while (
      (sessionStore.getState().snapshot()?.bagRemaining ?? 0) >= 7 &&
      guard < 150
    ) {
      guard += 1
      const snap = sessionStore.getState().snapshot()
      expect(snap).not.toBeNull()
      const rack = snap?.racks[snap.turn] ?? []
      const pick = rack
        .map((t, i) => ({ t, i }))
        .find(({ t }) => !t.isBlank)
      expect(pick).toBeDefined()
      const res = sessionStore.getState().placeMove([
        { square: squares[used], face: pick?.t.face ?? 'A' },
      ])
      expect(res.ok).toBe(true)
      used += 1
    }
    const drained = sessionStore.getState().snapshot()
    expect(drained?.bagRemaining).toBeLessThan(7)
    const seat = drained?.turn ?? 0
    const rackBefore = (drained?.racks[seat] ?? []).map((t) =>
      t.isBlank ? '?' : t.face,
    )
    const faces = (drained?.racks[seat] ?? [])
      .filter((t) => !t.isBlank)
      .slice(0, 2)
      .map((t) => t.face)
    expect(faces).toHaveLength(2)
    const result = sessionStore.getState().exchangeTiles(faces)
    expect(result).toEqual({ ok: false, reason: 'EXCHANGE_GATE' })
    const after = sessionStore.getState().snapshot()
    expect(after?.turn).toBe(seat)
    expect((after?.racks[seat] ?? []).map((t) => (t.isBlank ? '?' : t.face))).toEqual(
      rackBefore,
    )
    // The builder gates the button and shows the drained bag.
    expect(offlineExchangeBlocked()).toBe('GATE')
    const html = buildHotSeatTableHTML(after!)
    expect(html).toContain('id="exchange-button"')
    expect(html).toContain('id="exchange-button" data-action="exchange" disabled')
    expect(html).toContain(`Bag: ${after?.bagRemaining}`)
    expect(html).toContain('id="exchange-panel" hidden')
  })
})

describe('bag projection', () => {
  it('round-trips bag_remaining and ignores bad values', () => {
    gameStore.getState().applyStateSync({ bag_remaining: 86 })
    expect(gameStore.getState().bagRemaining).toBe(86)
    gameStore.getState().applyStateSync({ bag_remaining: 86.9 })
    expect(gameStore.getState().bagRemaining).toBe(86)
    for (const bad of ['86', NaN, Infinity, null, undefined, {}]) {
      gameStore.getState().applyStateSync({ bag_remaining: bad })
      expect(gameStore.getState().bagRemaining).toBeNull()
    }
    gameStore.getState().resetOnline()
    expect(gameStore.getState().bagRemaining).toBeNull()
  })

  it('state_sync bag_remaining drives the online gate', () => {
    stubSockets()
    const pending = net.connect('ws://localhost:9080')
    const sock = lastSocket()
    sock.open()
    void pending
    netStore.setState({
      code: 'ABCD',
      token: 'token-12345678',
      seat: 0,
      started: true,
    })
    uiStore.getState().setTurn(0)
    handleFrame({
      m: 'state_sync',
      bag_remaining: 3,
      board_tiles: [],
      rack: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      seats_info: [
        { seat: 0, name: 'Ann' },
        { seat: 1, name: 'Bo' },
      ],
      scores: [0, 0],
      turn: 0,
      started: true,
    })
    expect(gameStore.getState().bagRemaining).toBe(3)
    expect(gameStore.getState().rack).toHaveLength(7)
    expect(onlineExchangeBlocked()).toBe('GATE')
    const html = buildOnlineTableHTML()
    expect(html).toContain('Bag: 3')
    expect(html).toContain('id="exchange-button" data-action="exchange" disabled')
  })
})

describe('online exchange intent', () => {
  it('sends the picked faces as tiles', async () => {
    stubSockets()
    const pending = net.connect('ws://localhost:9080')
    const sock = lastSocket()
    sock.open()
    await expect(pending).resolves.toEqual({ ok: true })
    netStore.setState({
      code: 'ABCD',
      token: 'token-12345678',
      seat: 0,
      started: true,
    })
    const reply = net.exchange(['A', 'B'])
    sock.receive({ m: 'exchange', ok: true, accepted: true })
    await expect(reply).resolves.toMatchObject({ ok: true })
    expect(JSON.parse(sock.sent[0] ?? '{}')).toMatchObject({
      v: 1,
      m: 'exchange',
      tiles: ['A', 'B'],
    })
  })
})

describe('exchange markup', () => {
  it('builder renders the bag line, panel and confirm count', () => {
    const closed = buildExchangeHTML(null, 0, false, false)
    expect(closed).toContain('id="exchange-button"')
    expect(closed).toContain('Bag: —')
    expect(closed).toContain('id="exchange-panel" hidden')
    expect(closed).toContain('id="exchange-confirm" disabled')
    expect(closed).toContain('Exchange 0')
    expect(closed).toContain('id="exchange-cancel"')
    const open = buildExchangeHTML(86, 2, false, true)
    expect(open).toContain('Bag: 86')
    expect(open).toContain('id="exchange-panel"')
    expect(open).not.toContain('hidden')
    expect(open).toContain('Exchange 2')
    const gated = buildExchangeHTML(6, 0, true, false)
    expect(gated).toContain('id="exchange-button" data-action="exchange" disabled')
  })

  it('hot-seat skeleton carries the exchange surface', () => {
    startHumanSeed5()
    const snap = sessionStore.getState().snapshot()
    expect(snap).not.toBeNull()
    const html = buildHotSeatTableHTML(snap!)
    expect(html).toContain('id="exchange-button"')
    expect(html).toContain('id="exchange-panel"')
    expect(html).toContain('id="bag-remaining"')
    expect(html).toContain('id="exchange-confirm"')
    expect(html).toContain(`Bag: ${snap?.bagRemaining}`)
  })

  it('online skeleton carries the exchange surface', () => {
    gameStore.getState().applyStateSync({
      bag_remaining: 86,
      board_tiles: [],
      rack: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    })
    netStore.setState({ seat: 0, started: true })
    uiStore.getState().setTurn(0)
    const html = buildOnlineTableHTML()
    expect(html).toContain('id="exchange-button"')
    expect(html).toContain('id="exchange-confirm"')
    expect(html).toContain('id="bag-remaining"')
    expect(html).toContain('Bag: 86')
    // Turn seat with a full bag: the button reads enabled.
    expect(html).toContain('id="exchange-button" data-action="exchange">Exchange<')
  })

  it('rack marks exactly the picked tiles while open', () => {
    startHumanSeed5()
    const rack = gameStore.getState().rack
    uiStore.getState().setExchangeOpen(true)
    uiStore.getState().toggleExchangeIndex(0)
    uiStore.getState().toggleExchangeIndex(2)
    const html = buildRackTilesHTML(rack, null)
    expect(count(/exchange-selected/g, html)).toBe(2)
    expect(count(/aria-selected="true"/g, html)).toBe(2)
    // Closed: no trace of the highlight.
    uiStore.getState().clearExchange()
    expect(buildRackTilesHTML(rack, null)).not.toContain('exchange-selected')
  })
})
