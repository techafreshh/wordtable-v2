import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BOARD_SIZE,
  buildBoardHTML,
  premiumKindAt,
  squareLabel,
} from '../../client/src/components/Board'

const CLIENT_STYLES = new URL('../../client/styles/', import.meta.url)
const SRC_STYLES = new URL('../../client/src/styles/', import.meta.url)

function css(dir: URL, name: string): string {
  return readFileSync(new URL(name, dir), 'utf8')
}

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

describe('Board markup', () => {
  it('exports a 15x15 board', () => {
    expect(BOARD_SIZE).toBe(15)
  })

  it('builds exactly 225 .sq cells inside one .board', () => {
    const html = buildBoardHTML()
    expect(html).toContain('class="board"')
    expect(count(/class="sq /g, html)).toBe(225)
    expect(count(/data-premium="/g, html)).toBe(225)
    expect(count(/data-sq="/g, html)).toBe(225)
  })

  it('renders exactly one star at H8 containing ★', () => {
    const html = buildBoardHTML()
    expect(html).toContain('data-sq="H8"')
    expect(count(/★/g, html)).toBe(1)
    expect(html).toContain('data-sq="H8" data-premium="STAR"')
    expect(count(/sq-star/g, html)).toBe(1)
  })

  it('matches the premium census (TW 8, DW 16, TL 12, DL 24, STAR 1)', () => {
    const tally: Record<string, number> = {}
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const kind = premiumKindAt(r, c)
        tally[kind] = (tally[kind] ?? 0) + 1
      }
    }
    expect(tally).toMatchObject({ TW: 8, DW: 16, TL: 12, DL: 24, STAR: 1, PLAIN: 164 })
  })

  it('is symmetric under rotation and mirroring', () => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(premiumKindAt(r, c)).toBe(premiumKindAt(14 - r, 14 - c))
        expect(premiumKindAt(r, c)).toBe(premiumKindAt(r, 14 - c))
      }
    }
  })

  it('labels squares letter-first (H8 at row 7 col 7)', () => {
    expect(squareLabel(7, 7)).toBe('H8')
    expect(squareLabel(0, 0)).toBe('A1')
    expect(squareLabel(14, 14)).toBe('O15')
  })

  it('rejects out-of-bounds access', () => {
    expect(() => premiumKindAt(-1, 0)).toThrow(RangeError)
    expect(() => premiumKindAt(15, 15)).toThrow(RangeError)
    expect(() => squareLabel(0, 15)).toThrow(RangeError)
  })

  it('renders supplied tiles with the ivory bevel class', () => {
    const html = buildBoardHTML({ H8: 'A' })
    expect(html).toContain('class="tile"')
    expect(count(/class="sq /g, html)).toBe(225)
  })
})

describe('Board stylesheets', () => {
  it('defines the contracted tokens in client/styles/tokens.css', () => {
    const tokens = css(CLIENT_STYLES, 'tokens.css')
    for (const name of ['--felt:', '--wood:', '--ivory:', '--brass:']) {
      expect(tokens).toContain(name)
    }
    expect(tokens.match(/^  --/gm)?.length ?? 0).toBeGreaterThanOrEqual(10)
  })

  it('ships board.css on both style paths with grid, premiums and bevel', () => {
    for (const dir of [CLIENT_STYLES, SRC_STYLES]) {
      const board = css(dir, 'board.css')
      for (const marker of [
        '.board',
        '.sq',
        '.sq-tw',
        '.sq-dw',
        '.sq-tl',
        '.sq-dl',
        '.sq-star',
        '.sq-plain',
        '.tile',
        'linear-gradient',
      ]) {
        expect(board).toContain(marker)
      }
      expect(board).toContain('repeat(15, 1fr)')
      expect(board).not.toContain('board-cell')
    }
  })

  it('paints the body backdrop as a gradient', () => {
    const board = css(CLIENT_STYLES, 'board.css')
    expect(board).toContain('linear-gradient(')
  })
})
