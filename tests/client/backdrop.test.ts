// Three.js table backdrop (issue #11): GPU-free unit suites — parallax
// math, the `?nogl=1` query guard, dual-path canvas stylesheet markers,
// and static source assertions that keep the suite free of a renderer.

import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  pointerToOffset,
  lerpStep,
  createParallax,
} from '../../client/src/three/parallax'
import { isBackdropDisabled } from '../../client/src/three/backdrop-guard'

const CLIENT_STYLES = new URL('../../client/styles/', import.meta.url)
const SRC_STYLES = new URL('../../client/src/styles/', import.meta.url)
const CLIENT_SRC = new URL('../../client/src/', import.meta.url)

function css(dir: URL, name: string): string {
  return readFileSync(new URL(name, dir), 'utf8')
}

function src(name: string): string {
  return readFileSync(new URL(name, CLIENT_SRC), 'utf8')
}

describe('parallax math', () => {
  it('maps the viewport center to (0, 0)', () => {
    expect(pointerToOffset(400, 300, 800, 600)).toEqual({ x: 0, y: 0 })
  })

  it('maps corners to (+/-1, +/-1)', () => {
    expect(pointerToOffset(0, 0, 800, 600)).toEqual({ x: -1, y: -1 })
    expect(pointerToOffset(800, 600, 800, 600)).toEqual({ x: 1, y: 1 })
    expect(pointerToOffset(800, 0, 800, 600)).toEqual({ x: 1, y: -1 })
    expect(pointerToOffset(0, 600, 800, 600)).toEqual({ x: -1, y: 1 })
  })

  it('clamps out-of-viewport pointers', () => {
    expect(pointerToOffset(-200, 900, 800, 600)).toEqual({ x: -1, y: 1 })
    expect(pointerToOffset(2000, -50, 800, 600)).toEqual({ x: 1, y: -1 })
  })

  it('returns (0, 0) for degenerate viewports', () => {
    expect(pointerToOffset(10, 10, 0, 600)).toEqual({ x: 0, y: 0 })
    expect(pointerToOffset(10, 10, 800, 0)).toEqual({ x: 0, y: 0 })
  })

  it('lerpStep converges monotonically toward the target', () => {
    let current = 0
    let prev = 0
    for (let i = 0; i < 40; i++) {
      current = lerpStep(current, 1, 0.08)
      expect(current).toBeGreaterThanOrEqual(prev)
      prev = current
    }
    expect(current).toBeGreaterThan(0.9)
    expect(current).toBeLessThanOrEqual(1)
  })

  it('lerpStep holds at 0, snaps at 1, rests at the target', () => {
    expect(lerpStep(0.25, 1, 0)).toBe(0.25)
    expect(lerpStep(0.25, 1, 1)).toBe(1)
    expect(lerpStep(1, 1, 0.08)).toBe(1)
  })
})

describe('createParallax wiring', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const savedWindow = g.window
  const savedRaf = g.requestAnimationFrame
  const savedCancel = g.cancelAnimationFrame

  afterEach(() => {
    if (savedWindow === undefined) delete g.window
    else g.window = savedWindow
    if (savedRaf === undefined) delete g.requestAnimationFrame
    else g.requestAnimationFrame = savedRaf
    if (savedCancel === undefined) delete g.cancelAnimationFrame
    else g.cancelAnimationFrame = savedCancel
  })

  it('settles toward the pointer and disposes cleanly', () => {
    const listeners = new Map<string, Set<(e: unknown) => void>>()
    const frames = new Map<number, (t: number) => void>()
    let nextId = 0
    g.window = {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        let set = listeners.get(type)
        if (!set) {
          set = new Set()
          listeners.set(type, set)
        }
        set.add(fn)
      },
      removeEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners.get(type)?.delete(fn)
      },
    }
    g.requestAnimationFrame = (cb: (t: number) => void): number => {
      nextId += 1
      frames.set(nextId, cb)
      return nextId
    }
    g.cancelAnimationFrame = (id: number): void => {
      frames.delete(id)
    }
    const runFrames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        const pending = [...frames.values()]
        frames.clear()
        for (const cb of pending) cb(16 * (i + 1))
      }
    }

    const seen: Array<[number, number]> = []
    const handle = createParallax({ onOffset: (x, y) => seen.push([x, y]) })
    expect(listeners.get('pointermove')?.size).toBe(1)

    runFrames(3)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toEqual([0, 0])

    for (const fn of listeners.get('pointermove') ?? []) {
      fn({ clientX: 800, clientY: 600 })
    }
    runFrames(30)
    const last = seen[seen.length - 1] as [number, number]
    expect(last[0]).toBeGreaterThan(0.5)
    expect(last[1]).toBeGreaterThan(0.5)
    expect(last[0]).toBeLessThanOrEqual(1)
    expect(last[1]).toBeLessThanOrEqual(1)

    handle.dispose()
    expect(listeners.get('pointermove')?.size).toBe(0)
    expect(frames.size).toBe(0)
  })
})

