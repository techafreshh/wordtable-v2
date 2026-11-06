// Placement store — client-side pending tiles for the rack (issue #7).
// Nothing here commits: LocalGame.place() stays the T9/T12 commit path,
// because place() consumes tiles and ends the pending/recall loop the rack
// probes exercise. Provisional scoring calls shared validateMove directly
// against an empty committed grid plus pending placements with a permissive
// lexicon; invalid or empty pending renders 0 so #prov-score always matches
// /^[0-9]+ pts$/. Mirrors the vanilla-zustand shape of store/ui.ts.

import { createStore } from 'zustand/vanilla'
import { BOARD_SIZE, parseSquare, toAlgebra } from '../../../shared/engine/board'
import {
  validateMove,
  type BoardCell,
  type BoardGrid,
  type Placement,
} from '../../../shared/engine/rules'
import type { Tile } from '../../../shared/engine/bag'

export interface PendingTile {
  id: number
  face: string
  isBlank: boolean
  sq: string
}

interface GameStoreState {
  rack: Tile[]
  pending: PendingTile[]
  selectedRack: number | null
  provScore: number
  provWords: string[]
  setRack: (faces: string[]) => void
  selectRack: (index: number | null) => void
  placeTile: (rackIndex: number, sq: string) => boolean
  returnTile: (pendingId: number) => void
  recall: () => void
  shuffle: () => void
  reset: () => void
}

let nextPendingId = 0

function emptyGrid(): BoardGrid {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array<BoardCell | null>(BOARD_SIZE).fill(null),
  )
}

function toPlacements(pending: PendingTile[]): Placement[] {
  return pending.map((p) => {
    const { row, col } = parseSquare(p.sq)
    if (p.isBlank) {
      return { row, col, tile: { face: '?', isBlank: true } }
    }
    return { row, col, tile: { face: p.face, isBlank: false } }
  })
}

function provisional(pending: PendingTile[]): { score: number; words: string[] } {
  if (pending.length === 0) return { score: 0, words: [] }
  const result = validateMove(emptyGrid(), toPlacements(pending), () => true)
  if (!result.ok) return { score: 0, words: [] }
  return { score: result.score, words: [...result.words] }
}

function tileOf(face: string): Tile | null {
  const f = face.trim().toUpperCase()
  if (f === '?') return { face: '?', isBlank: true }
  if (/^[A-Z]$/.test(f)) return { face: f, isBlank: false }
  return null
}

export function provScoreText(score: number): string {
  return `${score} pts`
}

export const gameStore = createStore<GameStoreState>()((set, get) => {
  function commit(rack: Tile[], pending: PendingTile[], selectedRack: number | null): void {
    const { score, words } = provisional(pending)
    set({ rack, pending, selectedRack, provScore: score, provWords: words })
  }

  return {
    rack: [],
    pending: [],
    selectedRack: null,
    provScore: 0,
    provWords: [],

    setRack: (faces) => {
      const rack: Tile[] = []
      for (const face of faces.slice(0, 7)) {
        const tile = tileOf(face)
        if (tile) rack.push(tile)
      }
      commit(rack, [], null)
    },

    selectRack: (index) => {
      if (index === null) {
        set({ selectedRack: null })
        return
      }
      const { rack } = get()
      if (!Number.isInteger(index) || index < 0 || index >= rack.length) return
      set({ selectedRack: index })
    },

    placeTile: (rackIndex, sq) => {
      const { rack, pending } = get()
      if (!Number.isInteger(rackIndex) || rackIndex < 0 || rackIndex >= rack.length) {
        return false
      }
      let norm: string
      try {
        const { row, col } = parseSquare(sq)
        norm = toAlgebra(row, col)
      } catch {
        return false
      }
      if (pending.some((p) => p.sq === norm)) return false
      const tile = rack[rackIndex]
      const entry: PendingTile = {
        id: nextPendingId++,
        face: tile.face,
        isBlank: tile.isBlank,
        sq: norm,
      }
      commit(
        rack.filter((_, i) => i !== rackIndex),
        [...pending, entry],
        null,
      )
      return true
    },

    returnTile: (pendingId) => {
      const { rack, pending, selectedRack } = get()
      const found = pending.find((p) => p.id === pendingId)
      if (!found) return
      const returned: Tile = { face: found.face, isBlank: found.isBlank }
      commit(
        [...rack, returned],
        pending.filter((p) => p.id !== pendingId),
        selectedRack,
      )
    },

    recall: () => {
      const { rack, pending } = get()
      if (pending.length === 0) {
        set({ selectedRack: null })
        return
      }
      // Pending is stored in placement order, so the rack regrows in the
      // order the tiles were placed.
      const returned: Tile[] = pending.map((p) => ({ face: p.face, isBlank: p.isBlank }))
      commit([...rack, ...returned], [], null)
    },

    shuffle: () => {
      const { rack, pending, selectedRack } = get()
      const next = [...rack]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      const { score, words } = provisional(pending)
      set({
        rack: next,
        provScore: score,
        provWords: words,
        selectedRack:
          selectedRack !== null && selectedRack < next.length ? selectedRack : null,
      })
    },

    reset: () => {
      const { rack, pending } = get()
      const returned: Tile[] = pending.map((p) => ({ face: p.face, isBlank: p.isBlank }))
      commit([...rack, ...returned], [], null)
    },
  }
})
