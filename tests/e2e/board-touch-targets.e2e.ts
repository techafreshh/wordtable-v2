// Board touch targets (issue #91): the 15x15 grid must offer >=44px tap
// areas at phone width instead of the old ~22px cells. Phone-viewport walk
// against the release artifact (`node dist/server.js --port 4101` via
// `npm run serve:e2e` on :4101): every `.sq` measures >=44px at 390x844
// with tuned touch-action, then a scripted 10/10 tap-tap loop lands
// through the real `mountBoardInteractions` click path. Offline flow
// copied from blank-picker-viewport.e2e.ts; tap-tap idiom from
// web-walk.e2e.ts. Fails on any `Uncaught` page or console error.

import { expect, test, type Page } from '@playwright/test'

// Uncaught-error guard: pageerrors plus console errors fail the test on
// any message containing `Uncaught`.
function attachUncaughtGuard(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function expectNoUncaught(errors: string[]): void {
  expect(errors.filter((m) => m.includes('Uncaught'))).toEqual([])
}

// Start → setup → lobby → table, then reseed deterministically and park a
// blank-free rack so tap-tap never detours through the blank picker.
async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?nogl=1')
  await page.locator('.screen-start [data-action="play"]').click()
  await expect(page.locator('#seat-picker')).toBeVisible()
  await page.locator('#start-game').click()
  await expect(page.locator('#lobby-start')).toBeVisible()
  await page.locator('#lobby-start').click()
  await expect(page.locator('.screen-table #pass-button')).toBeVisible()
  await page.evaluate(() =>
    window.__wordtable.startSession(['Ann', 'Bo'], [false, false], 5),
  )
  // Seven tiles max (the store slices to 7): C/A/B cover every rep face.
  await page.evaluate(() => window.__wordtable.setRack('CAABAAA'))
}

test('board cells meet the 44px touch floor at phone width', async ({
  page,
}) => {
  const errors = attachUncaughtGuard(page)
  await openTable(page)

  // Every one of the 225 squares measures >=44px border-box.
  const sizes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sq')).map((el) => {
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height }
    }),
  )
  expect(sizes).toHaveLength(225)
  for (const s of sizes) {
    expect(s.w).toBeGreaterThanOrEqual(44)
    expect(s.h).toBeGreaterThanOrEqual(44)
  }

  // Taps place without double-tap-zoom delay while gesture scroll stays
  // in the host scroller.
  const touch = await page.evaluate(() => {
    const sq = document.querySelector(
      '.sq[data-sq="H8"]',
    ) as HTMLElement | null
    if (!sq) return null
    const host = document.querySelector('.board-host') as HTMLElement | null
    const hostStyle = host ? getComputedStyle(host) : null
    return {
      sq: getComputedStyle(sq).touchAction,
      overflowX: hostStyle?.overflowX ?? null,
      scrollWidth: host?.scrollWidth ?? 0,
      clientWidth: host?.clientWidth ?? 0,
    }
  })
  expect(touch).not.toBeNull()
  expect(touch?.sq).toBe('manipulation')
  expect(['auto', 'scroll']).toContain(touch?.overflowX)
  expect(touch?.scrollWidth ?? 0).toBeGreaterThan(touch?.clientWidth ?? 0)

  expectNoUncaught(errors)
})

test('tap-tap lands 10/10 at phone width', async ({ page }) => {
  const errors = attachUncaughtGuard(page)
  await openTable(page)

  const reps: Array<{ sq: string; face: string }> = [
    { sq: 'C8', face: 'C' },
    { sq: 'D8', face: 'A' },
    { sq: 'E8', face: 'A' },
    { sq: 'F8', face: 'A' },
    { sq: 'G8', face: 'A' },
    { sq: 'H8', face: 'A' },
    { sq: 'I8', face: 'A' },
    { sq: 'J8', face: 'B' },
    { sq: 'K8', face: 'A' },
    { sq: 'L8', face: 'C' },
  ]
  let landed = 0
  for (const { sq, face } of reps) {
    // Tap-tap: select the rack tile by face, then tap the target square.
    await page.locator(`#rack .tile[data-tile="${face}"]`).first().click()
    await page.locator(`.sq[data-sq="${sq}"]`).click()
    await expect(
      page.locator(`.sq[data-sq="${sq}"] .tile.pending`),
    ).toHaveAttribute('data-tile', face)
    landed += 1
    // Recall resets the scratch so every rep starts from a full rack.
    await page.locator('#rack-actions [data-action="recall"]').click()
    await expect(
      page.locator(`.sq[data-sq="${sq}"] .tile.pending`),
    ).toHaveCount(0)
  }
  expect(landed).toBe(10)

  expectNoUncaught(errors)
})
