import { describe, it, expect } from 'vitest'
import { RoomRegistry } from '../../server/src/rooms'
import { createBinding, viewFor, type RoomReply } from '../../server/src/binding'

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

function startTwoSeats(binding: ReturnType<typeof createBinding>, seed = 42) {
  const c0 = binding.handleMessage({ v: 1, m: 'create_room', name: 'Ann' }) as RoomReply & {
    code: string
    token: string
  }
  const code = String(c0['code'])
  const t0 = String(c0['token'])
  const j1 = binding.handleMessage({ v: 1, m: 'join_room', code, name: 'Bo' }) as RoomReply & {
    token: string
  }
  const t1 = String(j1['token'])
  const s = binding.handleMessage({ v: 1, m: 'start_game', code, token: t0, seed })
  return { code, t0, t1, started: s }
}

describe('binding private racks', () => {
  it('seat0 get_rack returns 7 tiles and seat1 broadcast holds only its own rack', () => {
    const { binding, sent } = makeBinding()
    const { code, t0, t1, started } = startTwoSeats(binding)
    expect(started['ok']).toBe(true)
    // Pin distinctive racks: seat0 rare letters, seat1 plain As.
    expect(
      binding.handleMessage({
        v: 1,
        m: 'debug_set_rack',
        code,
        token: t0,
        seat: 0,
        rack: ['Q', 'Z', 'J', 'X', 'K', 'V', 'B'],
      })['ok'],
    ).toBe(true)
    expect(
      binding.handleMessage({
        v: 1,
        m: 'debug_set_rack',
        code,
        token: t0,
        seat: 1,
        rack: ['A', 'A', 'A', 'A', 'A', 'A', 'A'],
      })['ok'],
    ).toBe(true)
    sent.length = 0
    const r0 = binding.handleMessage({ v: 1, m: 'get_rack', code, token: t0 }) as RoomReply & {
      rack: unknown
    }
    expect(r0['ok']).toBe(true)
    expect(Array.isArray(r0['rack'])).toBe(true)
    expect((r0['rack'] as unknown[]).length).toBe(7)
    // get_rack is requestor-only: no broadcast frames leak.
    expect(sent).toHaveLength(0)
    // A public turn advance fans out personalized frames.
    const p = binding.handleMessage({ v: 1, m: 'pass', code, token: t0 })
    expect(p['ok']).toBe(true)
    const f0 = sent.find((s) => s.seat === 0)?.frame
    const f1 = sent.find((s) => s.seat === 1)?.frame
    expect(f0).toBeDefined()
    expect(f1).toBeDefined()
    expect(f0?.['you']).toBe(0)
    expect(f1?.['you']).toBe(1)
    const rack0 = f0?.['rack'] as unknown[]
    const rack1 = f1?.['rack'] as unknown[]
    expect(rack0).toHaveLength(7)
    expect(rack1).toHaveLength(7)
    // Seat1 frame carries only As, none of seat0's rare letters.
    expect(rack1).toEqual(['A', 'A', 'A', 'A', 'A', 'A', 'A'])
    for (const letter of ['Q', 'Z', 'J', 'X', 'K', 'V', 'B']) {
      expect(rack1).not.toContain(letter)
    }
    expect(JSON.stringify(f1?.['rack'])).not.toContain('Q')
    // Seat0 frame keeps its own pinned rack.
    expect(rack0).toEqual(['Q', 'Z', 'J', 'X', 'K', 'V', 'B'])
    void t1
  })

  it('place_tiles with an illegal word replies NOT_IN_LEXICON', () => {
    const { binding } = makeBinding((w) => w !== 'XYZQ')
    const { code, t0 } = startTwoSeats(binding, 7)
    expect(
      binding.handleMessage({
        v: 1,
        m: 'debug_set_rack',
        code,
        token: t0,
        seat: 0,
        rack: ['X', 'Y', 'Z', 'Q', 'A', 'B', 'C'],
      })['ok'],
    ).toBe(true)
    const reply = binding.handleMessage({
      v: 1,
      m: 'place_tiles',
      code,
      token: t0,
      tiles: [
        { square: 'G8', face: 'X' },
        { square: 'H8', face: 'Y' },
        { square: 'I8', face: 'Z' },
        { square: 'J8', face: 'Q' },
      ],
    })
    expect(reply['ok']).toBe(false)
    expect(reply['error']).toBe('NOT_IN_LEXICON')
    expect(reply['reason']).toBe('NOT_IN_LEXICON')
  })

  it('H8 and 8H alias forms place the same square (alias case)', () => {
    const setup = (squares: string[]) => {
      const { binding } = makeBinding(() => true)
      const { code, t0 } = startTwoSeats(binding, 99)
      binding.handleMessage({
        v: 1,
        m: 'debug_set_rack',
        code,
        token: t0,
        seat: 0,
        rack: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      })
      const tiles = squares.map((square, i) => ({
        square,
        face: ['A', 'B'][i],
      }))
      return binding.handleMessage({ v: 1, m: 'place', code, token: t0, tiles })
    }
    const viaLetterFirst = setup(['H8', 'I8'])
    const viaDigitFirst = setup(['8h', '8i'])
    expect(viaLetterFirst['ok']).toBe(true)
    expect(viaDigitFirst['ok']).toBe(true)
    expect(viaDigitFirst['points']).toBe(viaLetterFirst['points'])
    expect(viaDigitFirst['turn']).toBe(viaLetterFirst['turn'])
    expect(viaDigitFirst['scores']).toEqual(viaLetterFirst['scores'])
  })

  it('pass is scoreless: scores unchanged and turn advances', () => {
    const { binding } = makeBinding()
    const { code, t0 } = startTwoSeats(binding)
    const before = binding.handleMessage({ v: 1, m: 'get_rack', code, token: t0 }) as RoomReply
    const turnBefore = before['turn'] as number
    expect(turnBefore).toBe(0)
    const reply = binding.handleMessage({ v: 1, m: 'pass', code, token: t0 }) as RoomReply
    expect(reply['ok']).toBe(true)
    expect(reply['accepted']).toBe(true)
    expect(reply['turn']).toBe(1)
    expect(reply['scores']).toEqual([0, 0])
    expect(reply['over']).toBe(false)
  })

  it('viewFor never exposes another seat rack', () => {
    const { binding } = makeBinding()
    const { code, t0 } = startTwoSeats(binding)
    binding.handleMessage({
      v: 1,
      m: 'debug_set_rack',
      code,
      token: t0,
      seat: 0,
      rack: ['Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q'],
    })
    binding.handleMessage({
      v: 1,
      m: 'debug_set_rack',
      code,
      token: t0,
      seat: 1,
      rack: ['E', 'E', 'E', 'E', 'E', 'E', 'E'],
    })
    const entry = binding.entries.get(code)
    expect(entry).toBeDefined()
    if (!entry) return
    const v0 = viewFor(entry, 0) as RoomReply
    const v1 = viewFor(entry, 1) as RoomReply
    expect(v0['rack']).toEqual(['Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q'])
    expect(v1['rack']).toEqual(['E', 'E', 'E', 'E', 'E', 'E', 'E'])
    expect(JSON.stringify(v1)).not.toContain('Q')
  })
})

