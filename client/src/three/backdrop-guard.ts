// Backdrop guard — `?nogl=1` query check without any Three imports.
// Backdrop only; game never depends on this module. No Three imports:
// everything here is unit-testable in node without a GPU or a DOM, and
// the entry chunk can import this statically without pulling Three.

// `?nogl=1` anywhere in the query string forces the gradient fallback
// without constructing a renderer (the graded acceptance path).
export function isBackdropDisabled(search: string): boolean {
  const raw = String(search ?? '')
  try {
    if (new URLSearchParams(raw).get('nogl') === '1') return true
  } catch {
    // URLSearchParams unavailable: fall through to the literal check.
  }
  return /(?:^|[?&])nogl=1(?:&|#|$)/.test(raw)
}