describe('backdrop fallback guard', () => {
  it('detects ?nogl=1 anywhere in the query string', () => {
    expect(isBackdropDisabled('?nogl=1')).toBe(true)
    expect(isBackdropDisabled('?x=1&nogl=1')).toBe(true)
    expect(isBackdropDisabled('?nogl=1&x=2')).toBe(true)
  })

  it('keeps the backdrop for ordinary queries', () => {
    expect(isBackdropDisabled('?x=1')).toBe(false)
    expect(isBackdropDisabled('')).toBe(false)
    expect(isBackdropDisabled('?nogl=0')).toBe(false)
    expect(isBackdropDisabled('?rack=HELLO')).toBe(false)
  })
})

describe('backdrop stylesheets', () => {
  it('ships canvas#table-gl rules on both style paths', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const board = css(dir, 'board.css')
      expect(board).toContain('canvas#table-gl')
      expect(board).toContain('pointer-events: none')
      expect(board).toContain('#backdrop canvas')
    }
  })

  it('keeps the #backdrop gradient fallback untouched', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const board = css(dir, 'board.css')
      expect(board).toContain('#backdrop')
      expect(board).toContain('radial-gradient(')
    }
  })
})

describe('backdrop sources', () => {
  it('builds the table-gl canvas without touching game state', () => {
    const table = src('three/table.ts')
    expect(table).toContain('table-gl')
    expect(table).toContain('pointer-events')
    expect(table).toContain('?nogl=1')
    expect(table).toContain('MeshStandardMaterial')
    expect(table).toContain('THREE.Points')
    expect(table).not.toContain('gameStore')
    expect(table).not.toContain('uiStore')
  })

  it('keeps the parallax helper free of renderer imports', () => {
    const parallax = src('three/parallax.ts')
    expect(parallax).toContain('pointerToOffset')
    expect(parallax).toContain('createParallax')
    expect(parallax).not.toContain("from 'three'")
    expect(parallax).not.toContain('from "three"')
  })

  it('boots the backdrop after the board in main.ts without throwing', () => {
    const main = src('main.ts')
    expect(main).toContain('initTableBackdrop')
    expect(main).toContain("getElementById('backdrop')")
    expect(main.lastIndexOf('initTableBackdrop')).toBeGreaterThan(main.indexOf('render()'))
  })

  it('lazy-loads the Three backdrop behind the static guard', () => {
    const main = src('main.ts')
    // Dynamic import: Vite emits Three as a separate async chunk.
    expect(main).toContain("import('./three/table')")
    expect(main).toContain('isBackdropDisabled')
    // No static import of the Three module: the entry chunk stays light.
    expect(main).not.toContain("from './three/table'")
    expect(main).not.toContain('from "./three/table"')
    // ?nogl=1 early-returns before the dynamic import is reached.
    expect(main.indexOf('isBackdropDisabled')).toBeLessThan(
      main.indexOf("import('./three/table')"),
    )
  })

  it('keeps the guard module free of Three imports', () => {
    const guard = src('three/backdrop-guard.ts')
    expect(guard).toContain('isBackdropDisabled')
    expect(guard).not.toContain("from 'three'")
    expect(guard).not.toContain('from "three"')
  })

  it('re-exports the guard from the Three module', () => {
    const table = src('three/table.ts')
    expect(table).toContain('backdrop-guard')
    expect(table).toContain('isBackdropDisabled')
  })
})
