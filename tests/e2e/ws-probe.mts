// Network smoke probe (issue #19) — scripted play over a real socket:
// create → join → start → legal place → illegal reject → pass → drop →
// rejoin-identical → six-scoreless end. Prints REJOIN_IDENTICAL and
// SIX_SCORELESS_END on success; exits non-zero on any contract or timing
// violation (median server frame <50ms, drop→rejoin <3000ms on localhost).
// Runs in-process against startServer(0) so no port is ever fixed here.

import type { Server } from 'node:http'
import { performance } from 'node:perf_hooks'
import { WebSocket } from 'ws'
import { startServer } from '../../server/src/ws'

type Reply = Record<string, unknown>

function fail(msg: string): never {
  console.error(`probe FAIL: ${msg}`)
  process.exit(1)
}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg)
}

function step(name: string, detail = ''): void {
  console.log(`probe step: ${name}${detail === '' ? '' : ` ${detail}`}`)
}

// Send→reply latency per move; the median must stay under 50ms.
const frameMs: number[] = []

async function startEphemeral(): Promise<{ server: Server; port: number }> {
  const server = startServer(0)
  await new Promise<void>((resolve) => {
    if (server.listening) resolve()
    else server.once('listening', () => resolve())
  })
  const addr = server.address()
  check(typeof addr === 'object' && addr !== null, 'ephemeral server has no port')
  return { server, port: (addr as { port: number }).port }
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', (err) => reject(err))
  })
}

// Reply-first protocol: the server always sends the request reply before
// any broadcast, and unlistened broadcasts are dropped, so the first frame
// after a send is always this request's reply.
function rpc(ws: WebSocket, payload: unknown): Promise<Reply> {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const t0 = performance.now()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for reply')), 5000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      frameMs.push(performance.now() - t0)
      try {
        resolve(JSON.parse(String(data)) as Reply)
      } catch (err) {
        reject(err)
      }
    })
    ws.send(text)
  })
}

