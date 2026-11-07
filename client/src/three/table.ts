// Table backdrop — vanilla Three.js felt table behind the DOM board.
// Backdrop only; game never depends on this module, and this module
// reads no game state. Module top level touches no DOM and constructs
// nothing: every effect lives inside initTableBackdrop, so the query
// helper stays unit-testable without a GPU. Any failure — including a
// forced `?nogl=1` — returns null and leaves the CSS gradient fallback
// in place, logging at most one neutral line that names no context API.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
  type Material,
} from 'three'
import { createParallax } from './parallax'

// `?nogl=1` guard lives in ./backdrop-guard (Three-free) so the entry
// chunk can check it statically without bundling Three.
import { isBackdropDisabled } from './backdrop-guard'
export { isBackdropDisabled }

export interface TableBackdropHandle {
  dispose: () => void
  canvas: HTMLCanvasElement
}

const FELT_COLOR = 0x1e4a3a
const DUST_COUNT = 120
// Board counter-translate bounds (px): the DOM board drifts against
// the pointer so the scene gains depth without stealing clicks.
const BOARD_SHIFT_X = 8
const BOARD_SHIFT_Y = 6

// Soft elliptical contact shadow painted on a canvas texture — no
// shadow-map pass, so the ambient loop stays one draw of felt.
function makeShadowTexture(): CanvasTexture {
  const size = 256
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const ctx = tile.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      8,
      size / 2,
      size / 2,
      size / 2,
    )
    grad.addColorStop(0, 'rgba(0,0,0,0.55)')
    grad.addColorStop(0.6, 'rgba(0,0,0,0.28)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  }
  return new CanvasTexture(tile)
}

