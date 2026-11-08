// Blank picker viewport fit (issue #90): the A-Z sheet stays fully inside
// the viewport at the smallest supported phone size and at a short
// desktop window, with the first row, Cancel, focus trap and Escape
// cancel all reachable. Offline flow copied from web-walk.e2e.ts.

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

// Start → setup → lobby → table, then park a blank on the star so the
// picker opens through the real Board.ts blank path.
async function openPicker(page: Page): Promise<void> {
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
  await page.evaluate(() => window.__wordtable.setRack('?ABCDEF'))
  await page.locator('#rack .tile[data-tile="?"]').first().click()
  await page.locator('.sq[data-sq="H8"]').click()
  await expect(page.locator('#blank-picker')).toBeVisible()
}

async function expectSheetFits(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const sheet = page.locator('.picker-sheet')
  await expect(sheet).toBeVisible()
  const box = await sheet.boundingBox()
  expect(box).not.toBeNull()
  const b = box as { x: number; y: number; width: number; height: number }
  expect(b.x).toBeGreaterThanOrEqual(0)
  expect(b.y).toBeGreaterThanOrEqual(0)
  expect(b.x + b.width).toBeLessThanOrEqual(width)
  expect(b.y + b.height).toBeLessThanOrEqual(height)
  // First row and the pinned Cancel are both on screen.
  await expect(
    page.locator('.picker-sheet button[data-letter="A"]'),
  ).toBeVisible()
  await expect(
    page.locator('.picker-sheet button[data-action="cancel-picker"]'),
  ).toBeVisible()
  // Viewport clamp mechanism: the 300 px sheet fits here either way, so
  // pin the rules that keep it fitted when fonts/zoom make it taller.
  const clamp = await page.evaluate(() => {
    const veil = document.querySelector<HTMLElement>('#blank-picker') as HTMLElement
    const el = document.querySelector<HTMLElement>('.picker-sheet') as HTMLElement
    const grid = document.querySelector<HTMLElement>('.picker-grid') as HTMLElement
    return {
      veilPadding: getComputedStyle(veil).padding,
      maxHeight: getComputedStyle(el).maxHeight,
      overflowY: getComputedStyle(grid).overflowY,
    }
  })
  expect(clamp.veilPadding).toBe('16px')
  expect(clamp.maxHeight).toBe(`${height - 32}px`)
  expect(clamp.overflowY).toBe('auto')
}

async function expectDialogKeyboard(page: Page): Promise<void> {
  const first = page.locator('.picker-sheet button[data-letter="A"]')
  const cancel = page.locator(
    '.picker-sheet button[data-action="cancel-picker"]',
  )
  // Tab on the last button wraps focus back to A.
  await cancel.focus()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()
  // Escape cancels through the dialog keydown contract.
  await page.keyboard.press('Escape')
  await expect(page.locator('#blank-picker')).toBeHidden()
}

test('blank picker fits 360x640 with A, Cancel, trap and Escape', async ({
  page,
}) => {
  const errors = attachUncaughtGuard(page)
  await page.setViewportSize({ width: 360, height: 640 })
  await openPicker(page)
  await expectSheetFits(page, 360, 640)
  await expectDialogKeyboard(page)
  expectNoUncaught(errors)
})

test('blank picker fits 1280x578 with A, Cancel, trap and Escape', async ({
  page,
}) => {
  const errors = attachUncaughtGuard(page)
  await page.setViewportSize({ width: 1280, height: 578 })
  await openPicker(page)
  await expectSheetFits(page, 1280, 578)
  await expectDialogKeyboard(page)
  expectNoUncaught(errors)
})
