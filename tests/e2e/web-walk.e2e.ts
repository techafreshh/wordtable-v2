// Web walk (issue #19, hardened issue #21) — phone-viewport browser proofs
// against the single-port server (`npm run serve:e2e` on :4101): an offline
// tap-tap commit (rack → squares → Play), an online two-context
// reload-resume (create → join → start → place → reload → same turn,
// committed tiles restored), the offline Start → setup → lobby → table →
// recap → rematch loop, and an online bot game (create → add_bot → start →
// pass → bot moves → chat). Every test fails on any `Uncaught` page or
// console error.
import { expect, test, type Page } from '@playwright/test'
import { WebSocket } from 'ws'

const SERVER_URL = 'ws://127.0.0.1:4101'

interface NetState {
  status: string
  code: string | null
  token: string | null
  seat: number | null
}

// Uncaught-error guard: pageerrors (uncaught exceptions, unhandled
// rejections) plus console errors are collected per page; the test fails
// when any collected message contains `Uncaught`.
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

test('offline tap-tap walk commits HELLO', async ({ page }) => {
  const errors = attachUncaughtGuard(page)
  await page.goto('/?rack=HELLOAB&nogl=1')
  const faces = ['H', 'E', 'L', 'L', 'O']
  const squares = ['H8', 'I8', 'J8', 'K8', 'L8']
  for (let k = 0; k < faces.length; k++) {
    // Tap-tap: select the rack tile by face (indices shift as tiles
    // leave the rack), then tap the target square.
    await page.locator(`#rack .tile[data-tile="${faces[k]}"]`).first().click()
    await page.locator(`.sq[data-sq="${squares[k]}"]`).click()
  }
  await expect(page.locator('#prov-score')).not.toHaveText('0 pts')
  await page.locator('.table-actions [data-action="play"]').click()
  await expect(page.locator('.tile.last-move')).toHaveCount(5)
  const floatText = await page.locator('#float-score').textContent({ timeout: 2000 })
  expect(floatText ?? '').toContain('+')
  expectNoUncaught(errors)
})

test('online reload resumes the same turn with committed tiles', async ({ browser }) => {
  const alice = await browser.newContext()
  const bob = await browser.newContext()
  const pageA = await alice.newPage()
  const pageB = await bob.newPage()
  const errorsA = attachUncaughtGuard(pageA)
  const errorsB = attachUncaughtGuard(pageB)
  try {
    await pageA.goto(`/?server-url=${SERVER_URL}&nogl=1`)
    await pageB.goto(`/?server-url=${SERVER_URL}&nogl=1`)

    const created = await pageA.evaluate(() => window.__wordtable.createRoom('Ann'))
    expect(created.ok).toBe(true)
    const netA = (await pageA.evaluate(
      () => window.__wordtable.netState(),
    )) as NetState
    expect(netA.code).toMatch(/^[A-Z]{4}$/)
    const code = netA.code as string
    const tokenA = netA.token as string

    const joined = await pageB.evaluate(
      ([roomCode]: string[]) => window.__wordtable.joinRoom(roomCode, 'Bo'),
      [code],
    )
    expect(joined.ok).toBe(true)

    const started = await pageA.evaluate(() => window.__wordtable.startGame())
    expect(started.ok).toBe(true)

    // Pin seat 0 to a HELLO rack over a raw Node socket (no client intent).
    const debug = new WebSocket(SERVER_URL)
    await new Promise<void>((resolve, reject) => {
      debug.once('open', () => resolve())
      debug.once('error', (err) => reject(err))
    })
    const pinned: unknown = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('debug_set_rack timed out')), 5000)
      debug.once('message', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(String(data)))
      })
      debug.send(
        JSON.stringify({
          v: 1,
          m: 'debug_set_rack',
          code,
          token: tokenA,
          seat: 0,
          rack: ['H', 'E', 'L', 'L', 'O', 'A', 'B'],
        }),
      )
    })
    expect((pinned as Record<string, unknown>)['ok']).toBe(true)
    debug.terminate()

    const placed = await pageA.evaluate(() =>
      window.__wordtable.placeOnline([
        { square: 'H8', face: 'H' },
        { square: 'I8', face: 'E' },
        { square: 'J8', face: 'L' },
        { square: 'K8', face: 'L' },
        { square: 'L8', face: 'O' },
      ]),
    )
    expect(placed.ok).toBe(true)
    await expect(pageA.locator('.tile.last-move')).toHaveCount(5)
    const turnBefore = (await pageA.evaluate(
      () => window.__wordtable.getState().turn,
    )) as number

    await pageA.reload()
    await pageA.waitForFunction(
      () => window.__wordtable.netState().status === 'online',
    )
    const turnAfter = (await pageA.evaluate(
      () => window.__wordtable.getState().turn,
    )) as number
    expect(turnAfter).toBe(turnBefore)
    await expect(pageA.locator('.tile.last-move')).toHaveCount(5)
  } finally {
    expectNoUncaught(errorsA)
    expectNoUncaught(errorsB)
    await alice.close()
    await bob.close()
  }
})

