// PWA asset proofs (issue #21) — manifest schema, real PNG icons with
// exact pixel sizes, index.html link markers and the service-worker
// version markers. Style precedent: tests/server/skeleton.test.ts
// (pure-function + readFileSync file-content assertions).
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const PNG_MAGIC = '89504e470d0a1a0a'

function readBytes(rel: string): Buffer {
  return readFileSync(join(repoRoot, rel))
}

function pngSize(rel: string): { width: number; height: number } {
  const bytes = readBytes(rel)
  expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_MAGIC)
  // IHDR chunk: 8-byte signature, 4-byte length, 4-byte 'IHDR', then
  // 4-byte big-endian width and height.
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

describe('PWA manifest', () => {
  it('is valid JSON with the installable fields', () => {
    const manifest = JSON.parse(
      readBytes('public/manifest.webmanifest').toString('utf8'),
    ) as {
      name?: unknown
      short_name?: unknown
      start_url?: unknown
      display?: unknown
      icons?: Array<{
        src?: unknown
        sizes?: unknown
        type?: unknown
        purpose?: unknown
      }>
    }
    expect(manifest.name).toBe('Wordtable')
    expect(manifest.short_name).toBe('Wordtable')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(Array.isArray(manifest.icons)).toBe(true)
    const sizes = new Set(
      (manifest.icons ?? []).map((icon) => String(icon.sizes ?? '')),
    )
    expect(sizes.has('192x192')).toBe(true)
    expect(sizes.has('512x512')).toBe(true)
    for (const icon of manifest.icons ?? []) {
      expect(String(icon.type ?? '')).toBe('image/png')
      expect(String(icon.purpose ?? '')).toContain('maskable')
    }
  })
})

describe('PWA icons', () => {
  it('public/icon-192.png exists with PNG magic and 192x192 size', () => {
    expect(existsSync(join(repoRoot, 'public/icon-192.png'))).toBe(true)
    expect(pngSize('public/icon-192.png')).toEqual({
      width: 192,
      height: 192,
    })
  })

  it('public/icon-512.png exists with PNG magic and 512x512 size', () => {
    expect(existsSync(join(repoRoot, 'public/icon-512.png'))).toBe(true)
    expect(pngSize('public/icon-512.png')).toEqual({
      width: 512,
      height: 512,
    })
  })
})

describe('index.html PWA links', () => {
  it('links the manifest, theme-color and apple-touch-icon', () => {
    const html = readBytes('client/index.html').toString('utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('Wordtable')
  })
})

describe('service worker', () => {
  it('ships version and precache markers', () => {
    const sw = readBytes('public/sw.js').toString('utf8')
    expect(sw).toContain('wordtable-v1')
    expect(sw).toContain('skipWaiting')
    expect(sw).toContain('/manifest.webmanifest')
    expect(sw).toContain('clients.claim')
  })
})
