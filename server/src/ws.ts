// Node server — HTTP + ws on one port. Keep this module free of
// DOM/Three imports so it never pulls client bundles into the server.
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { parsePortArg, resolvePort } from './config.js'
import {
  RoomRegistry,
  normalizeCode,
  normalizeToken,
} from './rooms.js'
import { createBinding, type Binding, type RoomReply } from './binding.js'
import { Dictionary } from '../../shared/engine/dictionary.js'
import type { Lexicon } from '../../shared/engine/rules.js'

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
    }
    const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    serveFile(res, filePath, contentType)
  }
}

// v1 envelope dispatcher (frozen docs/protocol.md). Room ownership lives in
// RoomRegistry; game authority lives in the binding (LocalGame per room).
// Replies echo `m` and carry mirrored `error`/`reason` on failure.
export type { RoomReply } from './binding.js'

export function okReply(m: string, fields: RoomReply = {}): RoomReply {
  return { m, ok: true, ...fields }
}

export function errReply(m: string, error: string): RoomReply {
  return { m, ok: false, error, reason: error }
}

// One binding per registry so direct handleRoomMessage calls (unit tests)
// keep game state across frames without any socket plumbing.
const bindingsByRegistry = new WeakMap<RoomRegistry, Binding>()

function stubLexicon(): Lexicon {
  return () => true
}

export function getBindingForRegistry(registry: RoomRegistry): Binding {
  let binding = bindingsByRegistry.get(registry)
  if (!binding) {
    binding = createBinding(registry, {
      isWord: stubLexicon(),
      allowDebug: undefined,
    })
    bindingsByRegistry.set(registry, binding)
  }
  return binding
}

export function bindRegistryForTesting(registry: RoomRegistry, binding: Binding): void {
  bindingsByRegistry.set(registry, binding)
}

export function handleRoomMessage(
  msg: unknown,
  registry: RoomRegistry,
  binding?: Binding,
): RoomReply {
  const active = binding ?? getBindingForRegistry(registry)
  return active.handleMessage(msg)
}

function getField(obj: RoomReply, ...names: string[]): unknown {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()))
  for (const key of Object.keys(obj)) {
    if (wanted.has(key.trim().toLowerCase())) return obj[key]
  }
  return undefined
}

function loadLexiconSync(): Lexicon | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const repoRoot = resolve(here, '../..')
    for (const candidate of ['dictionaries/sowpods.txt', 'assets/sowpods.txt']) {
      try {
        const text = readFileSync(join(repoRoot, candidate), 'utf8')
        const words = new Set<string>()
        for (const line of text.split(/\r?\n/)) {
          const w = line.trim().toUpperCase()
          if (w !== '' && /^[A-Z]+$/.test(w)) words.add(w)
        }
        if (words.size > 0) return (w: string) => {
          const t = w.trim().toUpperCase()
          return t !== '' && /^[A-Z]+$/.test(t) && words.has(t)
        }
      } catch {
        // try next candidate
      }
    }
    return null
  } catch {
    return null
  }
}

async function loadLexicon(): Promise<Lexicon> {
  const sync = loadLexiconSync()
  if (sync) return sync
  try {
    const dict = await Dictionary.loadFromFile()
    return (w: string) => dict.isWord(w)
  } catch {
    console.log('wordtable: lexicon missing, skipping word checks')
    return () => true
  }
}

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })
  const registry = new RoomRegistry()
  const syncLexicon = loadLexiconSync()
  let isWordImpl: Lexicon = syncLexicon ?? (() => true)
  if (!syncLexicon) {
    // No bundled word list found synchronously: try the async loader once;
    // it logs exactly one line if the lexicon stays missing.
    void loadLexicon().then((fn) => {
      isWordImpl = fn
    })
  }
  const isWord: Lexicon = (w) => isWordImpl(w)
  const roomSockets = new Map<string, Set<WebSocket>>()
  const socketIdentity = new Map<WebSocket, { code: string; seat: number }>()

  function deliver(code: string, seat: number, frame: RoomReply): void {
    const set = roomSockets.get(code)
    if (!set) return
    const text = JSON.stringify(frame)
    for (const sock of [...set]) {
      const id = socketIdentity.get(sock)
      if (id && id.code === code && id.seat === seat) {
        try {
          if (sock.readyState === sock.OPEN) sock.send(text)
        } catch {
          // a failing recipient never blocks the rest of the fan-out
        }
      }
    }
  }

  // Request-triggered broadcasts are collected during handleMessage so the
  // reply frame always hits the wire before any broadcast. Timer-expiry
  // auto-pass broadcasts happen outside any request and send immediately.
  let collecting: Array<{ seat: number; frame: RoomReply }> | null = null
  const binding = createBinding(registry, {
    isWord,
    allowDebug: undefined,
    send: (seat, frame) => {
      const code = String((frame as RoomReply)['code'] ?? '')
      if (code === '') return
      if (collecting !== null) {
        collecting.push({ seat, frame })
        return
      }
      deliver(code, seat, frame)
    },
  })
  bindingsByRegistry.set(registry, binding)

  function rememberSocket(socket: WebSocket, code: string, seat: number): void {
    let set = roomSockets.get(code)
    if (!set) {
      set = new Set()
      roomSockets.set(code, set)
    }
    set.add(socket)
    socketIdentity.set(socket, { code, seat })
  }

  function preMapSocket(socket: WebSocket, parsed: unknown): void {
    try {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      const obj = parsed as RoomReply
      const code = normalizeCode(getField(obj, 'code', 'room', 'room_code'))
      const token = normalizeToken(getField(obj, 'token', 'session', 'session_token'))
      if (code === '') return
      if (token === undefined) return
      const res = registry.rejoin(code, token)
      if (res.ok) rememberSocket(socket, res.room.code, res.seat.seat)
    } catch {
      // mapping is best-effort; auth errors still reply normally
    }
  }

  function postMapSocket(socket: WebSocket, reply: RoomReply): void {
    try {
      if (!reply || reply['ok'] !== true) return
      const codeRaw = reply['code']
      if (typeof codeRaw !== 'string') return
      const seatRaw = (reply['seat'] ?? reply['you']) as unknown
      const seatNum = typeof seatRaw === 'number' ? seatRaw : Number(seatRaw)
      if (!Number.isInteger(seatNum)) return
      rememberSocket(socket, codeRaw, seatNum)
    } catch {
      // ignore mapping failures
    }
  }

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
      preMapSocket(socket, parsed)
      const queue: Array<{ seat: number; frame: RoomReply }> = []
      collecting = queue
      let reply: RoomReply
      try {
        reply = binding.handleMessage(parsed)
      } finally {
        collecting = null
      }
      // Reply first per protocol, then any broadcasts collected above.
      socket.send(JSON.stringify(reply))
      postMapSocket(socket, reply)
      // Flush after mapping so a freshly mapped socket still gets its frame.
      for (const item of queue) {
        const code = String(item.frame['code'] ?? '')
        if (code !== '') deliver(code, item.seat, item.frame)
      }
    })
    socket.on('close', () => {
      const id = socketIdentity.get(socket)
      if (id) {
        const set = roomSockets.get(id.code)
        if (set) {
          set.delete(socket)
          if (set.size === 0) roomSockets.delete(id.code)
        }
        socketIdentity.delete(socket)
      }
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