test('offline full loop Start to rematch', async ({ page }) => {
  const errors = attachUncaughtGuard(page)
  await page.goto('/?nogl=1')
  // Start → seat picker.
  await page.locator('.screen-start [data-action="play"]').click()
  await expect(page.locator('#seat-picker')).toBeVisible()
  // Seat picker → lobby (Player-N defaults, no bots).
  await page.locator('#start-game').click()
  await expect(page.locator('#lobby-start')).toBeVisible()
  // Lobby → table.
  await page.locator('#lobby-start').click()
  await expect(page.locator('.screen-table #pass-button')).toBeVisible()
  // Six scoreless passes end the hot-seat game (hook drives turns).
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.__wordtable.pass()
  })
  await expect(page.locator('.screen-recap')).toBeVisible()
  // Rematch deals a fresh table with the same seats.
  await page.locator('#rematch').click()
  await expect(page.locator('.screen-table #pass-button')).toBeVisible()
  expectNoUncaught(errors)
})

test('online bot game: create, add_bot, start, pass, chat', async ({ page }) => {
  const errors = attachUncaughtGuard(page)
  await page.goto(`/?server-url=${SERVER_URL}&nogl=1`)
  await page.waitForFunction(() => window.__wordtable.netState().status === 'online')

  const created = await page.evaluate(() => window.__wordtable.createRoom('Ann'))
  expect(created.ok).toBe(true)
  const net = (await page.evaluate(
    () => window.__wordtable.netState(),
  )) as NetState
  const code = net.code as string
  const token = net.token as string

  // add_bot has no client hook: a raw browser socket speaks the v1
  // envelope exactly like server/src/binding.ts expects.
  const added = (await page.evaluate(
    ([roomCode, hostToken, url]: string[]) =>
      new Promise<unknown>((resolve) => {
        const ws = new WebSocket(url)
        ws.onopen = (): void => {
          ws.send(JSON.stringify({ v: 1, m: 'add_bot', code: roomCode, token: hostToken }))
        }
        ws.onmessage = (ev): void => {
          try {
            resolve(JSON.parse(String(ev.data)))
          } catch {
            resolve({ ok: false, error: 'BAD_JSON' })
          }
          ws.close()
        }
        ws.onerror = (): void => resolve({ ok: false, error: 'SOCKET' })
      }),
    [code, token, SERVER_URL],
  )) as Record<string, unknown>
  expect(added['ok']).toBe(true)

  const started = await page.evaluate(() => window.__wordtable.startGame())
  expect(started.ok).toBe(true)

  // Host passes; the turn moves to the bot seat and the bot's think
  // delay (5-15 s) drives it back without any further intent.
  const passed = await page.evaluate(() => window.__wordtable.passOnline())
  expect(passed.ok).toBe(true)
  await page.waitForFunction(() => window.__wordtable.getState().turn === 0, null, {
    timeout: 30_000,
  })

  const chatted = await page.evaluate(() =>
    window.__wordtable.sendChatOnline('gg bot'),
  )
  expect(chatted.ok).toBe(true)
  const chat = (await page.evaluate(
    () => window.__wordtable.getState().chat,
  )) as Array<{ text: string }>
  expect(chat.some((m) => m.text.includes('gg bot'))).toBe(true)
  expectNoUncaught(errors)
})
