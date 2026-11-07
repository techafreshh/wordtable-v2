// Server-game binding — each room owns one LocalGame plus its turn clock.
// Personalized fan-out only: viewFor builds a per-seat snapshot carrying
// only that seat's rack plus a `you` marker; get_rack replies never broadcast.
import { LocalGame, type PlaceSpec } from '../../shared/engine/local.js'
import type { Lexicon } from '../../shared/engine/rules.js'
import { parseSquare, toAlgebra } from '../../shared/engine/board.js'
import type { Tile } from '../../shared/engine/bag.js'
import { generateBotMove } from '../../shared/engine/bot.js'
import { truncateChatText } from '../../shared/engine/chat-text.js'
import { BOT_NAME, botThinkDelayMs } from './bot-seat.js'
import {
  RoomRegistry,
  normalizeCode,
  normalizeName,
  normalizeToken,
} from './rooms.js'
import {
  TurnTimer,
  clampTurnSecs,
  DEFAULT_TURN_SECS,
  STALL_GUARD_SECS,
} from './timers.js'

export type RoomReply = Record<string, unknown>
export type BindingSend = (seat: number, frame: RoomReply) => void

export interface CreateBindingOpts {
  isWord: Lexicon
  allowDebug?: boolean
  send?: BindingSend
}

export interface RoomEntry {
  game: LocalGame
  timerOn: boolean
  turnSecs: number
  timer: TurnTimer
  seed: number
  botTimer: ReturnType<typeof setTimeout> | null
}

// Case-insensitive lookup after trim: `CODE`, `Room_Code`, `METHOD` etc.
function getField(obj: RoomReply, ...names: string[]): unknown {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()))
  for (const key of Object.keys(obj)) {
    if (wanted.has(key.trim().toLowerCase())) return obj[key]
  }
  return undefined
}

function normalizeVersion(obj: RoomReply): number | 'BAD' {
  const raw = getField(obj, 'v', 'version')
  if (raw === undefined || raw === null) return 1
  if (typeof raw === 'number') return raw === 1 ? 1 : 'BAD'
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text === '') return 1
    return Number(text) === 1 ? 1 : 'BAD'
  }
  return 'BAD'
}

function normalizeMethod(obj: RoomReply): { canonical: string; raw: string } | null {
  const raw = getField(obj, 'm', 'method')
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  const lower = text.toLowerCase()
  const canonical = lower === 'resync' ? 'rejoin' : lower
  return { canonical, raw: text }
}

export function okReply(m: string, fields: RoomReply = {}): RoomReply {
  return { m, ok: true, ...fields }
}

export function errReply(m: string, error: string): RoomReply {
  return { m, ok: false, error, reason: error }
}

const KNOWN_METHODS = new Set([
  'create_room',
  'join_room',
  'rejoin',
  'add_bot',
  'remove_bot',
  'start_game',
  'rematch',
  'place_tiles',
  'place',
  'pass',
  'pass_turn',
  'exchange',
  'recall',
  'shuffle_rack',
  'shuffle',
  'get_rack',
  'rack',
  'debug_set_rack',
  'debug_set_bag',
  'chat',
  'emote',
])

// Out of scope for this lap (owned by bot/client issues): still BAD_STATE.
const STILL_UNBOUND = new Set(['rematch'])

// Chat text contract (issue #16): trim, reject blank/non-string, truncate
// to 200 chars. Long input truncates — it is never rejected.
function normalizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = truncateChatText(raw.trim())
  return text === '' ? null : text
}

function isDebugAllowed(explicit?: boolean): boolean {
  if (explicit === true) return true
  if (explicit === false) {
    return !!process.env.VITEST || process.env.WORDTABLE_DEBUG === '1'
  }
  return !!process.env.VITEST || process.env.WORDTABLE_DEBUG === '1'
}

function lookupOption(sources: RoomReply[], ...names: string[]): unknown {
  const wanted = new Set(names.map((n) => n.toLowerCase()))
  for (const src of sources) {
    if (typeof src !== 'object' || src === null || Array.isArray(src)) continue
    for (const key of Object.keys(src)) {
      if (wanted.has(key.trim().toLowerCase())) return (src as RoomReply)[key]
    }
  }
  return undefined
}

export interface ClockSpec {
  timerOn: boolean
  turnSecs: number
}

function optionsObject(msg: RoomReply): RoomReply {
  const raw = getField(msg, 'options')
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as RoomReply
  }
  return {}
}

