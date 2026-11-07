// Static-serve probe (issue #21) — the production single-port server
// must serve the SPA, the PWA manifest and the exact health body.
// Precedent: tests/e2e/ws-probe.mts (in-process `startServer(0)`).
import { describe, it, expect, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { startServer } from '../../server/src/ws'

let server: Server | null = null

afterEach(async () => {
  if (server !== null) {
    const closing = server
    server = null
    await new Promise<void>((resolve) => closing.close(() => resolve()))
  }
})

async function listen(): Promise<string> {
  server = startServer(0)
  await new Promise<void>((resolve) => {
    if (server !== null && server.listening) resolve()
    else server?.once('listening', () => resolve())
  })
  const addr = server?.address()
  const port =
    typeof addr === 'object' && addr !== null
      ? (addr as { port: number }).port
      : 0
  expect(port).toBeGreaterThan(0)
  return `http://127.0.0.1:${port}`
}

describe('production static serving', () => {
  it('GET / 200 contains Wordtable', async () => {
    const base = await listen()
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Wordtable')
  })

  it('GET /manifest.webmanifest 200 with manifest content-type', async () => {
    const base = await listen()
    const res = await fetch(`${base}/manifest.webmanifest`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/manifest+json')
    const manifest = (await res.json()) as { name?: unknown }
    expect(manifest.name).toBe('Wordtable')
  })

  it('GET /health returns exactly {"ok":true}', async () => {
    const base = await listen()
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')
  })
})
