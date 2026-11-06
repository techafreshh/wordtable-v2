import { describe, it, expect, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { WebSocket } from 'ws'
import {
  RoomRegistry,
  normalizeCode,
  normalizeName,
  generateCode,
  generateToken,
  MAX_SEATS,
} from '../../server/src/rooms'
import { errReply, handleRoomMessage, okReply, startServer } from '../../server/src/ws'

describe('room registry', () => {
  it('creates a room with host seat 0, letter code, and long token', () => {
    const registry = new RoomRegistry()
    const { room, seat } = registry.create('Ann')
    expect(room.code).toMatch(/^[A-Z]{4}$/)
    expect(seat.seat).toBe(0)
    expect(seat.name).toBe('Ann')
    expect(seat.token.length).toBeGreaterThanOrEqual(8)
    expect(room.seats).toHaveLength(1)
  })

  it('seats joins sequentially up to the 4-seat cap', () => {
    const registry = new RoomRegistry()
    const { room } = registry.create('Host')
    const seats: number[] = [0]
    for (let i = 1; i < MAX_SEATS; i++) {
      const res = registry.join(room.code, `P${i}`)
      expect(res.ok).toBe(true)
      if (res.ok) seats.push(res.seat.seat)
    }
    expect(seats).toEqual([0, 1, 2, 3])
    expect(registry.get(room.code)?.seats).toHaveLength(4)
  })

  it('rejects a 5th join with ROOM_FULL', () => {
    const registry = new RoomRegistry()
    const { room } = registry.create('Host')
    for (let i = 1; i < MAX_SEATS; i++) {
      expect(registry.join(room.code, `P${i}`).ok).toBe(true)
    }
    const fifth = registry.join(room.code, 'Extra')
    expect(fifth).toEqual({ ok: false, error: 'ROOM_FULL' })
  })

  it('reattaches idempotently when join carries a known seat token', () => {
    const registry = new RoomRegistry()
    const { room, seat } = registry.create('Host')
    const res = registry.join(room.code, 'SomeoneElse', seat.token)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.seat.seat).toBe(0)
      expect(res.seat.token).toBe(seat.token)
    }
    expect(room.seats).toHaveLength(1)
  })

  it('rejects join with an unknown token as BAD_TOKEN without minting a seat', () => {
    const registry = new RoomRegistry()
    const { room } = registry.create('Host')
    const res = registry.join(room.code, 'Intruder', 'deadbeef'.repeat(4))
    expect(res).toEqual({ ok: false, error: 'BAD_TOKEN' })
    expect(room.seats).toHaveLength(1)
  })

  it('returns NO_ROOM for unknown or missing codes', () => {
    const registry = new RoomRegistry()
    expect(registry.join('ZZZZ', 'Bo')).toEqual({ ok: false, error: 'NO_ROOM' })
    expect(registry.join('', 'Bo')).toEqual({ ok: false, error: 'NO_ROOM' })
    expect(registry.join(undefined, 'Bo')).toEqual({ ok: false, error: 'NO_ROOM' })
    expect(registry.rejoin('ZZZZ', 'whatever')).toEqual({ ok: false, error: 'NO_ROOM' })
  })

  it('returns NO_TOKEN when rejoin carries no token, BAD_TOKEN when unknown', () => {
    const registry = new RoomRegistry()
    const { room } = registry.create('Host')
    expect(registry.rejoin(room.code)).toEqual({ ok: false, error: 'NO_TOKEN' })
    expect(registry.rejoin(room.code, '  ')).toEqual({ ok: false, error: 'NO_TOKEN' })
    expect(registry.rejoin(room.code, 'nope')).toEqual({ ok: false, error: 'BAD_TOKEN' })
  })

  it('rejoins with a known token', () => {
    const registry = new RoomRegistry()
    const { room, seat } = registry.create('Host')
    const res = registry.rejoin(room.code, seat.token)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.seat.seat).toBe(0)
  })
})

describe('normalize helpers', () => {
  it('uppercases and trims codes', () => {
    expect(normalizeCode(' abcd ')).toBe('ABCD')
    expect(normalizeCode(undefined)).toBe('')
  })

  it('truncates names to 16 chars, defaulting to Player', () => {
    expect(normalizeName('  Ann  ')).toBe('Ann')
    expect(normalizeName('x'.repeat(30))).toHaveLength(16)
    expect(normalizeName(undefined)).toBe('Player')
    expect(normalizeName('   ')).toBe('Player')
  })

  it('generates letter-only codes and long tokens', () => {
    expect(generateCode()).toMatch(/^[A-Z]{4}$/)
    expect(generateToken().length).toBeGreaterThanOrEqual(8)
  })
})

