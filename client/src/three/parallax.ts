// Table backdrop parallax — pure pointer math plus a tiny rAF settler.
// Backdrop only; game never depends on this module. No Three imports:
// everything here is unit-testable in node without a GPU or a DOM.

export interface ParallaxOffset {
  x: number
  y: number
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value > 1) return 1
  if (value < -1) return -1
  return value
}

// Viewport pixel coordinates → clamped -1..1 offsets. The viewport
// center maps to (0, 0), top-left to (-1, -1) and bottom-right to
// (1, 1); outside points clamp so fullscreen drags stay bounded.
export function pointerToOffset(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): ParallaxOffset {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { x: 0, y: 0 }
  }
  return {
    x: clampUnit((clientX / width) * 2 - 1),
    y: clampUnit((clientY / height) * 2 - 1),
  }
}

// One exponential-settle step toward the target. The rate is clamped to
// 0..1 so repeated steps converge monotonically; 0 holds, 1 snaps.
export function lerpStep(current: number, target: number, alpha: number): number {
  if (!Number.isFinite(current)) return target
  if (!Number.isFinite(target)) return current
  const rate = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0
  return current + (target - current) * rate
}

export interface ParallaxOptions {
  onOffset: (x: number, y: number) => void
  // Per-frame settle rate toward the pointer target. Defaults to 0.08.
  alpha?: number
  // Minimum settled-delta that re-emits. Defaults to 1e-4.
  epsilon?: number
}

export interface ParallaxHandle {
  dispose: () => void
}

// Tracks the pointer with a single passive listener and settles toward
// it on its own rAF loop — the listener only records the target, so
// pointer storms never do layout work; emission happens on frames.
// Calls onOffset on the first frame and whenever the settled offset
// moves past epsilon, and returns a dispose() that removes the
// listener and cancels the loop. Safe without a DOM (SSR/tests): with
// no window it settles once and the handle is a no-op.
export function createParallax(options: ParallaxOptions): ParallaxHandle {
  const onOffset = options.onOffset
  const alpha = Number.isFinite(options.alpha)
    ? Math.min(1, Math.max(0, options.alpha as number))
    : 0.08
  const epsilon =
    Number.isFinite(options.epsilon) && (options.epsilon as number) > 0
      ? (options.epsilon as number)
      : 1e-4
  let targetX = 0
  let targetY = 0
  let currentX = 0
  let currentY = 0
  let emittedX = Number.NaN
  let emittedY = Number.NaN
  let rafId = 0
  let disposed = false

  const canListen =
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function' &&
    typeof window.removeEventListener === 'function'
  const canRaf =
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'

  const handleMove = (e: Event): void => {
    const p = e as unknown as { clientX: number; clientY: number }
    const w = typeof window !== 'undefined' ? window.innerWidth : 0
    const h = typeof window !== 'undefined' ? window.innerHeight : 0
    const next = pointerToOffset(p.clientX, p.clientY, w, h)
    targetX = next.x
    targetY = next.y
  }

  const settled = (): void => {
    if (disposed) return
    currentX = lerpStep(currentX, targetX, alpha)
    currentY = lerpStep(currentY, targetY, alpha)
    if (
      Number.isNaN(emittedX) ||
      Math.abs(currentX - emittedX) > epsilon ||
      Math.abs(currentY - emittedY) > epsilon
    ) {
      emittedX = currentX
      emittedY = currentY
      try {
        onOffset(currentX, currentY)
      } catch {
        // Ambient-only callback: never let it break the loop.
      }
    }
  }

  const frame = (): void => {
    if (disposed) return
    settled()
    if (canRaf) rafId = requestAnimationFrame(frame)
  }

  if (canListen) window.addEventListener('pointermove', handleMove, { passive: true })
  if (canRaf) {
    rafId = requestAnimationFrame(frame)
  } else {
    settled()
  }

  return {
    dispose(): void {
      disposed = true
      if (canListen) window.removeEventListener('pointermove', handleMove)
      if (canRaf && rafId !== 0) cancelAnimationFrame(rafId)
    },
  }
}
