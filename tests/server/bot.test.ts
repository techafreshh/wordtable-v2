import { describe, it, expect, vi, afterEach } from 'vitest'
import { RoomRegistry } from '../../server/src/rooms'
import { createBinding, type RoomReply } from '../../server/src/binding'
import { BOT_NAME, botThinkDelaySecs, botThinkDelayMs } from '../../server/src/bot-seat'

function makeBinding(isWord: (w: string) => boolean = () => true) {
  const registry = new RoomRegistry()
  const sent: Array<{ seat: number; frame: RoomReply }> = []
  const binding = createBinding(registry, {
    isWord,
    allowDebug: true,
    send: (seat, frame) => {
      sent.push({ seat, frame })
    },
  })
  return { registry, binding, sent }
}

function hostRoom(binding: ReturnType<typeof createBinding>) {
  const c0 = binding.handleMessage({ v: 1, m: 'create_room', name: 'Ann' }) as RoomReply & {
    code: string
    token: string
  }
  return { code: String(c0['code']), t0: String(c0['token']) }
}

function joinAs(binding: ReturnType<typeof createBinding>, code: string, name: string) {
  const j = binding.handleMessage({ v: 1, m: 'join_room', code, name }) as RoomReply & {
    token: string
  }
  return String(j['token'])
}

afterEach(() => {
  vi.useRealTimers()
})

