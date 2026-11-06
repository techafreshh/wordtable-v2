// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

// 15x15 premium board with H8 algebra. Rows and columns are 0-indexed
// internally: columns A-O map to 0-14, rows 1-15 map to 0-14.

export const BOARD_SIZE = 15

export type PremiumKind = 'TW' | 'DW' | 'TL' | 'DL' | 'STAR' | 'PLAIN'

// Legend: '3' = triple word, '2' = double word, 't' = triple letter,
// 'd' = double letter, '*' = center star (scores as double word),
// '.' = plain square.
const PREMIUM_MAP: readonly string[] = [
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

function kindOf(ch: string): PremiumKind {
  switch (ch) {
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

export function premiumAt(row: number, col: number): PremiumKind {
  checkBounds(row, col, 'premiumAt')
  return kindOf(PREMIUM_MAP[row][col])
}

export interface Square {
  row: number
  col: number
}

// Accepts both `H8` (letter-first) and `8H` (digit-first) forms, matching the
// square convention in docs/protocol.md. Case- and whitespace-tolerant.
export function parseSquare(sq: string): Square {
  const s = sq.trim().toUpperCase().replace(/\s+/g, '')
  let col = -1
  let row = -1
  let m = /^([A-O])([1-9]|1[0-5])$/.exec(s)
  if (m) {
    col = m[1].charCodeAt(0) - 65
    row = Number(m[2]) - 1
  } else {
    m = /^([1-9]|1[0-5])([A-O])$/.exec(s)
    if (m) {
      row = Number(m[1]) - 1
      col = m[2].charCodeAt(0) - 65
    }
  }
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    throw new Error(`parseSquare: unknown square ${JSON.stringify(sq)}`)
  }
  return { row, col }
}

// Letter-first algebra, e.g. row 7 col 7 -> "H8".
export function toAlgebra(row: number, col: number): string {
  checkBounds(row, col, 'toAlgebra')
  return `${String.fromCharCode(65 + col)}${row + 1}`
}