// Clock resolved once per room: explicit turn_secs (any of the five aliases,
// clamped 1-3600) wins; otherwise 90s when on, 180s stall guard when off.
// timer_off:true wins over timer_on.
export function resolveClock(msg: RoomReply): ClockSpec {
  const opts = optionsObject(msg)
  const sources = [opts, msg]
  const offRaw = lookupOption(sources, 'timer_off', 'timeroff')
  const onRaw = lookupOption(sources, 'timer_on', 'timeron')
  const isOff =
    offRaw === true || offRaw === 1 || offRaw === 'true' || offRaw === '1' || offRaw === 'on'
  const isOnFalse =
    onRaw === false || onRaw === 0 || onRaw === 'false' || onRaw === '0' || onRaw === 'off'
  let timerOn = true
  if (isOff) timerOn = false
  else if (isOnFalse) timerOn = false
  else if (onRaw === true || onRaw === 1 || onRaw === 'true' || onRaw === '1') timerOn = true
  const turnRaw = lookupOption(
    sources,
    'turn_secs',
    'timer_secs',
    'turn_timeout',
    'timeout_secs',
    'turn_limit_secs',
  )
  let turnSecs: number
  if (turnRaw !== undefined) {
    turnSecs = clampTurnSecs(turnRaw)
  } else {
    turnSecs = timerOn ? DEFAULT_TURN_SECS : STALL_GUARD_SECS
  }
  return { timerOn, turnSecs }
}

function hasExplicitClock(msg: RoomReply): boolean {
  const opts = optionsObject(msg)
  const sources = [opts, msg]
  const found = lookupOption(
    sources,
    'timer_on',
    'timeron',
    'timer_off',
    'timeroff',
    'turn_secs',
    'timer_secs',
    'turn_timeout',
    'timeout_secs',
    'turn_limit_secs',
  )
  return found !== undefined
}

function rackFaces(rack: Tile[]): string[] {
  return rack.map((t) => (t.isBlank ? '?' : String(t.face).toUpperCase()))
}

function tileFromFace(raw: unknown): Tile | null {
  if (typeof raw === 'string') {
    const text = raw.trim().toUpperCase()
    if (text === '' ) return null
    if (text === '?' || text === 'BLANK') return { face: '?', isBlank: true }
    if (/^[A-Z]$/.test(text)) return { face: text, isBlank: false }
    return null
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const obj = raw as RoomReply
    const faceRaw = getField(obj, 'face', 'letter', 'tile', 'value')
    const blankRaw = getField(obj, 'isBlank', 'is_blank', 'blank')
    const asRaw = getField(obj, 'as', 'blankAs', 'blank_as', 'designation')
    if (typeof faceRaw === 'string') {
      const text = faceRaw.trim().toUpperCase()
      if (text === '?' || blankRaw === true) {
        const tile: Tile = { face: '?', isBlank: true }
        if (typeof asRaw === 'string' && /^[A-Z]$/i.test(asRaw.trim())) {
          tile.blankAs = asRaw.trim().toUpperCase()
        }
        return tile
      }
      if (/^[A-Z]$/.test(text)) return { face: text, isBlank: false }
    }
    if (blankRaw === true) return { face: '?', isBlank: true }
  }
  return null
}

function boardTilesFor(game: LocalGame): Array<Record<string, unknown>> {
  const state = game.getState()
  const out: Array<Record<string, unknown>> = []
  for (let r = 0; r < state.board.length; r++) {
    const row = state.board[r]
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (cell !== null && cell !== undefined) {
        out.push({
          row: r,
          col: c,
          letter: cell.letter,
          blank: cell.blank,
          square: toAlgebra(r, c),
        })
      }
    }
  }
  return out
}

// Public snapshot for one seat: board/scores/turn/over plus ONLY that seat's
// rack and a `you` marker. Never includes another seat's tiles by construction.
export function viewFor(entry: RoomEntry, seat: number): RoomReply {
  const state = entry.game.getState()
  const over = state.status === 'ENDED'
  const racks = state.racks
  const own = seat >= 0 && seat < racks.length ? rackFaces(racks[seat]) : []
  return {
    turn: state.turn,
    scores: [...state.scores],
    board_tiles: boardTilesFor(entry.game),
    bag_remaining: state.bagRemaining,
    over,
    started: true,
    rack: own,
    you: seat,
    seat,
  }
}