function median(xs: number[]): number {
  check(xs.length > 0, 'no frames measured')
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

function pickSnapshot(reply: Reply): string {
  return JSON.stringify({
    turn: reply['turn'],
    scores: reply['scores'],
    board_tiles: reply['board_tiles'],
    rack: reply['rack'],
  })
}

async function main(): Promise<void> {
  check(process.env['WORDTABLE_DEBUG'] === '1', 'probe needs WORDTABLE_DEBUG=1 for debug_set_rack')
  const { server, port } = await startEphemeral()
  step('server up', `port=${port}`)
  let wsA = await connect(port)
  const wsB = await connect(port)
  step('sockets open', 'A+B')

  // create → join → start.
  const created = await rpc(wsA, { v: 1, m: 'create_room', name: 'Ann' })
  check(created['ok'] === true, `create_room refused: ${JSON.stringify(created)}`)
  const code = String(created['code'] ?? '')
  const t0 = String(created['token'] ?? '')
  check(/^[A-Z]{4}$/.test(code), `bad room code: ${code}`)
  check(t0.length >= 8, 'host token too short')
  check(created['seat'] === 0, 'host must be seat 0')
  step('create', `code=${code} seat=0`)

  const joined = await rpc(wsB, { v: 1, m: 'join_room', code, name: 'Bo' })
  check(joined['ok'] === true, `join_room refused: ${JSON.stringify(joined)}`)
  const t1 = String(joined['token'] ?? '')
  check(joined['seat'] === 1, 'guest must be seat 1')
  step('join', 'seat=1')

  const started = await rpc(wsA, { v: 1, m: 'start_game', code, token: t0 })
  check(started['ok'] === true, `start_game refused: ${JSON.stringify(started)}`)
  step('start', `turn=${String(started['turn'])}`)

  // Legal first move: HELLO across the center star H8..L8.
  const pinA = await rpc(wsA, {
    v: 1,
    m: 'debug_set_rack',
    code,
    token: t0,
    seat: 0,
    rack: ['H', 'E', 'L', 'L', 'O', 'A', 'B'],
  })
  check(pinA['ok'] === true, `debug_set_rack refused: ${JSON.stringify(pinA)}`)
  const placed = await rpc(wsA, {
    v: 1,
    m: 'place_tiles',
    code,
    token: t0,
    tiles: [
      { square: 'H8', face: 'H' },
      { square: 'I8', face: 'E' },
      { square: 'J8', face: 'L' },
      { square: 'K8', face: 'L' },
      { square: 'L8', face: 'O' },
    ],
  })
  check(placed['ok'] === true, `legal place refused: ${JSON.stringify(placed)}`)
  check(placed['accepted'] === true, 'legal place must carry accepted:true')
  const helloPoints = placed['points']
  check(typeof helloPoints === 'number' && helloPoints > 0, 'HELLO must score points>0')
  check(placed['turn'] === 1, `turn must advance to 1, got ${String(placed['turn'])}`)
  step('legal place', `HELLO points=${helloPoints} turn=1`)

  // Illegal reject: connected but off-lexicon XYZQ under HELLO.
  const pinB = await rpc(wsA, {
    v: 1,
    m: 'debug_set_rack',
    code,
    token: t0,
    seat: 1,
    rack: ['X', 'Y', 'Z', 'Q', 'J', 'K', 'V'],
  })
  check(pinB['ok'] === true, `debug_set_rack seat1 refused: ${JSON.stringify(pinB)}`)
  const illegal = await rpc(wsB, {
    v: 1,
    m: 'place_tiles',
    code,
    token: t1,
    tiles: [
      { square: 'H9', face: 'X' },
      { square: 'I9', face: 'Y' },
      { square: 'J9', face: 'Z' },
      { square: 'K9', face: 'Q' },
    ],
  })
  check(
    illegal['ok'] === false && illegal['error'] === 'NOT_IN_LEXICON',
    `expected NOT_IN_LEXICON, got ${JSON.stringify(illegal)}`,
  )
  step('illegal reject', 'NOT_IN_LEXICON')

  // Scoreless pass: scores keep the HELLO side, turn returns to seat 0.
  const passed = await rpc(wsB, { v: 1, m: 'pass', code, token: t1 })
  check(passed['ok'] === true, `pass refused: ${JSON.stringify(passed)}`)
  check(passed['accepted'] === true, 'pass must carry accepted:true')
  check(
    JSON.stringify(passed['scores']) === JSON.stringify([helloPoints, 0]),
    `pass must be scoreless, got ${JSON.stringify(passed['scores'])}`,
  )
  check(passed['turn'] === 0, `turn must return to 0, got ${String(passed['turn'])}`)
  step('pass', `scores=[${helloPoints},0] turn=0`)

  // Forced drop: terminate seat 0, rejoin on a fresh socket, compare.
  const before = await rpc(wsA, { v: 1, m: 'rejoin', code, token: t0 })
  check(before['ok'] === true, `pre-drop rejoin refused: ${JSON.stringify(before)}`)
  const beforeSnap = pickSnapshot(before)
  const dropT0 = performance.now()
  wsA.terminate()
  wsA = await connect(port)
  const after = await rpc(wsA, { v: 1, m: 'rejoin', code, token: t0 })
  const reconnectMs = performance.now() - dropT0
  check(after['ok'] === true, `post-drop rejoin refused: ${JSON.stringify(after)}`)
  check(pickSnapshot(after) === beforeSnap, 'rejoin snapshot differs from pre-drop snapshot')
  console.log('REJOIN_IDENTICAL')
  step('rejoin', `reconnect_ms=${reconnectMs.toFixed(1)}`)
  check(reconnectMs < 3000, `reconnect ${reconnectMs.toFixed(1)}ms exceeds 3000ms`)

  // Six-scoreless end: streak is 1 (seat 1 pass), so five more passes end it.
  let over = false
  for (let i = 0; i < 10 && !over; i++) {
    const seat = i % 2
    const reply = await rpc(seat === 0 ? wsA : wsB, {
      v: 1,
      m: 'pass',
      code,
      token: seat === 0 ? t0 : t1,
    })
    check(reply['ok'] === true, `endgame pass ${i} refused: ${JSON.stringify(reply)}`)
    if (reply['over'] === true) over = true;
  }
  check(over, 'six-scoreless end never arrived')
  console.log('SIX_SCORELESS_END')
  step('six-scoreless end', 'over=true')

  const med = median(frameMs)
  step('timings', `median_frame_ms=${med.toFixed(2)} n=${frameMs.length}`)
  check(med < 50, `median server frame ${med.toFixed(2)}ms exceeds 50ms`)

  for (const ws of [wsA, wsB]) {
    try {
      ws.terminate()
    } catch {
      // Teardown never fails the probe.
    }
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  step('done', 'probe exits 0')
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
});
