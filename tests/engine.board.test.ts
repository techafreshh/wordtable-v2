import { describe, it, expect } from 'vitest'
import {
  BOARD_SIZE,
  premiumAt,
  parseSquare,
  toAlgebra,
} from '../shared/engine/board'

describe('board algebra', () => {
  it('maps H8 to row 7 col 7 and back', () => {
    expect(parseSquare('H8')).toEqual({ row: 7, col: 7 })
    expect(toAlgebra(7, 7)).toBe('H8')
  })

  it('accepts digit-first form and is case/whitespace tolerant', () => {
    expect(parseSquare('8H')).toEqual({ row: 7, col: 7 })
    expect(parseSquare(' h8 ')).toEqual({ row: 7, col: 7 })
    expect(parseSquare('a1')).toEqual({ row: 0, col: 0 })
  })

  it('round-trips the corners', () => {
    expect(parseSquare('A1')).toEqual({ row: 0, col: 0 })
    expect(parseSquare('O15')).toEqual({ row: 14, col: 14 })
    expect(toAlgebra(0, 0)).toBe('A1')
    expect(toAlgebra(14, 14)).toBe('O15')
    expect(parseSquare(toAlgebra(0, 14))).toEqual({ row: 0, col: 14 })
    expect(parseSquare(toAlgebra(14, 0))).toEqual({ row: 14, col: 0 })
  })

  it('rejects unknown squares', () => {
    expect(() => parseSquare('Z99')).toThrow()
    expect(() => parseSquare('')).toThrow()
    expect(() => parseSquare('P16')).toThrow()
  })
})

describe('board premiums', () => {
  it('has STAR at the center H8', () => {
    expect(premiumAt(7, 7)).toBe('STAR')
  })

  it('has exactly 8 triple-word squares', () => {
    let tw = 0
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (premiumAt(r, c) === 'TW') tw++
      }
    }
    expect(tw).toBe(8)
  })

  it('pins the triple-word squares', () => {
    for (const [r, c] of [
      [0, 0],
      [0, 7],
      [0, 14],
      [7, 0],
      [7, 14],
      [14, 0],
      [14, 7],
      [14, 14],
    ] as const) {
      expect(premiumAt(r, c)).toBe('TW')
    }
  })

  it('spots check known premiums', () => {
    expect(premiumAt(0, 0)).toBe('TW')
    expect(premiumAt(1, 1)).toBe('DW')
    expect(premiumAt(0, 3)).toBe('DL')
    expect(premiumAt(1, 5)).toBe('TL')
    expect(premiumAt(7, 6)).toBe('PLAIN')
  })

  it('is symmetric under 180-degree rotation and mirroring', () => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(premiumAt(r, c)).toBe(premiumAt(14 - r, 14 - c))
        expect(premiumAt(r, c)).toBe(premiumAt(r, 14 - c))
        expect(premiumAt(r, c)).toBe(premiumAt(14 - r, c))
      }
    }
  })

  it('rejects out-of-bounds access', () => {
    expect(() => premiumAt(-1, 0)).toThrow()
    expect(() => premiumAt(15, 15)).toThrow()
    expect(() => toAlgebra(-1, 0)).toThrow()
  })
})