describe('bot seats', () => {
  it('host add_bot seats Botgomery with is_bot', () => {
    const { binding, sent } = makeBinding()
    const { code, t0 } = hostRoom(binding)
    sent.length = 0
    const reply = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(reply['ok']).toBe(true)
    expect(reply['bot']).toBe('Botgomery')
    expect(reply['bot']).toBe(BOT_NAME)
    expect(reply['bot_seated']).toBe(true)
    expect(reply['is_bot']).toBe(true)
    expect(reply['name']).toBe('Botgomery')
    expect(reply['seat']).toBe('Botgomery')
    expect(reply['seats']).toBe(2)
    const info = reply['seats_info'] as Array<Record<string, unknown>>
    expect(Array.isArray(info)).toBe(true)
    const botEntry = info.find((e) => e['name'] === 'Botgomery')
    expect(botEntry).toBeDefined()
    expect(botEntry?.['is_bot']).toBe(true)
    // Lobby broadcast fans out the same bot fields.
    expect(sent.length).toBeGreaterThan(0)
    const saw = sent.some(
      (s) => s.frame['name'] === 'Botgomery' && s.frame['is_bot'] === true,
    )
    expect(saw).toBe(true)
  })

  it('non-host add_bot is NOT_HOST', () => {
    const { binding } = makeBinding()
    const { code, t0 } = hostRoom(binding)
    const t1 = joinAs(binding, code, 'Bo')
    void t0
    const reply = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t1 })
    expect(reply).toMatchObject({ ok: false, error: 'NOT_HOST' })
  })

  it('rejects add_bot when the room is full', () => {
    const { binding } = makeBinding()
    const { code, t0 } = hostRoom(binding)
    joinAs(binding, code, 'B')
    joinAs(binding, code, 'C')
    const ok = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(ok['ok']).toBe(true)
    expect(ok['seats']).toBe(4)
    const full = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(full).toMatchObject({ ok: false, error: 'ROOM_FULL' })
  })

  it('think delay is 5 + abs(seed) % 11 seconds', () => {
    expect(botThinkDelaySecs(7)).toBe(12)
    expect(botThinkDelayMs(7)).toBe(12000)
    expect(botThinkDelaySecs(NaN)).toBe(5)
    expect(botThinkDelaySecs(undefined)).toBe(5)
    for (let seed = 0; seed <= 50; seed++) {
      const secs = botThinkDelaySecs(seed)
      expect(secs).toBeGreaterThanOrEqual(5)
      expect(secs).toBeLessThanOrEqual(15)
      expect(Number.isInteger(secs)).toBe(true)
    }
    expect(botThinkDelaySecs(-7)).toBe(12)
  })

  it('greedy commit broadcasts bot_move:true without waiting on the clock', () => {
    const { binding, sent } = makeBinding(() => true)
    const { code, t0 } = hostRoom(binding)
    binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    const started = binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed: 7 })
    expect(started['ok']).toBe(true)
    // Human passes so the bot holds the turn.
    const passed = binding.handleMessage({ v: 1, m: 'pass', code, token: t0 })
    expect(passed['ok']).toBe(true)
    expect(passed['turn']).toBe(1)
    // Cancel the real 12s timer; invoke the turn directly.
    binding.disarmBot(code)
    sent.length = 0
    binding.runBotTurn(code)
    const commit = sent.filter((s) => s.frame['bot_move'] === true)
    expect(commit.length).toBeGreaterThan(0)
    for (const s of commit) {
      expect(s.frame['m']).toBe('state_sync')
    }
    const entry = binding.entries.get(code)
    expect(entry?.game.getState().turn).toBe(0)
    entry?.timer.disarm()
    binding.disarmBot(code)
  })

  it('hostile lexicon yields a pass advance without bot_move', () => {
    const { binding, sent } = makeBinding(() => false)
    const { code, t0 } = hostRoom(binding)
    binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed: 7 })
    binding.handleMessage({ v: 1, m: 'pass', code, token: t0 })
    binding.disarmBot(code)
    sent.length = 0
    binding.runBotTurn(code)
    expect(binding.entries.get(code)?.game.getState().turn).toBe(0)
    // Pass broadcasts carry no bot_move flag.
    for (const s of sent) {
      expect(s.frame['bot_move']).toBeUndefined()
    }
    expect(sent.length).toBeGreaterThan(0)
    binding.entries.get(code)?.timer.disarm()
    binding.disarmBot(code)
  })

  it('remove_bot frees the seat and a second add_bot re-seats', () => {
    const { binding } = makeBinding()
    const { code, t0 } = hostRoom(binding)
    const added = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(added['seats']).toBe(2)
    const removed = binding.handleMessage({ v: 1, m: 'remove_bot', code, token: t0 })
    expect(removed['ok']).toBe(true)
    expect(removed['seats']).toBe(1)
    const info = removed['seats_info'] as Array<Record<string, unknown>>
    expect(info.find((e) => e['is_bot'] === true)).toBeUndefined()
    const reseated = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(reseated['ok']).toBe(true)
    expect(reseated['seats']).toBe(2)
    expect(reseated['bot']).toBe('Botgomery')
  })

  it('remove_bot guards NOT_HOST and BAD_STATE', () => {
    const { binding } = makeBinding()
    const { code, t0 } = hostRoom(binding)
    const t1 = joinAs(binding, code, 'Bo')
    expect(
      binding.handleMessage({ v: 1, m: 'remove_bot', code, token: t1 }),
    ).toMatchObject({ ok: false, error: 'NOT_HOST' })
    expect(
      binding.handleMessage({ v: 1, m: 'remove_bot', code, token: t0 }),
    ).toMatchObject({ ok: false, error: 'BAD_STATE' })
  })

  it('state_sync carries seats_info with the bot roster', () => {
    const { binding, sent } = makeBinding(() => true)
    const { code, t0 } = hostRoom(binding)
    binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed: 7 })
    sent.length = 0
    binding.handleMessage({ v: 1, m: 'pass', code, token: t0 })
    // The pass broadcast is a state_sync with the full roster.
    expect(sent.length).toBeGreaterThan(0)
    for (const s of sent) {
      expect(s.frame['m']).toBe('state_sync')
      const info = s.frame['seats_info'] as Array<Record<string, unknown>>
      expect(Array.isArray(info)).toBe(true)
      expect(info.find((e) => e['name'] === 'Botgomery' && e['is_bot'] === true)).toBeDefined()
    }
    binding.entries.get(code)?.timer.disarm()
    binding.disarmBot(code)
  })

  it('mid-game remove_bot shrinks the engine instead of leaving a ghost turn', () => {
    const { binding, registry } = makeBinding(() => true)
    const { code, t0 } = hostRoom(binding)
    binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed: 7 })
    // Human passes so the bot holds the turn; removing it must not park
    // the game on the human auto-pass clock for a seat with no owner.
    const passed = binding.handleMessage({ v: 1, m: 'pass', code, token: t0 })
    expect(passed['ok']).toBe(true)
    expect(passed['turn']).toBe(1)
    const removed = binding.handleMessage({ v: 1, m: 'remove_bot', code, token: t0 })
    expect(removed['ok']).toBe(true)
    expect(removed['seats']).toBe(1)
    const entry = binding.entries.get(code)
    expect(entry).toBeDefined()
    const state = entry!.game.getState()
    const seats = registry.get(code)?.seats.length ?? -1
    expect(seats).toBe(1)
    expect(state.names.length).toBe(seats)
    expect(state.scores.length).toBe(seats)
    expect(state.racks.length).toBe(seats)
    // Turn remaps onto the surviving seat (1 % 1 == 0) and the removed
    // bot's pending think is cancelled in favour of the human clock.
    expect(state.turn).toBe(0)
    expect(entry!.botTimer).toBeNull()
    expect(entry!.timer.armed).toBe(true)
    entry!.timer.disarm()
    binding.disarmBot(code)
  })

  it('mid-game remove then re-add keeps the engine and registry in sync', () => {
    const { binding, registry } = makeBinding(() => true)
    const { code, t0 } = hostRoom(binding)
    binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed: 7 })
    expect(binding.entries.get(code)?.game.getState().turn).toBe(0)
    const removed = binding.handleMessage({ v: 1, m: 'remove_bot', code, token: t0 })
    expect(removed['ok']).toBe(true)
    // Removing a seat after the turn leaves the turn and clock alone.
    const mid = binding.entries.get(code)!.game.getState()
    expect(mid.turn).toBe(0)
    expect(mid.names.length).toBe(1)
    expect(binding.entries.get(code)!.botTimer).toBeNull()
    const readded = binding.handleMessage({ v: 1, m: 'add_bot', code, token: t0 })
    expect(readded['ok']).toBe(true)
    expect(readded['bot_seat']).toBe(1)
    const entry = binding.entries.get(code)!
    const state = entry.game.getState()
    const seats = registry.get(code)?.seats.length ?? -1
    expect(seats).toBe(2)
    expect(state.names.length).toBe(seats)
    expect(state.scores.length).toBe(seats)
    expect(state.racks.length).toBe(seats)
    expect(state.names[1]).toBe(BOT_NAME)
    expect(state.racks[1].length).toBe(7)
    // Re-seating never disturbs the current turn.
    expect(state.turn).toBe(0)
    entry.timer.disarm()
    binding.disarmBot(code)
  })
})
