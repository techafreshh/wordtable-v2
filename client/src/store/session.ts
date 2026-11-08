// Hot-seat session store (issue #10) — wraps the proven LocalGame facade
// so Start → Setup → Lobby → Table → Recap runs fully offline. Turns,
// endings, scoring and rematch live in the engine; this module owns the
// seat lineup, the bot flags, an allow-listed lexicon and the bot
// auto-pass timer. Vanilla zustand like store/ui.ts. LocalGame mutates in
// place, so every intent bumps `version` to notify subscribers.

import { createStore } from 'zustand/vanilla'
import {
  LocalGame,
  type IntentResult,
  type LocalEvent,
  type LocalSnapshot,
  type PlaceSpec,
} from '../../../shared/engine/local'
import { GameStatus } from '../../../shared/engine/game'
import { generateBotMove } from '../../../shared/engine/bot'
import { isLegalWord } from './lexicon'

// Bot seats think with the same greedy generator as the server: once the
// turn reaches a bot seat it commits the generator move (or passes when the
// generator passes) after BOT_PASS_MS, cancellable on rematch/session
// replacement so the table never stalls waiting on a bot.
export const BOT_PASS_MS = 700
export const MIN_SEATS = 2
export const MAX_SEATS = 4
export const MAX_NAME_LEN = 16

export const DEFAULT_SESSION_NAMES: readonly string[] = [
  'Player 1',
  'Player 2',
  'Player 3',
  'Player 4',
]

export interface WordHistoryEntry {
  seat: number
  words: string[]
  points: number
}

// Lexicon (issue #45, see ./lexicon): the full SOWPODS list ships as a
// static asset after boot; the generator and validation share isLegalWord
// (fallback until the fetch resolves) so offline bots place immediately.

function cleanName(raw: string, fallback: string): string {
  const name = String(raw ?? '')
    .trim()
    .slice(0, MAX_NAME_LEN)
  return name === '' ? fallback : name
}

interface SessionState {
  names: string[]
  isBot: boolean[]
  version: number
  startSession: (names: string[], bots: boolean[], seed?: number) => void
  passTurn: () => void
  placeMove: (specs: PlaceSpec[]) => IntentResult
  rematch: () => void
  snapshot: () => LocalSnapshot | null
  wordHistory: () => WordHistoryEntry[]
}

let game: LocalGame | null = null
let botTimer: ReturnType<typeof setTimeout> | null = null
let sessionSeed = 1

function disarmBotTimer(): void {
  if (botTimer !== null) {
    clearTimeout(botTimer)
    botTimer = null
  }
}

function runOfflineBotMove(): void {
  botTimer = null
  if (game === null) return
  const snap = game.getState()
  if (snap.status !== GameStatus.PLAYING) return
  const flags = sessionStore.getState().isBot
  if (!flags[snap.turn]) return
  const turn = snap.turn
  try {
    const move = generateBotMove(snap.board, snap.racks[turn], isLegalWord, {
      seed: sessionSeed,
    })
    if ('pass' in move) {
      game.pass(turn)
    } else {
      const specs = move.placements.map((p) => {
        const square = { row: p.row, col: p.col }
        if (p.tile.isBlank) {
          const asLetter = (p.tile.blankAs ?? '').trim().toUpperCase()
          return { square, face: '?', as: /^[A-Z]$/.test(asLetter) ? asLetter : 'A' }
        }
        return { square, face: p.tile.face }
      })
      const res = game.place(turn, specs)
      if (!res.ok) game.pass(turn)
    }
  } catch {
    try {
      game.pass(turn)
    } catch {
      // no session to advance; ignore
    }
  }
  sessionStore.setState((s) => ({ version: s.version + 1 }))
  armBotTimer()
}

function armBotTimer(): void {
  disarmBotTimer()
  const state = sessionStore.getState()
  const snap = state.snapshot()
  if (snap === null || snap.status !== GameStatus.PLAYING) return
  if (!state.isBot[snap.turn]) return
  botTimer = setTimeout(runOfflineBotMove, BOT_PASS_MS)
}

export const sessionStore = createStore<SessionState>()((set, get) => ({
  names: [],
  isBot: [],
  version: 0,
  // Seat count clamps to 2-4 (the LocalGame constructor contract), names
  // trim and cap at 16 chars with Player-N defaults, and seat 0 is always
  // human even if the caller flags it as a bot.
  startSession: (names, bots, seed = 1) => {
    disarmBotTimer()
    sessionSeed = seed
    const count = Math.min(MAX_SEATS, Math.max(MIN_SEATS, names.length))
    const clean = Array.from({ length: count }, (_, i) =>
      cleanName(
        names[i] ?? '',
        DEFAULT_SESSION_NAMES[i] ?? `Player ${i + 1}`,
      ),
    )
    const flags = Array.from({ length: count }, (_, i) =>
      i === 0 ? false : Boolean(bots[i]),
    )
    game = new LocalGame(clean, seed, isLegalWord)
    set({ names: clean, isBot: flags, version: get().version + 1 })
    armBotTimer()
  },
  // Commit path for the session table (issue #85): the engine validates
  // and scores the current turn seat's placement. Human-only gating lives
  // in the caller (the table ignores bot-turn input); a no-op session
  // refuses with BAD_STATE so stray calls before setup never throw.
  placeMove: (specs) => {
    if (game === null) return { ok: false, reason: 'BAD_STATE' }
    const result = game.place(game.getState().turn, specs)
    if (result.ok) {
      set({ version: get().version + 1 })
      armBotTimer()
    }
    return result
  },
  // Pass for whichever seat holds the turn; a no-op without a session so
  // stray hook calls before setup never throw.
  passTurn: () => {
    if (game === null) return
    game.pass(game.getState().turn)
    set({ version: get().version + 1 })
    armBotTimer()
  },
  // Same seats, fresh bag: LocalGame.rematch keeps the lineup and seed
  // while clearing the board, scores and scoreless streak.
  rematch: () => {
    if (game === null) return
    disarmBotTimer()
    game.rematch()
    set({ version: get().version + 1 })
    armBotTimer()
  },
  snapshot: () => (game === null ? null : game.getState()),
  // Recap history: placed events only, in play order.
  wordHistory: () => {
    if (game === null) return []
    return game.history
      .filter((e: LocalEvent) => e.type === 'placed')
      .map((e) => ({
        seat: e.seat,
        words: [...(e.words ?? [])],
        points: e.points ?? 0,
      }))
  },
}))

// Test seam: drop the session (and its timer) without going through
// LocalGame.rematch, so store suites start from a known empty state.
export function resetSessionForTests(): void {
  disarmBotTimer()
  game = null
  sessionStore.setState({ names: [], isBot: [], version: 0 })
}
