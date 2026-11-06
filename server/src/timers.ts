// Server turn clock — pure timeout wrapper, no sockets or game imports.
// Armed once per turn; expiry triggers an authoritative auto-pass.

export const DEFAULT_TURN_SECS = 90
export const STALL_GUARD_SECS = 180
export const MIN_TURN_SECS = 1
export const MAX_TURN_SECS = 3600

// Numeric 1-3600 wins, everything else falls back to 90. Accepts numbers
// and numeric strings; booleans, NaN, out-of-range and garbage -> 90.
export function clampTurnSecs(raw: unknown): number {
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string') {
    const text = raw.trim()
    if (text === '') return DEFAULT_TURN_SECS
    n = Number(text)
  } else {
    return DEFAULT_TURN_SECS
  }
  if (!Number.isFinite(n)) return DEFAULT_TURN_SECS
  const floored = Math.floor(n)
  if (floored < MIN_TURN_SECS || floored > MAX_TURN_SECS) return DEFAULT_TURN_SECS
  return floored
}

export class TurnTimer {
  private handle: ReturnType<typeof setTimeout> | null = null
  private _deadlineMs: number | null = null

  get deadlineMs(): number | null {
    return this._deadlineMs
  }

  get armed(): boolean {
    return this.handle !== null
  }

  arm(ms: number, onFire: () => void): void {
    this.disarm()
    const delay = Number.isFinite(ms) && ms > 0 ? ms : 0
    this._deadlineMs = Date.now() + delay
    this.handle = setTimeout(() => {
      this.handle = null
      this._deadlineMs = null
      onFire()
    }, delay)
    const h = this.handle as unknown as { unref?: () => void }
    if (typeof h.unref === 'function') h.unref()
  }

  disarm(): void {
    if (this.handle !== null) {
      clearTimeout(this.handle)
      this.handle = null
    }
    this._deadlineMs = null
  }
}
