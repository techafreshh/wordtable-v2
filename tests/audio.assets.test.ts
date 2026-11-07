// Sound-asset proofs (issue #36) — the four `SoundName` wavs fetched by
// `playSound` (`sounds/${name}.wav`) exist as valid 22050 Hz 16-bit mono
// PCM, and the production single-port server answers them as audio.
// Style precedent: tests/pwa.assets.test.ts (readFileSync file-content
// assertions) and tests/server/static-serve.test.ts (in-process
// `startServer(0)` probe with an explicit `staticRoot`).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import { startServer } from '../server/src/ws'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const NAMES = ['thunk', 'fanfare', 'bag', 'error'] as const

function readBytes(rel: string): Buffer {
  return readFileSync(join(repoRoot, rel))
}

function parseWav(rel: string): { dataBytes: number; peak: number } {
  const bytes = readBytes(rel)
  expect(bytes.length).toBeLessThan(64 * 1024)
  // 44-byte RIFF/WAVE/fmt/data header.
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE')
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('fmt ')
  expect(bytes.readUInt32LE(16)).toBe(16)
  expect(bytes.readUInt16LE(20)).toBe(1) // PCM
  expect(bytes.readUInt16LE(22)).toBe(1) // mono
  expect(bytes.readUInt32LE(24)).toBe(22050)
  expect(bytes.readUInt16LE(34)).toBe(16)
  expect(bytes.subarray(36, 40).toString('ascii')).toBe('data')
  const dataBytes = bytes.readUInt32LE(40)
  expect(dataBytes).toBeGreaterThan(0)
  expect(dataBytes).toBe(bytes.length - 44)
  const samples = dataBytes / 2
  const duration = samples / 22050
  expect(duration).toBeGreaterThanOrEqual(0.1)
  expect(duration).toBeLessThanOrEqual(0.8)
  let peak = 0
  for (let i = 0; i < samples; i++) {
    const v = Math.abs(bytes.readInt16LE(44 + i * 2))
    if (v > peak) peak = v
  }
  expect(peak).toBeGreaterThan(1000)
  return { dataBytes, peak }
}

describe('sound assets', () => {
  for (const name of NAMES) {
    it(`public/sounds/${name}.wav exists as valid non-silent PCM`, () => {
      expect(existsSync(join(repoRoot, `public/sounds/${name}.wav`))).toBe(true)
      parseWav(`public/sounds/${name}.wav`)
    })
  }

  it('bank fetches sounds/${name}.wav and lists all four SoundName members', () => {
    const bank = readBytes('client/src/audio/bank.ts').toString('utf8')
    expect(bank).toContain('sounds/${name}.wav')
    for (const name of NAMES) {
      expect(bank).toContain(`'${name}'`)
    }
  })
})

let server: Server | null = null

afterEach(async () => {
  if (server !== null) {
    const closing = server
    server = null
    await new Promise<void>((resolve) => closing.close(() => resolve()))
  }
})

async function listenPublic(): Promise<string> {
  server = startServer(0, join(repoRoot, 'public'))
  await new Promise<void>((resolve) => {
    if (server !== null && server.listening) resolve()
    else server?.once('listening', () => resolve())
  })
  const addr = server?.address()
  const port = typeof addr === 'object' && addr !== null ? (addr as { port: number }).port : 0
  expect(port).toBeGreaterThan(0)
  return `http://127.0.0.1:${port}`
}

describe('sound static serving', () => {
  it('GET /sounds/thunk.wav 200 with an audio content-type', async () => {
    const base = await listenPublic()
    const res = await fetch(`${base}/sounds/thunk.wav`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(body.subarray(8, 12).toString('ascii')).toBe('WAVE')
  })

  it('server MIME table maps .wav to audio', () => {
    const ws = readBytes('server/src/ws.ts').toString('utf8')
    expect(ws).toContain("'.wav'")
    expect(ws).toContain('audio/wav')
  })
})
