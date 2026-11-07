// Sound generator (issue #36) — dependency-free PCM wav synthesizer
// (Node builtins only) that regenerates
// `public/sounds/{thunk,fanfare,bag,error}.wav`: the four `SoundName`
// members fetched by `playSound` in `client/src/audio/bank.ts` via the
// `sounds/${name}.wav` template. 22050 Hz / 16-bit / mono PCM with a
// correct 44-byte RIFF/WAVE/fmt/data header; deterministic output
// (mulberry32 with a fixed seed) so every run writes identical bytes.
// No designer recordings, no native deps; run
// `node scripts/gen-sounds.mjs` to refresh.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 22050

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function writeWav(samples, outPath) {
  const n = samples.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + n * 2, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(n * 2, 40)
  const body = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    body.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const wav = Buffer.concat([header, body])
  writeFileSync(outPath, wav)
  console.log(`wrote ${outPath} (${(n / SR).toFixed(2)}s, ${wav.length} bytes)`)
}

// `thunk` (~0.18 s): low sine thump, pitch falling 150 -> 60 Hz with a
// fast exponential decay so a legal commit lands with a soft knock.
function thunk() {
  const dur = 0.18
  const n = Math.floor(SR * dur)
  const out = new Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const freq = 150 - (90 * t) / dur
    phase += (2 * Math.PI * freq) / SR
    out[i] = Math.sin(phase) * Math.exp(-t * 22) * 0.9
  }
  return out
}

// `fanfare` (~0.5 s): two-note up-chirp (C5 then G5) with short attacks
// and a gentle decay, plus a soft octave harmonic for brightness.
function fanfare() {
  const dur = 0.5
  const half = 0.25
  const n = Math.floor(SR * dur)
  const out = new Array(n)
  const notes = [523.25, 783.99]
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const idx = t < half ? 0 : 1
    const lt = t < half ? t : t - half
    const f = notes[idx]
    const attack = Math.min(1, lt / 0.02)
    const decay = Math.exp(-lt * 4)
    out[i] =
      (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t)) *
      attack *
      decay *
      0.5
  }
  return out
}

// `bag` (~0.25 s): seeded white-noise shuffle burst shaped by a raised
// swell with a 30 Hz rattle so tile draws sound like shaking tiles.
function bag() {
  const dur = 0.25
  const n = Math.floor(SR * dur)
  const rand = mulberry32(0x36ba9)
  const out = new Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const swell = Math.sin((Math.PI * t) / dur)
    const rattle = 0.6 + 0.4 * Math.sin(2 * Math.PI * 30 * t)
    const white = rand() * 2 - 1
    // One-pole lowpass to take the harsh edge off the raw noise.
    prev = prev * 0.6 + white * 0.4
    out[i] = prev * swell * rattle * 0.8
  }
  return out
}

// `error` (~0.3 s): low double-pulse buzz — 140 Hz plus its first
// harmonic, gated into two pulses (0.12 s on, 0.03 s gap, rest on)
// for a reject/illegal-move feel.
function error() {
  const dur = 0.3
  const n = Math.floor(SR * dur)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const gate = t < 0.12 ? 1 : t < 0.15 ? 0 : 1
    const edge = t < 0.12 ? Math.min(1, t / 0.01) : t < 0.15 ? 0 : Math.min(1, (t - 0.15) / 0.01)
    const tail = Math.exp(-t * 2)
    out[i] =
      (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t)) *
      gate *
      edge *
      tail *
      0.45
  }
  return out
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'sounds')
mkdirSync(outDir, { recursive: true })

const sounds = { thunk, fanfare, bag, error }
for (const [name, synth] of Object.entries(sounds)) {
  writeWav(synth(), join(outDir, `${name}.wav`))
}
