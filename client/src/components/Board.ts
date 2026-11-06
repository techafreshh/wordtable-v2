// Board view — pure DOM/CSS 15x15 club table, no WebGL/Three imports.
// Premium layout mirrors shared/engine/board.ts (kept literal here so the
// view stays dependency-free); the engine remains the scoring authority.

export const BOARD_SIZE = 15

export type PremiumKind = 'TW' | 'DW' | 'TL' | 'DL' | 'STAR' | 'PLAIN'

// Legend: '3' = triple word, '2' = double word, 't' = triple letter,
// 'd' = double letter, '*' = center star (H8), '.' = plain square.
const PREMIUM_LEGEND: readonly string[] = [
  '3..d...3...d..3',
  '.2...t...t...2.',
  '..2...d.d...2..',
  'd..2...d...2..d',
  '....2.....2....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  '3..d...*...d..3',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....2.....2....',
  'd..2...d...2..d',
  '..2...d.d...2..',
  '.2...t...t...2.',
  '3..d...3...d..3',
]

function checkBounds(row: number, col: number, fn: string): void {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_SIZE ||
    col < 0 ||
    col >= BOARD_SIZE
  ) {
    throw new RangeError(`${fn}: out of bounds (${row}, ${col})`)
  }
}

export function premiumKindAt(row: number, col: number): PremiumKind {
  checkBounds(row, col, 'premiumKindAt')
  switch (PREMIUM_LEGEND[row][col]) {
    case '3':
      return 'TW'
    case '2':
      return 'DW'
    case 't':
      return 'TL'
    case 'd':
      return 'DL'
    case '*':
      return 'STAR'
    default:
      return 'PLAIN'
  }
}

// Letter-first algebra, e.g. row 7 col 7 -> "H8".
export function squareLabel(row: number, col: number): string {
  checkBounds(row, col, 'squareLabel')
  return `${String.fromCharCode(65 + col)}${row + 1}`
}

function premiumClass(kind: PremiumKind): string {
  switch (kind) {
    case 'TW':
      return 'sq-tw'
    case 'DW':
      return 'sq-dw'
    case 'TL':
      return 'sq-tl'
    case 'DL':
      return 'sq-dl'
    case 'STAR':
      return 'sq-star'
    default:
      return 'sq-plain'
  }
}

function premiumText(kind: PremiumKind): string {
  switch (kind) {
    case 'TW':
      return 'TW'
    case 'DW':
      return 'DW'
    case 'TL':
      return 'TL'
    case 'DL':
      return 'DL'
    case 'STAR':
      return '★'
    default:
      return ''
  }
}

function cellHTML(row: number, col: number, tiles: Readonly<Record<string, string>>): string {
  const kind = premiumKindAt(row, col)
  const sq = squareLabel(row, col)
  const tile = tiles[sq]
  const inner =
    tile !== undefined
      ? `<div class="tile" data-tile="${tile}">${tile}</div>`
      : kind === 'STAR'
        ? `<span class="star" aria-hidden="true">★</span>`
        : premiumText(kind) === ''
          ? ''
          : `<span class="sq-label" aria-hidden="true">${premiumText(kind)}</span>`
  return (
    `<div class="sq ${premiumClass(kind)}" role="gridcell"` +
    ` data-sq="${sq}" data-premium="${kind}" aria-label="${sq} ${kind.toLowerCase()}">` +
    inner +
    `</div>`
  )
}

// Full board markup: .board wrapper with exactly 225 .sq children.
export function buildBoardHTML(tiles: Readonly<Record<string, string>> = {}): string {
  let cells = ''
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      cells += cellHTML(row, col, tiles)
    }
  }
  return `<div class="board" role="grid" aria-label="Wordtable board">${cells}</div>`
}

export function mountBoard(el: HTMLElement, tiles: Readonly<Record<string, string>> = {}): void {
  el.innerHTML = buildBoardHTML(tiles)
}