describe('binding chat and emotes (issue #16)', () => {
  function lobbyTwoSeats(name0 = 'Ann', name1 = 'Bo') {
    const { registry, binding, sent } = makeBinding()
    const c0 = binding.handleMessage({ v: 1, m: 'create_room', name: name0 }) as RoomReply & {
      code: string
      token: string
    }
    const code = String(c0['code'])
    const t0 = String(c0['token'])
    const j1 = binding.handleMessage({ v: 1, m: 'join_room', code, name: name1 }) as RoomReply & {
      token: string
    }
    const t1 = String(j1['token'])
    void registry
    return { binding, sent, code, t0, t1 }
  }

  it('truncates 250-char chat to 200 chars and fans out to both seats', () => {
    const { binding, sent, code, t0 } = lobbyTwoSeats()
    sent.length = 0
    const long = 'x'.repeat(250)
    const reply = binding.handleMessage({ v: 1, m: 'chat', code, token: t0, text: long })
    expect(reply['ok']).toBe(true)
    expect(reply['chat_ok']).toBe(true)
    expect(String(reply['text'])).toHaveLength(200)
    expect(reply['from']).toBe('Ann')
    expect(typeof reply['ts']).toBe('number')
    // Broadcast reaches every seat with the same truncated text.
    expect(sent).toHaveLength(2)
    for (const s of sent) {
      expect(s.frame['m']).toBe('chat')
      expect(s.frame['code']).toBe(code)
      expect(String(s.frame['text'])).toHaveLength(200)
      expect(s.frame['from']).toBe('Ann')
    }
  })

  it('fans out lobby chat before start_game identically to table chat', () => {
    const { binding, sent, code, t0, t1 } = lobbyTwoSeats()
    sent.length = 0
    const lobbyReply = binding.handleMessage({ v: 1, m: 'chat', code, token: t1, message: 'gl hf' })
    expect(lobbyReply['ok']).toBe(true)
    expect(lobbyReply['from']).toBe('Bo')
    expect(sent).toHaveLength(2)
    expect(sent.map((s) => s.seat).sort()).toEqual([0, 1])
    for (const s of sent) expect(s.frame['text']).toBe('gl hf')
    // Same fan-out after the game starts.
    binding.handleMessage({ v: 1, m: 'start_game', code, token: t0 })
    sent.length = 0
    const tableReply = binding.handleMessage({ v: 1, m: 'chat', code, token: t0, body: 'your move' })
    expect(tableReply['ok']).toBe(true)
    expect(sent).toHaveLength(2)
    for (const s of sent) expect(s.frame['text']).toBe('your move')
  })

  it('rejects blank, whitespace, missing and non-string chat with BAD_TEXT', () => {
    const { binding, code, t0 } = lobbyTwoSeats()
    for (const bad of [
      { v: 1, m: 'chat', code, token: t0, text: '' },
      { v: 1, m: 'chat', code, token: t0, text: '   ' },
      { v: 1, m: 'chat', code, token: t0 },
      { v: 1, m: 'chat', code, token: t0, text: 42 },
      { v: 1, m: 'emote', code, token: t0, emote: '  ' },
      { v: 1, m: 'emote', code, token: t0 },
    ]) {
      const reply = binding.handleMessage(bad)
      expect(reply).toMatchObject({ ok: false, error: 'BAD_TEXT', reason: 'BAD_TEXT' })
    }
  })

  it('emotes carry the wire substring emote\":\"👏\" and mirror text', () => {
    const { binding, sent, code, t0 } = lobbyTwoSeats()
    sent.length = 0
    const reply = binding.handleMessage({ v: 1, m: 'emote', code, token: t0, emote: '👏' })
    expect(reply['ok']).toBe(true)
    expect(reply['emote_ok']).toBe(true)
    expect(reply['emote']).toBe('👏')
    expect(reply['text']).toBe('👏')
    expect(sent).toHaveLength(2)
    for (const s of sent) {
      expect(s.frame['m']).toBe('emote')
      expect(JSON.stringify(s.frame)).toContain('emote\":\"👏')
      expect(s.frame['text']).toBe('👏')
    }
  })

  it('accepts the text/message alias for emotes', () => {
    const { binding, code, t0 } = lobbyTwoSeats()
    const reply = binding.handleMessage({ v: 1, m: 'emote', code, token: t0, text: '😂' })
    expect(reply['ok']).toBe(true)
    expect(reply['emote']).toBe('😂')
  })

  it('caps a 20-char join name to a 16-char chat from', () => {
    const { binding, sent, code, t0 } = lobbyTwoSeats('x'.repeat(20), 'Bo')
    sent.length = 0
    const reply = binding.handleMessage({ v: 1, m: 'chat', code, token: t0, text: 'hi' })
    expect(reply['ok']).toBe(true)
    expect(String(reply['from'])).toHaveLength(16)
    for (const s of sent) expect(String(s.frame['from'])).toHaveLength(16)
  })

  it('requires auth: unknown rooms and bad tokens never fan out', () => {
    const { binding, sent } = lobbyTwoSeats()
    sent.length = 0
    expect(
      binding.handleMessage({ v: 1, m: 'chat', code: 'ZZZZ', token: 'nope', text: 'hi' }),
    ).toMatchObject({ ok: false, error: 'NO_ROOM' })
    expect(
      binding.handleMessage({ v: 1, m: 'emote', code: 'ZZZZ', token: 'nope', emote: '👏' }),
    ).toMatchObject({ ok: false, error: 'NO_ROOM' })
    expect(sent).toHaveLength(0)
  })
})
