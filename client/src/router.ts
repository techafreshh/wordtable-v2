// Hash router (issue #10) — pure route parsing plus a tiny hashchange
// dispatcher. Session/ended guards live in main.ts, not in the parser,
// so parsing stays a total function over the five routes.

export type Route =
  | 'start'
  | 'setup'
  | 'lobby'
  | 'table'
  | 'recap'
  | 'online-lobby'
  | 'online-table'

export const ROUTES: readonly Route[] = [
  'start',
  'setup',
  'lobby',
  'table',
  'recap',
  'online-lobby',
  'online-table',
]

export function parseRoute(hash: string): Route {
  const raw = String(hash ?? '').replace(/^#\/?/, '')
  const clean = (raw.split('?')[0] ?? '').split('/')[0]?.trim().toLowerCase() ?? ''
  switch (clean) {
    case '':
    case 'start':
      return 'start'
    case 'setup':
      return 'setup'
    case 'lobby':
      return 'lobby'
    case 'table':
      return 'table'
    case 'recap':
      return 'recap'
    case 'online-lobby':
      return 'online-lobby'
    case 'online-table':
      return 'online-table'
    default:
      return 'start'
  }
}

export function routeHash(route: Route): string {
  return route === 'start' ? '#/' : `#/${route}`
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route)
  // Repaint synchronously: hash assignment alone only schedules a
  // hashchange, so hash-polling readers could observe the stale screen.
  // The later hashchange re-dispatch is idempotent.
  activeHandler?.(route)
}

let activeHandler: ((route: Route) => void) | null = null

export function startRouter(onRoute: (route: Route) => void): () => void {
  activeHandler = onRoute
  const handler = (): void => {
    onRoute(parseRoute(window.location.hash))
  }
  window.addEventListener('hashchange', handler)
  handler()
  return () => {
    window.removeEventListener('hashchange', handler)
    if (activeHandler === onRoute) activeHandler = null
  }
}