function makeDust(): Points {
  const positions = new Float32Array(DUST_COUNT * 3)
  for (let i = 0; i < DUST_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10
    positions[i * 3 + 1] = -0.5 + Math.random() * 3
    positions[i * 3 + 2] = -3 + Math.random() * 5
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const material = new PointsMaterial({
    color: 0xffe6b3,
    size: 0.025,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    sizeAttenuation: true,
  })
  return new Points(geometry, material)
}

// Parallax target: the live board grid when mounted, else the app root.
function boardTarget(): HTMLElement | null {
  try {
    return (
      document.querySelector<HTMLElement>('.board') ??
      document.querySelector<HTMLElement>('#app')
    )
  } catch {
    return null
  }
}

// Boot the ambient backdrop into host. Returns a disposable handle, or
// null when the fallback gradient should stand in (`?nogl=1`, reduced
// motion still renders one static frame). Never throws to its caller.
export function initTableBackdrop(host: HTMLElement | null): TableBackdropHandle | null {
  let canvas: HTMLCanvasElement | null = null
  const cleanups: Array<() => void> = []
  const fail = (): null => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn()
      } catch {
        // Cleanup is best-effort; the board must never break.
      }
    }
    if (canvas !== null && canvas.parentNode !== null) {
      try {
        canvas.parentNode.removeChild(canvas)
      } catch {
        // Already detached; the fallback stands regardless.
      }
    }
    canvas = null
    try {
      console.info('[backdrop] 3D table unavailable; keeping gradient fallback')
    } catch {
      // No console at all (locked-down embed): stay silent.
    }
    return null
  }

  try {
    if (host === null || host === undefined) return null
    if (typeof document === 'undefined' || typeof window === 'undefined') return null
    let search = ''
    try {
      search = window.location.search
    } catch {
      search = ''
    }
    if (isBackdropDisabled(search)) return null
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      reduced = false
    }

    canvas = document.createElement('canvas')
    canvas.id = 'table-gl'
    canvas.setAttribute('aria-hidden', 'true')
    // Belt-and-braces with the stylesheet: the canvas keeps
    // pointer-events: none so play is never intercepted.
    canvas.style.pointerEvents = 'none'
    host.appendChild(canvas)

    // Mute the renderer's own creation-error report before it can
    // attach: our pre-probe below decides silently instead.
    const swallowCreationError = (e: Event): void => {
      try {
        e.stopImmediatePropagation()
      } catch {
        // Non-cancelable embed: ignore and rely on the probe.
      }
    }
    canvas.addEventListener('webglcontextcreationerror', swallowCreationError, false)
    cleanups.push(() => {
      try {
        canvas?.removeEventListener('webglcontextcreationerror', swallowCreationError, false)
      } catch {
        // Listener dies with the canvas regardless.
      }
    })

    // Silent capability probe with the exact attributes the renderer
    // would request: a null/error here means construction would throw
    // (and report), so fall back before touching the renderer.
    try {
      const probe = canvas.getContext('webgl2', {
        antialias: true,
        alpha: true,
        depth: true,
        stencil: true,
        powerPreference: 'default',
      })
      if (probe === null) return fail()
    } catch {
      return fail()
    }

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      return fail()
    }
    cleanups.push(() => {
      try {
        renderer.dispose()
      } catch {
        // Dispose is idempotent; ignore late failures.
      }
    })

    const scene = new Scene()
    const hostWidth = host.clientWidth || window.innerWidth || 1
    const hostHeight = host.clientHeight || window.innerHeight || 1
    const camera = new PerspectiveCamera(
      45,
      hostWidth / hostHeight,
      0.1,
      100,
    )
    const baseX = 0
    const baseY = 1.6
    const baseZ = 4.2
    camera.position.set(baseX, baseY, baseZ)
    camera.lookAt(0, 0, 0)

    const felt = new Mesh(
      new PlaneGeometry(16, 10),
      new MeshStandardMaterial({ color: FELT_COLOR, roughness: 0.95, metalness: 0 }),
    )
    felt.rotation.x = -Math.PI / 2
    felt.position.y = -0.6
    scene.add(felt)

    const key = new DirectionalLight(0xffd9a0, 1.6)
    key.position.set(3, 5, 2)
    scene.add(key)
    scene.add(new AmbientLight(0x9a8a6a, 0.55))

    const blob = new Mesh(
      new PlaneGeometry(5.2, 3.4),
      new MeshBasicMaterial({
        map: makeShadowTexture(),
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    )
    blob.rotation.x = -Math.PI / 2
    blob.position.y = -0.58
    scene.add(blob)

    const dust = makeDust()
    scene.add(dust)

    try {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    } catch {
      // Exotic embed without devicePixelRatio: default ratio stands.
    }
    const applySize = (): void => {
      const w = host.clientWidth || window.innerWidth || 1
      const h = host.clientHeight || window.innerHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    try {
      applySize()
    } catch {
      return fail()
    }

    let latestX = 0
    let latestY = 0
    const applyBoardShift = (): void => {
      const el = boardTarget()
      if (el === null) return
      try {
        el.style.transform =
          `translate3d(${(-latestX * BOARD_SHIFT_X).toFixed(2)}px, ` +
          `${(-latestY * BOARD_SHIFT_Y).toFixed(2)}px, 0)`
      } catch {
        // Detached node mid-repaint: the next frame retries.
      }
    }

    if (!reduced) {
      const parallax = createParallax({
        onOffset: (x, y) => {
          latestX = x
          latestY = y
          camera.position.x = baseX + x * 0.35
          camera.position.y = baseY + y * 0.25
          camera.lookAt(0, 0, 0)
          applyBoardShift()
        },
      })
      cleanups.push(() => parallax.dispose())
    }

    const onResize = (): void => {
      try {
        applySize()
      } catch {
        // Shrink to zero mid-teardown: ignore and keep the last frame.
      }
    }
    window.addEventListener('resize', onResize)
    cleanups.push(() => window.removeEventListener('resize', onResize))

    let raf = 0
    let alive = true
    const startedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    const tick = (t: number): void => {
      if (!alive) return
      try {
        if (!reduced) {
          const elapsed = (t - startedAt) / 1000
          dust.rotation.y = elapsed * 0.02
          dust.position.y = Math.sin(elapsed * 0.3) * 0.05
          applyBoardShift()
        }
        renderer.render(scene, camera)
      } catch {
        alive = false
        fail()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    if (reduced) {
      try {
        renderer.render(scene, camera)
      } catch {
        return fail()
      }
    } else {
      raf = requestAnimationFrame(tick)
    }
    cleanups.push(() => {
      alive = false
      if (raf !== 0) {
        try {
          cancelAnimationFrame(raf)
        } catch {
          // Loop already gone; teardown is complete anyway.
        }
      }
    })

    const canvasEl = canvas
    return {
      canvas: canvasEl,
      dispose(): void {
        alive = false
        if (raf !== 0) {
          try {
            cancelAnimationFrame(raf)
          } catch {
            // Loop already gone; teardown is complete anyway.
          }
        }
        for (const fn of cleanups.splice(0)) {
          try {
            fn()
          } catch {
            // Teardown is best-effort by definition.
          }
        }
        if (canvasEl.parentNode !== null) {
          try {
            canvasEl.parentNode.removeChild(canvasEl)
          } catch {
            // Already detached; nothing left to clean.
          }
        }
        try {
          felt.geometry.dispose()
          ;(felt.material as Material).dispose()
          ;(blob.material as Material).dispose()
          blob.geometry.dispose()
          dust.geometry.dispose()
          ;(dust.material as Material).dispose()
        } catch {
          // GPU already gone; DOM removal above is what matters.
        }
      },
    }
  } catch {
    return fail()
  }
}
