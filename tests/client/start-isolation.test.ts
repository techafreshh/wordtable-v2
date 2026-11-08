// Start isolation (issue #86): `#/` paints only the StartScreen — a
// single `<h1>` with nickname plus Create/Join/Play now and no legacy
// table skeleton. Static source assertions prove the start branch never
// references the legacy Table, mirroring the bundle.test.ts idiom
// (vitest has no DOM environment).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildStartScreenHTML } from '../../client/src/components/StartScreen'

const REPO_ROOT = new URL('../../', import.meta.url)

function mainSrc(): string {
  return readFileSync(new URL('client/src/main.ts', REPO_ROOT), 'utf8')
}

// The `case 'start'` block: text between `case 'start'` and its `break`.
function startBlock(): string {
  const src = mainSrc()
  const begin = src.indexOf("case 'start'")
  expect(begin).toBeGreaterThanOrEqual(0)
  const end = src.indexOf('break', begin)
  expect(end).toBeGreaterThan(begin)
  return src.slice(begin, end)
}

function count(re: RegExp, html: string): number {
  return (html.match(re) ?? []).length
}

describe('start screen builder isolation', () => {
  it('renders exactly one <h1> with the three action buttons', () => {
    const html = buildStartScreenHTML('')
    expect(count(/<h1/g, html)).toBe(1)
    for (const action of ['create', 'join', 'play']) {
      expect(html).toContain(`data-action="${action}"`)
    }
  })

  it('contains no legacy table nodes', () => {
    const html = buildStartScreenHTML('')
    expect(html).not.toContain('main.table')
    expect(html).not.toContain('class="table"')
    expect(html).not.toContain('id="rack"')
    expect(html).not.toContain('board-host')
    expect(html).not.toContain('prov-score')
    expect(html).not.toContain('table-actions')
  })
})

describe('start route isolation in main.ts', () => {
  it('paints StartScreen plus toast with no legacy Table', () => {
    const block = startBlock()
    expect(block).toContain('buildStartScreenHTML')
    expect(block).toContain('buildToastHTML')
    expect(block).toContain('mountToast')
    expect(block).not.toContain('tableSkeletonHTML')
    expect(block).not.toContain('mountTable')
    expect(block).not.toContain('renderTable')
    expect(block).not.toContain('repaintLegacyTable')
  })
})
