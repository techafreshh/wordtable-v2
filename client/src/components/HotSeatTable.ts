// Hot-seat table (issue #10) — the session snapshot over the Board grid:
// committed tiles only (no pending/rack model on this screen), a seat
// strip, a score line and a pass control. Bot seats resolve through the
// session auto-pass timer; humans pass with the button or the test hook.

import { GameStatus } from '../../../shared/engine/game'
import { toAlgebra } from '../../../shared/engine/board'
import type { BoardGrid } from '../../../shared/engine/rules'
import type { LocalSnapshot } from '../../../shared/engine/local'
import { buildBoardHTML } from './Board'
import { buildPlayerStripHTML } from './PlayerStrip'
import { sessionStore } from '../store/session'
import { navigate } from '../router'

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Committed-only grid: LocalGame owns placed tiles, so every supplied tile
// renders `.tile.committed` (never `.pending` or `.last-move`). A pure
// string promotion over buildBoardHTML, testable by regex count.
export function buildTableBoardHTML(
  tiles: Readonly<Record<string, string>> = {},
): string {
  return buildBoardHTML(tiles).split('class="tile"').join('class="tile committed"')
}

// Committed board grid as an algebra→letter map for the Board renderer.
export function boardTiles(board: BoardGrid): Record<string, string> {
  const tiles: Record<string, string> = {}
  for (let row = 0; row < board.length; row++) {
    const cells = board[row]
    if (!cells) continue
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col]
      if (cell !== null && cell !== undefined) {
        tiles[toAlgebra(row, col)] = cell.letter
      }
    }
  }
  return tiles
}

export function buildHotSeatTableHTML(snapshot: LocalSnapshot): string {
  const turnName = String(snapshot.names[snapshot.turn] ?? '')
  return (
    '<main class="screen screen-table">' +
    buildPlayerStripHTML(snapshot.names, snapshot.scores, snapshot.turn) +
    `<div id="score-line" aria-label="Score">${snapshot.scores.join(' - ')}</div>` +
    `<div id="turn-line">${escapeHTML(turnName)} to play</div>` +
    `<div class="board-host">${buildTableBoardHTML(boardTiles(snapshot.board))}</div>` +
    '<div class="screen-actions">' +
    '<button type="button" id="pass-button">Pass</button>' +
    '</div>' +
    '</main>'
  )
}

export function mountHotSeatTable(
  root: HTMLElement,
  onPass?: () => void,
): void {
  root.querySelector('#pass-button')?.addEventListener('click', () => {
    if (onPass) {
      onPass()
      return
    }
    sessionStore.getState().passTurn()
    const snap = sessionStore.getState().snapshot()
    if (snap !== null && snap.status !== GameStatus.PLAYING) {
      navigate('recap')
    }
  })
}
