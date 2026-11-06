// Node server — HTTP + ws on one port. Keep this module free of
// DOM/Three imports so it never pulls client bundles into the server.
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { parsePortArg, resolvePort } from './config.js'

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

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })
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
