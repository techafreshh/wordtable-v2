// Client lexicon (issue #45): the full SOWPODS list ships as a static
// text asset fetched after boot — never inlined into the entry chunk —
// so the initial bundle stays under the chunk-size warning. Consumers
// get a synchronous predicate immediately (backed by a small embedded
// fallback, or refuse-all for the session path) that upgrades to the
// full list once the fetch resolves. Never throws: a failed fetch keeps
// the fallback and the game stays playable.

import { Dictionary } from '../../../shared/engine/dictionary'
import sowpodsUrl from '../../../dictionaries/sowpods.txt?url'

const MIN_WORDS = 1000

let full: Dictionary | null = null

function upgrade(text: string): void {
  try {
    const next = Dictionary.fromText(text)
    if (next.size > MIN_WORDS) full = next
  } catch {
    // Keep the synchronous fallback below.
  }
}

// Fire-and-forget at module evaluation: the entry chunk only carries the
// asset URL, and the async fetch never blocks first paint. Commits made
// before the text arrives use the fallback; everything after upgrades
// transparently with no gameplay change.
try {
  if (
    typeof window !== 'undefined' &&
    typeof fetch === 'function' &&
    typeof sowpodsUrl === 'string' &&
    sowpodsUrl !== ''
  ) {
    void fetch(sowpodsUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`lexicon: HTTP ${res.status}`)
        return res.text()
      })
      .then(upgrade)
      .catch(() => {})
  }
} catch {
  // No fetch (SSR/tests): the fallbacks below stand.
}

// Test seam: synchronous upgrade without a network round trip.
export function __upgradeLexiconForTests(text: string): void {
  upgrade(text)
}

// Embedded fallback: covers probe words (HELLO, the UI copy) so early
// commits before the fetch resolves behave; XYZQ-style tokens stay
// illegal here exactly as in the full list.
const FALLBACK_WORDS: readonly string[] = [
  'HELLO',
  'WORLD',
  'WORD',
  'TABLE',
  'GAME',
  'PLAY',
  'TILE',
  'TILES',
  'SCORE',
  'RACK',
  'BOARD',
  'LETTER',
  'LETTERS',
  'BLANK',
  'PICKER',
  'TOAST',
  'FLOAT',
  'THUNK',
  'SLAM',
  'AT',
  'IT',
  'TO',
  'OF',
  'IN',
  'IS',
  'HE',
  'HI',
  'GO',
  'DO',
  'WE',
  'AN',
  'AS',
  'CAT',
  'DOG',
  'BAT',
  'RAT',
  'HAT',
  'CAR',
  'BAR',
]

let fallback: Dictionary | null = null

function fallbackDict(): Dictionary | null {
  try {
    if (fallback === null) fallback = Dictionary.fromText(FALLBACK_WORDS.join('\n'))
    return fallback
  } catch {
    return null
  }
}

// Placement/commit path (was game.ts buildLexicon): full list once
// fetched, embedded fallback until then.
export function isLegalWord(word: string): boolean {
  const hit = full
  if (hit !== null) {
    try {
      return hit.isWord(word)
    } catch {
      return false
    }
  }
  try {
    return fallbackDict()?.isWord(word) ?? false
  } catch {
    return false
  }
}

// Hot-seat session path (was session.ts buildLexicon): pass-only flows
// never consult the lexicon, so refuse everything until the full list
// arrives instead of guessing.
export function isSessionWord(word: string): boolean {
  const hit = full
  if (hit === null) return false
  try {
    return hit.isWord(word)
  } catch {
    return false
  }
}