describe('envelope dispatcher', () => {
  it('creates a room from the canonical envelope', () => {
    const reply = handleRoomMessage({ v: 1, m: 'create_room', name: 'Ann' }, new RoomRegistry())
    expect(reply.ok).toBe(true)
    expect(reply.m).toBe('create_room')
    expect(reply.code).toMatch(/^[A-Z]{4}$/)
    expect(String(reply.token).length).toBeGreaterThanOrEqual(8)
    expect(reply.seat).toBe(0)
  })

  it('accepts version/method aliases and a missing version as 1', () => {
    const viaAlias = handleRoomMessage({ method: 'create_room', name: 'Bo' }, new RoomRegistry())
    expect(viaAlias.ok).toBe(true)
    expect(viaAlias.code).toMatch(/^[A-Z]{4}$/)
    const viaVersion = handleRoomMessage(
      { version: 1, method: 'create_room', name: 'Bo' },
      new RoomRegistry(),
    )
    expect(viaVersion.ok).toBe(true)
    const mixedCase = handleRoomMessage({ v: 1, m: 'Create_Room', name: 'Bo' }, new RoomRegistry())
    expect(mixedCase.ok).toBe(true)
  })

  it('rejects non-1 versions with BAD_VERSION', () => {
    const reply = handleRoomMessage({ v: 2, m: 'create_room', name: 'Ann' }, new RoomRegistry())
    expect(reply).toMatchObject({ ok: false, error: 'BAD_VERSION', reason: 'BAD_VERSION' })
  })

  it('rejects missing and unknown methods with UNKNOWN_MESSAGE', () => {
    expect(handleRoomMessage({ v: 1 }, new RoomRegistry())).toMatchObject({
      ok: false,
      error: 'UNKNOWN_MESSAGE',
      reason: 'UNKNOWN_MESSAGE',
    })
    const unknown = handleRoomMessage({ v: 1, m: 'frobnicate' }, new RoomRegistry())
    expect(unknown).toMatchObject({ ok: false, error: 'UNKNOWN_MESSAGE', reason: 'UNKNOWN_MESSAGE' })
    expect(unknown.m).toBe('frobnicate')
  })

  it('maps non-object JSON payloads to BAD_JSON', () => {
    for (const payload of ['oops', 42, null, [1, 2]]) {
      expect(handleRoomMessage(payload, new RoomRegistry())).toMatchObject({
        ok: false,
        error: 'BAD_JSON',
        reason: 'BAD_JSON',
      })
    }
  })

  it('joins seats with code/name/token aliases and case-insensitive codes', () => {
    const registry = new RoomRegistry()
    const created = handleRoomMessage({ v: 1, m: 'create_room', name: 'Host' }, registry) as {
      code: string
    }
    const joined = handleRoomMessage(
      {
        v: 1,
        m: 'join_room',
        room_code: String(created.code).toLowerCase(),
        player: 'Bo',
      },
      registry,
    )
    expect(joined.ok).toBe(true)
    expect(joined).toMatchObject({ seat: 1, you: 1, seats: 2, code: created.code })
    expect(String(joined.token).length).toBeGreaterThanOrEqual(8)
  })

  it('enforces the 4-seat cap with ROOM_FULL', () => {
    const registry = new RoomRegistry()
    const created = handleRoomMessage({ v: 1, m: 'create_room', name: 'H' }, registry) as {
      code: string
      token: string
    }
    for (const name of ['A', 'B', 'C']) {
      expect(
        handleRoomMessage({ v: 1, m: 'join_room', code: created.code, name }, registry).ok,
      ).toBe(true)
    }
    expect(handleRoomMessage({ v: 1, m: 'join_room', code: created.code, name: 'E' }, registry))
      .toMatchObject({ ok: false, error: 'ROOM_FULL', reason: 'ROOM_FULL' })
    // A known seat token still reattaches even when the room is full.
    const again = handleRoomMessage(
      { v: 1, m: 'join_room', code: created.code, name: 'X', session: created.token },
      registry,
    )
    expect(again).toMatchObject({ ok: true, seat: 0, you: 0, seats: 4 })
  })

  it('rejects join token mismatches with BAD_TOKEN and unknown rooms with NO_ROOM', () => {
    const registry = new RoomRegistry()
    const created = handleRoomMessage({ v: 1, m: 'create_room', name: 'H' }, registry) as {
      code: string
    }
    expect(
      handleRoomMessage(
        { v: 1, m: 'join_room', code: created.code, name: 'X', token: 'bogus' },
        registry,
      ),
    ).toMatchObject({ ok: false, error: 'BAD_TOKEN', reason: 'BAD_TOKEN' })
    expect(
      handleRoomMessage({ v: 1, m: 'join_room', code: 'QQQQ', name: 'X' }, registry),
    ).toMatchObject({ ok: false, error: 'NO_ROOM', reason: 'NO_ROOM' })
  })

  it('serves rejoin/resync snapshots and guards tokens', () => {
    const registry = new RoomRegistry()
    const created = handleRoomMessage({ v: 1, m: 'create_room', name: 'H' }, registry) as {
      code: string
      token: string
    }
    expect(handleRoomMessage({ v: 1, m: 'rejoin', code: created.code }, registry)).toMatchObject({
      ok: false,
      error: 'NO_TOKEN',
      reason: 'NO_TOKEN',
    })
    expect(
      handleRoomMessage({ v: 1, m: 'rejoin', code: created.code, token: 'bogus' }, registry),
    ).toMatchObject({ ok: false, error: 'BAD_TOKEN', reason: 'BAD_TOKEN' })
    const snap = handleRoomMessage(
      { v: 1, m: 'resync', room: created.code, session_token: created.token },
      registry,
    )
    expect(snap).toMatchObject({
      ok: true,
      seat: 0,
      you: 0,
      seats: 1,
      started: false,
      turn: 0,
      scores: [0],
      rack: [],
      board_tiles: [],
      over: false,
    })
  })

  it('truncates long names to 16 chars', () => {
    const registry = new RoomRegistry()
    const created = handleRoomMessage(
      { v: 1, m: 'create_room', name: 'x'.repeat(30) },
      registry,
    ) as { code: string }
    expect(registry.get(String(created.code))?.seats[0].name).toHaveLength(16)
  })

  it('stubs unbound game methods with BAD_STATE', () => {
    const registry = new RoomRegistry()
    for (const m of ['start_game', 'place_tiles', 'chat', 'emote']) {
      expect(handleRoomMessage({ v: 1, m, code: 'AAAA', token: 't' }, registry)).toMatchObject({
        ok: false,
        error: 'BAD_STATE',
        reason: 'BAD_STATE',
      })
    }
  })

  it('builds ok/err replies with mirrored reason aliases', () => {
    expect(okReply('create_room', { code: 'ABCD' })).toEqual({
      m: 'create_room',
      ok: true,
      code: 'ABCD',
    })
    expect(errReply('join_room', 'NO_ROOM')).toEqual({
      m: 'join_room',
      ok: false,
      error: 'NO_ROOM',
      reason: 'NO_ROOM',
    })
  })
})

