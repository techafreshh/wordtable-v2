// Web walk (issue #19) — phone-viewport browser proofs against the
// static build: offline tap-tap commit (rack → squares → Play) and an
// online two-context reload-resume (create → join → start → place →
// reload → same turn, committed tiles restored).
import { expect, test } from '@playwright/test'
import { WebSocket } from 'ws'

const SERVER_URL = 'ws://127.0.0.1:4101'

interface NetState {
  status: string
  code: string | null
  token: string | null
  seat: number | null
}

test('offline tap-tap walk commits HELLO', async ({ page }) => {
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
})

test('online reload resumes the same turn with committed tiles', async ({ browser }) => {
  const alice = await browser.newContext()
  const bob = await browser.newContext()
  const pageA = await alice.newPage()
  const pageB = await bob.newPage()
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
    await alice.close()
    await bob.close()
  }
})