export function createBinding(registry: RoomRegistry, opts: CreateBindingOpts) {
  const entries = new Map<string, RoomEntry>()
  const pendingClocks = new Map<string, ClockSpec>()
  const pendingSeeds = new Map<string, number>()
  const isWord: Lexicon = opts.isWord
  const send: BindingSend | undefined = opts.send

  function armClock(code: string): void {
    const entry = entries.get(code)
    if (!entry) return
    if (entry.game.getState().status !== 'PLAYING') {
      entry.timer.disarm()
      return
    }
    const ms = entry.turnSecs * 1000
    entry.timer.disarm()
    entry.timer.arm(ms, () => autoPass(code))
  }

  function disarmBot(code: string): void {
    const entry = entries.get(code)
    if (!entry) return
    if (entry.botTimer !== null) {
      clearTimeout(entry.botTimer)
      entry.botTimer = null
    }
  }

  function seatsInfoFor(code: string): Array<Record<string, unknown>> {
    const room = registry.get(code)
    if (!room) return []
    return room.seats.map((s) => ({ seat: s.seat, name: s.name, is_bot: !!s.isBot }))
  }

  function maybeScheduleBot(code: string): void {
    disarmBot(code)
    const entry = entries.get(code)
    const room = registry.get(code)
    if (!entry || !room) return
    if (entry.game.getState().status !== 'PLAYING') return
    const turn = entry.game.getState().turn
    const seatObj = room.seats.find((s) => s.seat === turn)
    if (!seatObj?.isBot) return
    const ms = botThinkDelayMs(entry.seed)
    entry.botTimer = setTimeout(() => runBotTurn(code), ms)
    const h = entry.botTimer as unknown as { unref?: () => void }
    if (typeof h.unref === 'function') h.unref()
  }

  function afterTurn(code: string): void {
    const entry = entries.get(code)
    if (!entry) return
    const state = entry.game.getState()
    if (state.status === 'ENDED') {
      entry.timer.disarm()
      disarmBot(code)
      return
    }
    const room = registry.get(code)
    const turnSeat = room?.seats.find((s) => s.seat === state.turn)
    if (turnSeat?.isBot) {
      entry.timer.disarm()
      maybeScheduleBot(code)
    } else {
      disarmBot(code)
      armClock(code)
    }
  }

  function runBotTurn(code: string): void {
    const entry = entries.get(code)
    const room = registry.get(code)
    if (!entry || !room) return
    entry.botTimer = null
    const state = entry.game.getState()
    if (state.status !== 'PLAYING') {
      entry.timer.disarm()
      return
    }
    const turn = state.turn
    const seatObj = room.seats.find((s) => s.seat === turn)
    if (!seatObj?.isBot) {
      armClock(code)
      return
    }
    const snap = entry.game.getState()
    const board = snap.board
    const rack = snap.racks[turn]
    let move: ReturnType<typeof generateBotMove>
    try {
      move = generateBotMove(board, rack, isWord, { seed: entry.seed })
    } catch {
      move = { pass: true }
    }
    if ('pass' in move) {
      const pres = entry.game.pass(turn)
      if (!pres.ok) {
        afterTurn(code)
        return
      }
      const after = entry.game.getState()
      const over = after.status === 'ENDED'
      if (over) {
        entry.timer.disarm()
        disarmBot(code)
      }
      broadcastState(code, {})
      if (!over) afterTurn(code)
      return
    }
    const specs: PlaceSpec[] = move.placements.map((p) => {
      const square = { row: p.row, col: p.col }
      if (p.tile.isBlank) {
        const asLetter = (p.tile.blankAs ?? '').trim().toUpperCase()
        return { square, face: '?', as: /^[A-Z]$/.test(asLetter) ? asLetter : 'A' }
      }
      return { square, face: p.tile.face }
    })
    const placed = entry.game.place(turn, specs)
    if (!placed.ok) {
      const pres = entry.game.pass(turn)
      void pres
      const after = entry.game.getState()
      const over = after.status === 'ENDED'
      if (over) {
        entry.timer.disarm()
        disarmBot(code)
      }
      broadcastState(code, {})
      if (!over) afterTurn(code)
      return
    }
    const after = entry.game.getState()
    const over = after.status === 'ENDED'
    if (over) {
      entry.timer.disarm()
      disarmBot(code)
    }
    broadcastState(code, { bot_move: true })
    if (!over) afterTurn(code)
  }

  function autoPass(code: string): void {
    const entry = entries.get(code)
    if (!entry) return
    const state = entry.game.getState()
    if (state.status !== 'PLAYING') return
    const turn = state.turn
    const result = entry.game.pass(turn)
    if (!result.ok) return
    const after = entry.game.getState()
    const over = after.status === 'ENDED'
    broadcastState(code, {
      auto_pass: true,
      turn: after.turn,
      scores: [...after.scores],
      over,
    })
    if (!over) {
      afterTurn(code)
    } else {
      entry.timer.disarm()
      disarmBot(code)
    }
  }

  function broadcastState(code: string, extra: RoomReply = {}): void {
    if (!send) return
    const entry = entries.get(code)
    const room = registry.get(code)
    if (!entry || !room) return
    const seats_info = seatsInfoFor(code)
    for (const s of room.seats) {
      const view = viewFor(entry, s.seat)
      const frame: RoomReply = {
        m: 'state_sync',
        ok: true,
        code,
        seats: room.seats.length,
        ...view,
        seats_info,
        ...extra,
      }
      try {
        send(s.seat, frame)
      } catch {
        // a failing recipient never blocks the rest of the fan-out
      }
    }
  }

  function startGame(
    code: string,
    seed?: number,
    clock?: ClockSpec,
  ): { ok: true; entry: RoomEntry } | { ok: false; error: string } {
    const room = registry.get(code)
    if (!room) return { ok: false, error: 'NO_ROOM' }
    if (room.seats.length < 2) return { ok: false, error: 'NEED_OPPONENT' }
    const names = room.seats.map((s) => s.name)
    const useSeed =
      typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : Math.floor(Math.random() * 2 ** 31)
    const game = new LocalGame(names, useSeed, isWord)
    const old = entries.get(code)
    if (old) {
      old.timer.disarm()
      if (old.botTimer !== null) clearTimeout(old.botTimer)
    }
    const entry: RoomEntry = {
      game,
      timerOn: clock?.timerOn ?? true,
      turnSecs: clock?.turnSecs ?? DEFAULT_TURN_SECS,
      timer: new TurnTimer(),
      seed: useSeed,
      botTimer: null,
    }
    entries.set(code, entry)
    afterTurn(code)
    return { ok: true, entry }
  }

  function resolveSpecs(seat: number, game: LocalGame, rawTiles: unknown): PlaceSpec[] | null {
    void game
    void seat
    if (!Array.isArray(rawTiles)) return null
    const specs: PlaceSpec[] = []
    for (const item of rawTiles) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
      const obj = item as RoomReply
      const squareRaw = getField(obj, 'square', 'sq', 'pos', 'position', 'cell', 'coord')
      const faceRaw = getField(obj, 'face', 'letter', 'tile', 'value')
      const asRaw = getField(obj, 'as', 'blankAs', 'blank_as', 'designation', 'asLetter', 'as_letter')
      if (squareRaw === undefined || faceRaw === undefined) return null
      let square: PlaceSpec['square']
      if (typeof squareRaw === 'string') {
        try {
          const parsed = parseSquare(squareRaw)
          square = parsed
        } catch {
          return null
        }
      } else if (typeof squareRaw === 'object' && squareRaw !== null && !Array.isArray(squareRaw)) {
        const sq = squareRaw as Record<string, unknown>
        const rowRaw = (sq['row'] ?? (sq as Record<string, unknown>)['r']) as unknown
        const colRaw = (sq['col'] ?? (sq as Record<string, unknown>)['c']) as unknown
        const row = typeof rowRaw === 'number' ? rowRaw : Number(rowRaw)
        const col = typeof colRaw === 'number' ? colRaw : Number(colRaw)
        if (!Number.isInteger(row) || !Number.isInteger(col)) return null
        square = { row, col }
      } else {
        return null
      }
      if (typeof faceRaw !== 'string') return null
      const face = String(faceRaw).trim()
      if (face === '') return null
      const spec: PlaceSpec = { square, face }
      if (typeof asRaw === 'string' && asRaw.trim() !== '') {
        spec.as = asRaw.trim().toUpperCase()
      } else if (typeof asRaw === 'object' && asRaw !== null) {
        const text = String(asRaw).trim()
        if (text !== '') spec.as = text.toUpperCase()
      }
      specs.push(spec)
    }
    return specs
  }

  function handleMessage(msg: unknown): RoomReply {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      return errReply('unknown', 'BAD_JSON')
    }
    const obj = msg as RoomReply
    const method = normalizeMethod(obj)
    const echoM =
      method === null
        ? 'unknown'
        : KNOWN_METHODS.has(method.canonical)
          ? method.canonical
          : method.raw
    if (normalizeVersion(obj) === 'BAD') return errReply(echoM, 'BAD_VERSION')
    if (method === null) return errReply('unknown', 'UNKNOWN_MESSAGE')
    if (!KNOWN_METHODS.has(method.canonical)) return errReply(method.raw, 'UNKNOWN_MESSAGE')
    const m = method.canonical

    if (m === 'create_room') {
      const name = normalizeName(getField(obj, 'name', 'player', 'player_name'))
      const { room, seat } = registry.create(name)
      if (hasExplicitClock(obj)) {
        pendingClocks.set(room.code, resolveClock(obj))
      } else {
        pendingClocks.delete(room.code)
      }
      const seedRaw = getField(obj, 'seed', 'random_seed', 'seed_value')
      if (typeof seedRaw === 'number' && Number.isFinite(seedRaw)) {
        pendingSeeds.set(room.code, Math.floor(seedRaw))
      } else if (typeof seedRaw === 'string' && seedRaw.trim() !== '' && Number.isFinite(Number(seedRaw))) {
        pendingSeeds.set(room.code, Math.floor(Number(seedRaw)))
      } else {
        pendingSeeds.delete(room.code)
      }
      return okReply('create_room', {
        code: room.code,
        token: seat.token,
        seat: seat.seat,
        you: seat.seat,
        seats: room.seats.length,
      })
    }

    if (m === 'join_room') {
      const code = normalizeCode(getField(obj, 'code', 'room', 'room_code'))
      const name = normalizeName(getField(obj, 'name', 'player', 'player_name'))
      const token = normalizeToken(getField(obj, 'token', 'session', 'session_token'))
      const res = registry.join(code, name, token)
      if (!res.ok) return errReply('join_room', res.error)
      return okReply('join_room', {
        code: res.room.code,
        token: res.seat.token,
        seat: res.seat.seat,
        you: res.seat.seat,
        seats: res.room.seats.length,
      })
    }

    if (m === 'rejoin') {
      const code = normalizeCode(getField(obj, 'code', 'room', 'room_code'))
      const token = normalizeToken(getField(obj, 'token', 'session', 'session_token'))
      const res = registry.rejoin(code, token)
      if (!res.ok) return errReply('rejoin', res.error)
      const seats_info = seatsInfoFor(res.room.code)
      const entry = entries.get(res.room.code)
      if (!entry) {
        return okReply('rejoin', {
          code: res.room.code,
          token: res.seat.token,
          seat: res.seat.seat,
          you: res.seat.seat,
          seats: res.room.seats.length,
          seats_info,
          started: false,
          turn: 0,
          scores: res.room.seats.map(() => 0),
          rack: [],
          board_tiles: [],
          over: false,
          bag_remaining: 100,
        })
      }
      const view = viewFor(entry, res.seat.seat)
      return okReply('rejoin', {
        code: res.room.code,
        token: res.seat.token,
        seats: res.room.seats.length,
        seats_info,
        ...view,
      })
    }

    if (STILL_UNBOUND.has(m)) return errReply(m, 'BAD_STATE')

    // All remaining bound methods require an authenticated seat.
    const code = normalizeCode(getField(obj, 'code', 'room', 'room_code'))
    const token = normalizeToken(getField(obj, 'token', 'session', 'session_token'))
    const auth = registry.rejoin(code, token)
    if (!auth.ok) return errReply(m, auth.error)
    const seat = auth.seat.seat
    const roomCode = auth.room.code

    // Lobby-safe chat (issue #16): auth-only, no game required. Sits
    // before the entry gate so lobby and table fan out identically.
    if (m === 'chat') {
      const text = normalizeChatText(getField(obj, 'text', 'message', 'body', 'msg'))
      if (text === null) return errReply(m, 'BAD_TEXT')
      const from = auth.seat.name
      const ts = Date.now()
      const reply = okReply(m, { chat_ok: true, from, text, ts, code: roomCode, seat })
      if (send) {
        const frame: RoomReply = { m: 'chat', ok: true, code: roomCode, from, text, ts }
        for (const s of auth.room.seats) {
          try {
            send(s.seat, frame)
          } catch {
            // a failing recipient never blocks the rest of the fan-out
          }
        }
      }
      return reply
    }

    if (m === 'emote') {
      const raw = getField(obj, 'emote', 'emoji', 'text', 'message')
      const text = normalizeChatText(raw)
      if (text === null) return errReply(m, 'BAD_TEXT')
      const from = auth.seat.name
      const ts = Date.now()
      const reply = okReply(m, { emote_ok: true, from, text, emote: text, ts, code: roomCode, seat })
      if (send) {
        const frame: RoomReply = { m: 'emote', ok: true, code: roomCode, from, text, emote: text, ts }
        for (const s of auth.room.seats) {
          try {
            send(s.seat, frame)
          } catch {
            // a failing recipient never blocks the rest of the fan-out
          }
        }
      }
      return reply
    }

    if (m === 'start_game') {
      if (seat !== 0) return errReply(m, 'NOT_HOST')
      if (auth.room.seats.length < 2) return errReply(m, 'NEED_OPPONENT')
      let clock: ClockSpec
      if (hasExplicitClock(obj)) {
        clock = resolveClock(obj)
      } else {
        clock = pendingClocks.get(roomCode) ?? resolveClock(obj)
      }
      let seed: number | undefined = pendingSeeds.get(roomCode)
      const seedRaw = getField(obj, 'seed', 'random_seed', 'seed_value')
      if (typeof seedRaw === 'number' && Number.isFinite(seedRaw)) seed = Math.floor(seedRaw)
      else if (typeof seedRaw === 'string' && seedRaw.trim() !== '' && Number.isFinite(Number(seedRaw))) {
        seed = Math.floor(Number(seedRaw))
      }
      const started = startGame(roomCode, seed, clock)
      if (!started.ok) return errReply(m, started.error)
      const state = started.entry.game.getState()
      const seats_info = seatsInfoFor(roomCode)
      const reply = okReply(m, {
        code: roomCode,
        started: true,
        turn: state.turn,
        scores: [...state.scores],
        seats: auth.room.seats.length,
        seats_info,
        over: false,
        bag_remaining: state.bagRemaining,
        seat,

        you: seat,
      })
      broadcastState(roomCode, { started: true })
      return reply
    }

    if (m === 'add_bot') {
      if (seat !== 0) return errReply(m, 'NOT_HOST')
      const res = registry.addBot(roomCode)
      if (!res.ok) return errReply(m, res.error)
      const botSeat = res.seat.seat
      const seats_info = seatsInfoFor(roomCode)
      const reply = okReply(m, {
        bot: BOT_NAME,
        bot_seat: botSeat,
        seat: BOT_NAME,
        name: BOT_NAME,
        is_bot: true,
        bot_seated: true,
        seats: res.room.seats.length,
        seats_info,
        code: roomCode,
      })
      const live = entries.get(roomCode)
      if (live) {
        broadcastState(roomCode, {
          bot: BOT_NAME,
          bot_seat: botSeat,
          seat: BOT_NAME,
          name: BOT_NAME,
          is_bot: true,
          bot_seated: true,
          seats_info,
        })
      } else if (send) {
        for (const s of res.room.seats) {
          const frame: RoomReply = {
            m: 'state_sync',
            ok: true,
            code: roomCode,
            seats: res.room.seats.length,
            seats_info,
            bot: BOT_NAME,
            bot_seat: botSeat,
            seat: BOT_NAME,
            name: BOT_NAME,
            is_bot: true,
            bot_seated: true,
            started: false,
          }
          try {
            send(s.seat, frame)
          } catch {
            // a failing recipient never blocks the rest of the fan-out
          }
        }
      }
      return reply
    }

    if (m === 'remove_bot') {
      if (seat !== 0) return errReply(m, 'NOT_HOST')
      const seatRaw = getField(obj, 'seat', 'target', 'seat_index', 'which', 'bot_seat')
      const res = registry.removeBot(roomCode, seatRaw)
      if (!res.ok) return errReply(m, res.error)
      disarmBot(roomCode)
      const seats_info = seatsInfoFor(roomCode)
      const reply = okReply(m, {
        seats: res.room.seats.length,
        seats_info,
        code: roomCode,
      })
      const live = entries.get(roomCode)
      if (live) {
        if (live.game.getState().status !== 'PLAYING') {
          live.timer.disarm()
          disarmBot(roomCode)
        }
        broadcastState(roomCode, { seats_info })
      } else if (send) {
        for (const s of res.room.seats) {
          const frame: RoomReply = {
            m: 'state_sync',
            ok: true,
            code: roomCode,
            seats: res.room.seats.length,
            seats_info,
            started: false,
          }
          try {
            send(s.seat, frame)
          } catch {
            // a failing recipient never blocks the rest of the fan-out
          }
        }
        if (res.room.seats.length === 0) {
          // no recipients left; nothing to fan out
        }
      }
      return reply
    }

    const entry = entries.get(roomCode)
    if (!entry) return errReply(m, 'BAD_STATE')

    if (m === 'place_tiles' || m === 'place') {
      const rawTiles = getField(obj, 'tiles', 'placements')
      const specs = resolveSpecs(seat, entry.game, rawTiles)
      if (specs === null) return errReply(m, 'BAD_TILES')
      const result = entry.game.place(seat, specs)
      if (!result.ok) {
        const fail = result as { ok: false; reason: string; word?: string }
        const fields: RoomReply = {}
        if (typeof fail.word === 'string') fields['word'] = fail.word
        return { m, ok: false, error: fail.reason, reason: fail.reason, ...fields }
      }
      const ok = result as { ok: true; points: number; words: string[]; bingo: boolean; turn: number; scores: number[] }
      const over = entry.game.getState().status === 'ENDED'
      if (over) {
        entry.timer.disarm()
        disarmBot(roomCode)
      } else afterTurn(roomCode)
      const reply = okReply(m, {
        accepted: true,
        points: ok.points,
        words: [...ok.words],
        bingo: ok.bingo,
        turn: ok.turn,
        scores: [...ok.scores],
        over,
        seat,
        you: seat,
      })
      broadcastState(roomCode, {})
      return reply
    }

    if (m === 'pass' || m === 'pass_turn') {
      const result = entry.game.pass(seat)
      if (!result.ok) {
        const fail = result as { ok: false; reason: string }
        return errReply(m, fail.reason)
      }
      const ok = result as { ok: true; turn: number; scores: number[] }
      const over = entry.game.getState().status === 'ENDED'
      if (over) {
        entry.timer.disarm()
        disarmBot(roomCode)
      } else afterTurn(roomCode)
      const reply = okReply(m, {
        accepted: true,
        turn: ok.turn,
        scores: [...ok.scores],
        over,
        seat,
        you: seat,
      })
      broadcastState(roomCode, {})
      return reply
    }

    if (m === 'exchange') {
      const countRaw = getField(obj, 'count', 'n', 'num', 'exchange_count', 'tiles_count')
      let param: string[] | number | null = null
      if (countRaw !== undefined) {
        const n = typeof countRaw === 'number' ? countRaw : Number(String(countRaw).trim())
        if (!Number.isInteger(n)) return errReply(m, 'BAD_TILES')
        param = n
      } else {
        const facesRaw = getField(obj, 'tiles', 'placements', 'faces', 'letters', 'rack')
        if (!Array.isArray(facesRaw)) return errReply(m, 'BAD_TILES')
        const faces: string[] = []
        for (const f of facesRaw) {
          if (typeof f === 'string') {
            const text = f.trim().toUpperCase()
            if (text === '') return errReply(m, 'BAD_TILES')
            faces.push(text)
          } else if (typeof f === 'object' && f !== null) {
            const face = getField(f as RoomReply, 'face', 'letter', 'tile', 'value')
            if (typeof face !== 'string' || face.trim() === '') return errReply(m, 'BAD_TILES')
            faces.push(face.trim().toUpperCase())
          } else {
            return errReply(m, 'BAD_TILES')
          }
        }
        param = faces
      }
      const result = entry.game.exchange(seat, param)
      if (!result.ok) {
        const fail = result as { ok: false; reason: string }
        return errReply(m, fail.reason)
      }
      const ok = result as { ok: true; turn: number; scores: number[]; rack: Tile[] }
      const over = entry.game.getState().status === 'ENDED'
      if (over) {
        entry.timer.disarm()
        disarmBot(roomCode)
      } else afterTurn(roomCode)
      const reply = okReply(m, {
        accepted: true,
        turn: ok.turn,
        scores: [...ok.scores],
        over,
        rack: rackFaces(ok.rack),
        seat,
        you: seat,
      })
      broadcastState(roomCode, {})
      return reply
    }

    if (m === 'recall') {
      const result = entry.game.recall(seat)
      if (!result.ok) {
        const fail = result as { ok: false; reason: string }
        return errReply(m, fail.reason)
      }
      const ok = result as { ok: true; recalled: number; rack: Tile[] }
      return okReply(m, {
        recalled: ok.recalled,
        rack: rackFaces(ok.rack),
        turn: entry.game.getState().turn,
        scores: [...entry.game.getState().scores],
        seat,
        you: seat,
      })
    }

    if (m === 'shuffle_rack' || m === 'shuffle') {
      const result = entry.game.shuffle(seat)
      if (!result.ok) {
        const fail = result as { ok: false; reason: string }
        return errReply(m, fail.reason)
      }
      const ok = result as { ok: true; rack: Tile[] }
      return okReply(m, {
        rack: rackFaces(ok.rack),
        turn: entry.game.getState().turn,
        scores: [...entry.game.getState().scores],
        seat,
        you: seat,
      })
    }

    if (m === 'get_rack' || m === 'rack') {
      const state = entry.game.getState()
      if (seat < 0 || seat >= state.racks.length) return errReply(m, 'BAD_STATE')
      return okReply(m, {
        rack: rackFaces(state.racks[seat]),
        seat,
        you: seat,
        turn: state.turn,
        scores: [...state.scores],
        over: state.status === 'ENDED',
      })
    }

    if (m === 'debug_set_rack' || m === 'debug_set_bag') {
      if (!isDebugAllowed(opts.allowDebug)) return errReply(m, 'BAD_STATE')
      if (seat !== 0) return errReply(m, 'NOT_HOST')
      if (m === 'debug_set_rack') {
        const seatRaw = getField(obj, 'seat', 'target', 'seat_index', 'which')
        let target = seat
        if (seatRaw !== undefined) {
          const n = typeof seatRaw === 'number' ? seatRaw : Number(String(seatRaw).trim())
          if (!Number.isInteger(n)) return errReply(m, 'BAD_STATE')
          target = n
        }
        const rackRaw = getField(obj, 'rack', 'tiles', 'letters', 'faces')
        if (!Array.isArray(rackRaw)) return errReply(m, 'BAD_STATE')
        const tiles: Tile[] = []
        for (const r of rackRaw) {
          const tile = tileFromFace(r)
          if (!tile) return errReply(m, 'BAD_STATE')
          tiles.push(tile)
        }
        const state = entry.game.getState()
        if (target < 0 || target >= state.racks.length) return errReply(m, 'BAD_STATE')
        const liveRacks = entry.game.game.racks
        liveRacks[target].splice(0, liveRacks[target].length, ...tiles)
        return okReply(m, {
          seat: target,
          rack: rackFaces(liveRacks[target]),
        })
      }
      // debug_set_bag
      const bagRaw = getField(obj, 'bag', 'tiles', 'letters', 'faces', 'rack')
      const countRaw = getField(obj, 'bag_remaining', 'remaining', 'count', 'n', 'size')
      const bag = (entry.game.game as unknown as { _bag: { tiles: Tile[] } })._bag
      if (Array.isArray(bagRaw)) {
        const tiles: Tile[] = []
        for (const r of bagRaw) {
          const tile = tileFromFace(r)
          if (!tile) return errReply(m, 'BAD_STATE')
          tiles.push(tile)
        }
        bag.tiles.splice(0, bag.tiles.length, ...tiles)
      } else if (countRaw !== undefined) {
        const n = typeof countRaw === 'number' ? countRaw : Number(String(countRaw).trim())
        if (!Number.isInteger(n) || n < 0) return errReply(m, 'BAD_STATE')
        while (bag.tiles.length > n) bag.tiles.pop()
        while (bag.tiles.length < n) bag.tiles.push({ face: 'A', isBlank: false })
      } else {
        return errReply(m, 'BAD_STATE')
      }
      return okReply(m, { bag_remaining: entry.game.game.bagRemaining() })
    }

    return errReply(m, 'BAD_STATE')
  }

  return {
    entries,
    handleMessage,
    viewFor: (code: string, seat: number): RoomReply | null => {
      const e = entries.get(code)
      if (!e) return null
      return viewFor(e, seat)
    },
    broadcastState,
    startGame,
    resolveClock,
    disarmBot,
    maybeScheduleBot,
    runBotTurn,
    afterTurn,
  }
}

export type Binding = ReturnType<typeof createBinding>
