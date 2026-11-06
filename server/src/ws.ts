// Node server — HTTP + ws on one port. Keep this module free of
// DOM/Three imports so it never pulls client bundles into the server.
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { parsePortArg, resolvePort } from './config.js'
import {
  RoomRegistry,
  normalizeCode,
  normalizeName,
  normalizeToken,
} from './rooms.js'

export const HEALTH_BODY = JSON.stringify({ ok: true })

export function isPingMessage(data: unknown): boolean {
  try {
    let text: string
    if (typeof data === 'string') {
      text = data
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data as Buffer[]).toString()
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(data).toString()
    } else {
      text = String(data)
    }
    return text.trim().toLowerCase() === 'ping'
  } catch {
    return false
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export function resolveStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '../..')
  const built = join(repoRoot, 'dist/client')
  try {
    if (existsSync(join(built, 'index.html'))) return built
  } catch {
    // fall through to source dir
  }
  return join(repoRoot, 'client')
}

function serveFile(res: ServerResponse, filePath: string, contentType: string): void {
  try {
    const body = readFileSync(filePath)
    res.writeHead(200, { 'content-type': contentType })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
}

export function createRequestHandler(staticRoot: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const rawUrl = req.url ?? '/'
    const pathname = rawUrl.split('?', 1)[0]
    const method = req.method ?? 'GET'

    if (pathname === '/health') {
      if (method !== 'GET') {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(HEALTH_BODY)
      return
    }

    if (method !== 'GET') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveFile(res, join(staticRoot, 'index.html'), 'text/html')
      return
    }

    let decoded = pathname
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const rel = normalize(decoded).replace(/^[/\\]+/, '')
    const filePath = join(staticRoot, rel)
    if (rel === '' || !filePath.startsWith(staticRoot)) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    try {
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    serveFile(res, filePath, contentType)
  }
}

// v1 envelope dispatcher (frozen docs/protocol.md). Handles only the room
// harness trio — create_room, join_room, rejoin/resync — plus envelope
// errors. Every other documented game method is an explicit not-yet-bound
// stub answering BAD_STATE until game binding lands.
export type RoomReply = Record<string, unknown>

export function okReply(m: string, fields: RoomReply = {}): RoomReply {
  return { m, ok: true, ...fields }
}

export function errReply(m: string, error: string): RoomReply {
  return { m, ok: false, error, reason: error }
}

// Case-insensitive lookup on the key spelling after trim: `CODE`,
// `Room_Code`, `METHOD` etc. all resolve to their canonical field.
function getField(obj: RoomReply, ...names: string[]): unknown {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()))
  for (const key of Object.keys(obj)) {
    if (wanted.has(key.trim().toLowerCase())) return obj[key]
  }
  return undefined
}

// Missing v/version means 1; a present version not equal to 1 is BAD_VERSION.
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

// Documented game methods with no binding yet in this harness lap.
const UNBOUND_METHODS = new Set([
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

export function handleRoomMessage(msg: unknown, registry: RoomRegistry): RoomReply {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    return errReply('unknown', 'BAD_JSON')
  }
  const obj = msg as RoomReply
  const method = normalizeMethod(obj)
  const echoM =
    method === null ? 'unknown' : KNOWN_METHODS.has(method.canonical) ? method.canonical : method.raw
  if (normalizeVersion(obj) === 'BAD') return errReply(echoM, 'BAD_VERSION')
  if (method === null) return errReply('unknown', 'UNKNOWN_MESSAGE')
  if (!KNOWN_METHODS.has(method.canonical)) return errReply(method.raw, 'UNKNOWN_MESSAGE')
  const m = method.canonical
  if (UNBOUND_METHODS.has(m)) return errReply(m, 'BAD_STATE')
  if (m === 'create_room') {
    const name = normalizeName(getField(obj, 'name', 'player', 'player_name'))
    const { room, seat } = registry.create(name)
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
  // rejoin / resync: minimal harness snapshot; game binding enriches it later.
  const code = normalizeCode(getField(obj, 'code', 'room', 'room_code'))
  const token = normalizeToken(getField(obj, 'token', 'session', 'session_token'))
  const res = registry.rejoin(code, token)
  if (!res.ok) return errReply('rejoin', res.error)
  return okReply('rejoin', {
    code: res.room.code,
    token: res.seat.token,
    seat: res.seat.seat,
    you: res.seat.seat,
    seats: res.room.seats.length,
    started: false,
    turn: 0,
    scores: res.room.seats.map(() => 0),
    rack: [],
    board_tiles: [],
    over: false,
  })
}

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })
  const registry = new RoomRegistry()
  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      let text: string
      if (typeof data === 'string') {
        text = data
      } else if (Array.isArray(data)) {
        text = Buffer.concat(data as unknown as Buffer[]).toString()
      } else {
        text = (data as { toString(): string }).toString()
      }
      if (isPingMessage(text)) {
        socket.send('PONG')
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        socket.send(JSON.stringify(errReply('unknown', 'BAD_JSON')))
        return
      }
      socket.send(JSON.stringify(handleRoomMessage(parsed, registry)))
    })
  })
  return wss
}

export function startServer(port: number, staticRoot?: string): Server {
  const root = staticRoot ?? resolveStaticRoot()
  const server = createHttpServer(createRequestHandler(root))
  attachWebSocket(server)
  server.listen(port, () => {
    console.log(`wordtable server listening on :${port}`)
  })
  return server
}

function isMainModule(): boolean {
  try {
    const self = fileURLToPath(import.meta.url)
    const entry = process.argv[1] ? resolve(process.argv[1]) : ''
    return entry !== '' && resolve(self) === entry
  } catch {
    return false
  }
}

if (isMainModule() && !process.env.VITEST) {
  const cliPort = parsePortArg(process.argv.slice(2))
  const port = resolvePort(cliPort)
  startServer(port)
}
