import { describe, it, expect } from 'vitest'
import { RoomRegistry } from '../../server/src/rooms'
import { clampTurnSecs, TurnTimer } from '../../server/src/timers'
import { createBinding, type RoomReply } from '../../server/src/binding'

describe('clampTurnSecs', () => {
  it('maps the clamp table (0, 3601, abc -> 90; 1, 3600 stay)', () => {
    expect(clampTurnSecs(0)).toBe(90)
    expect(clampTurnSecs(3601)).toBe(90)
    expect(clampTurnSecs('abc')).toBe(90)
    expect(clampTurnSecs(1)).toBe(1)
    expect(clampTurnSecs(3600)).toBe(3600)
    expect(clampTurnSecs(90)).toBe(90)
    expect(clampTurnSecs(undefined)).toBe(90)
    expect(clampTurnSecs(null)).toBe(90)
    expect(clampTurnSecs(NaN)).toBe(90)
  })
})

describe('TurnTimer', () => {
  it('fires once and is a no-op after disarm', async () => {
    const timer = new TurnTimer()
    let fires = 0
    timer.arm(10, () => {
      fires += 1
    })
    expect(timer.deadlineMs).not.toBeNull()
    await new Promise((r) => setTimeout(r, 40))
    expect(fires).toBe(1)
    timer.disarm()
    expect(timer.deadlineMs).toBeNull()
    // Expiry after disarm never fires.
    timer.arm(10, () => {
      fires += 1
    })
    timer.disarm()
    await new Promise((r) => setTimeout(r, 40))
    expect(fires).toBe(1)
  })

  it('re-arm replaces the pending deadline (no double-fire)', async () => {
    const timer = new TurnTimer()
    let fires = 0
    timer.arm(50, () => {
      fires += 1
    })
    timer.arm(50, () => {
      fires += 1
    })
    await new Promise((r) => setTimeout(r, 120))
    expect(fires).toBe(1)
    timer.disarm()
  })
})

describe('turn clock auto-pass', () => {
  it('timer_off + turn_secs:1 idles ~1500ms to one auto_pass:true and advances turn', async () => {
    const registry = new RoomRegistry()
    const sent: Array<{ seat: number; frame: RoomReply }> = []
    const binding = createBinding(registry, {
      isWord: () => true,
      allowDebug: true,
      send: (seat, frame) => {
        sent.push({ seat, frame })
      },
    })
    const created = binding.handleMessage({ v: 1, m: 'create_room', name: 'Ann' }) as RoomReply
    const code = String(created['code'])
    const t0 = String(created['token'])
    const joined = binding.handleMessage({ v: 1, m: 'join_room', code, name: 'Bo' }) as RoomReply
    expect(joined['ok']).toBe(true)
    const started = binding.handleMessage({
      v: 1,
      m: 'start_game',
      code,
      token: t0,
      options: { timer_off: true, turn_secs: 1 },
    }) as RoomReply
    expect(started['ok']).toBe(true)
    expect(started['turn']).toBe(0)
    sent.length = 0
    await new Promise((r) => setTimeout(r, 1500))
    const auto = sent.filter((s) => s.frame['auto_pass'] === true)
    expect(auto.length).toBeGreaterThanOrEqual(1)
    // Exactly one auto-pass per seat fan-out for the single expired turn.
    const seatsFired = new Set(auto.map((s) => s.seat))
    expect(seatsFired.has(0)).toBe(true)
    expect(seatsFired.has(1)).toBe(true)
    const turns = auto.map((s) => s.frame['turn'])
    for (const t of turns) expect(t).toBe(1)
    // Turn advanced exactly once: seat1 to move.
    const entry = binding.entries.get(code)
    expect(entry?.game.getState().turn).toBe(1)
    // No runaway double-fire within the window: at most one expiry per seat.
    const perSeat = sent.filter((s) => s.frame['auto_pass'] === true && s.seat === 0)
    expect(perSeat.length).toBe(1)
    entry?.timer.disarm()
  }, 10000)

  it('a legit move re-arms instead of double-firing', async () => {
    const registry = new RoomRegistry()
    const sent: Array<{ seat: number; frame: RoomReply }> = []
    const binding = createBinding(registry, {
      isWord: () => true,
      allowDebug: true,
      send: (seat, frame) => {
        sent.push({ seat, frame })
      },
    })
    const created = binding.handleMessage({ v: 1, m: 'create_room', name: 'Ann' }) as RoomReply
    const code = String(created['code'])
    const t0 = String(created['token'])
    binding.handleMessage({ v: 1, m: 'join_room', code, name: 'Bo' })
    binding.handleMessage({
      v: 1,
      m: 'start_game',
      code,
      token: t0,
      options: { timer_off: true, turn_secs: 1 },
    })
    sent.length = 0
    // Legit pass re-arms the 1s clock; the stale deadline must not fire too.
    const passed = binding.handleMessage({ v: 1, m: 'pass', code, token: t0 }) as RoomReply
    expect(passed['ok']).toBe(true)
    expect(passed['turn']).toBe(1)
    sent.length = 0
    await new Promise((r) => setTimeout(r, 1500))
    const auto = sent.filter((s) => s.frame['auto_pass'] === true && s.seat === 0)
    expect(auto.length).toBe(1)
    expect(auto[0].frame['turn']).toBe(0)
    binding.entries.get(code)?.timer.disarm()
  }, 10000)
})