describe('live socket parity', () => {
  const sockets: WebSocket[] = []
  const servers: Server[] = []

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      try {
        ws.terminate()
      } catch {
        // already closed
      }
    }
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  async function startEphemeral(): Promise<number> {
    const server = startServer(0)
    servers.push(server)
    await new Promise<void>((resolve) => {
      if (server.listening) resolve()
      else server.once('listening', () => resolve())
    })
    const addr = server.address()
    if (typeof addr === 'object' && addr !== null) return addr.port
    throw new Error('ephemeral server has no port')
  }

  async function connect(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', (err) => reject(err))
    })
    return ws
  }

  function nextRaw(ws: WebSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for reply')), 3000)
      ws.once('message', (data) => {
        clearTimeout(timer)
        resolve(typeof data === 'string' ? data : data.toString())
      })
    })
  }

  async function rpc(ws: WebSocket, payload: unknown): Promise<Record<string, unknown>> {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const pending = nextRaw(ws)
    ws.send(text)
    return JSON.parse(await pending) as Record<string, unknown>
  }

  it('answers bare ping with exactly PONG and no ok field', async () => {
    const port = await startEphemeral()
    const ws = await connect(port)
    const pending = nextRaw(ws)
    ws.send('  PING  ')
    const raw = await pending
    expect(raw).toBe('PONG')
    expect(raw).not.toContain('ok')
  })

  it('runs create, three joins, then ROOM_FULL for the 5th seat', async () => {
    const port = await startEphemeral()
    const ws = await connect(port)
    const created = await rpc(ws, { v: 1, m: 'create_room', name: 'Ann' })
    expect(created.ok).toBe(true)
    expect(created.code).toMatch(/^[A-Z]{4}$/)
    expect(String(created.token).length).toBeGreaterThanOrEqual(8)
    const code = created.code as string
    for (let i = 0; i < 3; i++) {
      const joined = await rpc(await connect(port), { v: 1, m: 'join_room', code, name: `P${i}` })
      expect(joined).toMatchObject({ ok: true, seat: i + 1, seats: i + 2 })
    }
    const fifth = await rpc(await connect(port), { v: 1, m: 'join_room', code, name: 'Extra' })
    expect(fifth).toMatchObject({ ok: false, error: 'ROOM_FULL' })
  })

  it('accepts the method alias over the wire', async () => {
    const port = await startEphemeral()
    const ws = await connect(port)
    const created = await rpc(ws, { method: 'create_room', name: 'Bo' })
    expect(created.ok).toBe(true)
    expect(created.code).toMatch(/^[A-Z]{4}$/)
  })

  it('reports BAD_TOKEN for a bogus join token over the wire', async () => {
    const port = await startEphemeral()
    const ws = await connect(port)
    const created = await rpc(ws, { v: 1, m: 'create_room', name: 'Host' })
    const denied = await rpc(ws, {
      v: 1,
      m: 'join_room',
      code: created.code,
      name: 'X',
      token: 'bogus',
    })
    expect(denied).toMatchObject({ ok: false, error: 'BAD_TOKEN' })
  })
})
