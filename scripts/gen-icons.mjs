// Icon generator (issue #21) — dependency-free PNG writer (Node `zlib`
// only) that regenerates `public/icon-192.png` and `public/icon-512.png`:
// a wood-dark tile (`--wood-dark`) with a brass (`--brass`) 5x7 bitmap
// "W", values copied from `client/src/styles/tokens.css`. No designer
// assets, no native deps; run `node scripts/gen-icons.mjs` to refresh.
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const BG = [0x2e, 0x1a, 0x12]
const FG = [0xc9, 0xa5, 0x5c]

// 5x7 "W" bitmap.
const GLYPH = [
  '10001',
  '10001',
  '10001',
  '10001',
  '10101',
  '11011',
  '10001',
]

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function writePng(size, outPath) {
  const cell = Math.max(1, Math.floor(size / 12))
  const gw = 5 * cell
  const gh = 7 * cell
  const ox = Math.floor((size - gw) / 2)
  const oy = Math.floor((size - gh) / 2)
  const raw = Buffer.alloc(size * (1 + size * 3))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      let fg = false
      if (x >= ox && x < ox + gw && y >= oy && y < oy + gh) {
        const gx = Math.floor((x - ox) / cell)
        const gy = Math.floor((y - oy) / cell)
        fg = GLYPH[gy][gx] === '1'
      }
      const c = fg ? FG : BG
      raw[p++] = c[0]
      raw[p++] = c[1]
      raw[p++] = c[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(outPath, png)
  console.log(`wrote ${outPath} (${size}x${size}, ${png.length} bytes)`)
}

const here = dirname(fileURLToPath(import.meta.url))
const pub = join(here, '..', 'public')
writePng(192, join(pub, 'icon-192.png'))
writePng(512, join(pub, 'icon-512.png'))
