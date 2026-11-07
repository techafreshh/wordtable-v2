// Seeded bot-vs-bot soak harness: plays full headless games through the
// LocalGame facade with generateBotMove, asserting every move validates and
// every game ends by rule with zero illegal states.
//
// Usage: npm run soak -- --games 20 --seed 42
// Workers fan games out over worker_threads (one Dictionary load per worker);
// the parent sorts results by game index so stdout stays deterministic.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { LocalGame, type PlaceSpec } from '../shared/engine/local'
import { generateBotMove } from '../shared/engine/bot'
import { Dictionary } from '../shared/engine/dictionary'
import { GameStatus } from '../shared/engine/game'

export interface SoakGameResult {
  gameIndex: number
  seed: number
  plies: number
  endReason: string | null
  scores: number[]
  illegal: number
}

export const SOAK_MAX_PLIES = 1500
const LEGAL_ENDINGS = new Set(['SIX_SCORELESS', 'BAG_EMPTY_OUT'])

function faceOfTile(tile: { face: string; isBlank: boolean }): string {
  return tile.isBlank ? '?' : tile.face
}

// Plays one deterministic 2-seat bot-vs-bot game: per-game seed
// baseSeed + gameIndex, per-move bot seed baseSeed * 100003 + gameIndex * 1009
// + ply. Bot passes fall back to a full-rack exchange while the bag holds 7+
// tiles, else a pass. Any facade rejection counts as an illegal state, aborts
// the game, and is reported (never thrown).
export function playSoakGame(
  gameIndex: number,
  baseSeed: number,
  isWord: (word: string) => boolean,
): SoakGameResult {
  const seed = baseSeed + gameIndex
  const game = new LocalGame(['SoakA', 'SoakB'], seed, isWord)
  let illegal = 0
  let plies = 0
  while (plies < SOAK_MAX_PLIES) {
    const state = game.getState()
    if (state.status !== GameStatus.PLAYING) break
    const seat = state.turn
    const move = generateBotMove(state.board, state.racks[seat], isWord, {
      seed: baseSeed * 100003 + gameIndex * 1009 + plies,
    })
    if ('pass' in move) {
      if (state.bagRemaining >= 7) {
        const result = game.exchange(
          seat,
          state.racks[seat].map(faceOfTile),
        )
        if (!result.ok) {
          illegal += 1
          console.error(
            `soak game ${gameIndex} ply ${plies}: illegal exchange ${JSON.stringify(result)}`,
          )
          break
        }
      } else {
        const result = game.pass(seat)
        if (!result.ok) {
          illegal += 1
          console.error(
            `soak game ${gameIndex} ply ${plies}: illegal pass ${JSON.stringify(result)}`,
          )
          break
        }
      }
    } else {
      const specs: PlaceSpec[] = move.placements.map((p) =>
        p.tile.isBlank
          ? { square: { row: p.row, col: p.col }, face: '?', as: p.tile.blankAs }
          : { square: { row: p.row, col: p.col }, face: p.tile.face },
      )
      const result = game.place(seat, specs)
      if (!result.ok) {
        illegal += 1
        console.error(
          `soak game ${gameIndex} ply ${plies}: illegal place ${JSON.stringify(result)}`,
        )
        break
      }
    }
    plies += 1
  }
  const final = game.getState()
  if (final.status !== GameStatus.PLAYING && illegal === 0) {
    // Ended by rule; endReason is asserted by the caller.
  } else if (plies >= SOAK_MAX_PLIES && final.status === GameStatus.PLAYING) {
    console.error(`soak game ${gameIndex}: exceeded ply cap ${SOAK_MAX_PLIES}`)
  }
  return {
    gameIndex,
    seed,
    plies,
    endReason: final.endReason,
    scores: [...final.scores],
    illegal,
  }
}

function parseArgs(args: string[]): { games: number; seed: number; jobs: number } {
  let games = 20
  let seed = 42
  let jobs = 0
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const [flag, inline] = arg.startsWith('--') ? arg.slice(2).split('=', 2) : ['', undefined]
    const next = (): string | undefined => (inline !== undefined ? inline : args[i + 1])
    if (flag === 'games') {
      const value = Number(next())
      if (!Number.isInteger(value) || value < 0) throw new Error(`--games must be a non-negative integer, got ${next()}`)
      games = value
      if (inline === undefined) i += 1
    } else if (flag === 'seed') {
      const value = Number(next())
      if (!Number.isInteger(value)) throw new Error(`--seed must be an integer, got ${next()}`)
      seed = value
      if (inline === undefined) i += 1
    } else if (flag === 'jobs') {
      const value = Number(next())
      if (!Number.isInteger(value) || value < 1) throw new Error(`--jobs must be a positive integer, got ${next()}`)
      jobs = value
      if (inline === undefined) i += 1
    } else {
      throw new Error(`unknown argument: ${arg} (expected --games N --seed N [--jobs N])`)
    }
  }
  return { games, seed, jobs }
}

function runWorkers(chunks: number[][], seed: number): Promise<SoakGameResult[]> {
  return new Promise((resolvePromise, reject) => {
    const all: SoakGameResult[] = []
    let done = 0
    let failed = false
    for (const chunk of chunks) {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { games: chunk, seed },
      })
      worker.on('message', (msg: SoakGameResult[]) => {
        all.push(...msg)
      })
      worker.on('error', (err) => {
        if (!failed) {
          failed = true
          reject(err)
        }
      })
      worker.on('exit', (code) => {
        if (failed) return
        if (code !== 0) {
          failed = true
          reject(new Error(`soak worker exited with code ${code}`))
          return
        }
        done += 1
        if (done === chunks.length) resolvePromise(all)
      })
    }
  })
}

async function main(): Promise<number> {
  let games = 20
  let seed = 42
  let jobs = 0
  try {
    ;({ games, seed, jobs } = parseArgs(process.argv.slice(2)))
  } catch (err) {
    console.error(`soak: ${err instanceof Error ? err.message : err}`)
    return 2
  }
  if (games === 0) {
    console.log('SOAK: 0 games, 0 illegal states')
    return 0
  }
  const parallelism = Math.min(games, Math.max(1, jobs || availableParallelism()), 8)
  const chunks: number[][] = Array.from({ length: parallelism }, () => [])
  for (let i = 0; i < games; i++) chunks[i % parallelism].push(i)
  let results: SoakGameResult[]
  try {
    results = await runWorkers(
      chunks.filter((c) => c.length > 0),
      seed,
    )
  } catch (err) {
    console.error(`SOAK FAILED: ${err instanceof Error ? err.message : err}`)
    return 1
  }
  results.sort((a, b) => a.gameIndex - b.gameIndex)
  let illegalTotal = 0
  let badEndings = 0
  for (const r of results) {
    illegalTotal += r.illegal
    if (r.endReason === null || !LEGAL_ENDINGS.has(r.endReason)) badEndings += 1
    console.log(
      `game ${r.gameIndex}/${games} seed=${r.seed} plies=${r.plies} endReason=${r.endReason} scores=[${r.scores.join(',')}] illegal=${r.illegal}`,
    )
  }
  if (illegalTotal === 0 && badEndings === 0) {
    console.log(`SOAK: ${games} games, 0 illegal states`)
    return 0
  }
  console.error(
    `SOAK FAILED: ${illegalTotal} illegal states, ${badEndings} bad endings across ${games} games`,
  )
  return 1
}

if (!isMainThread) {
  const { games, seed } = workerData as { games: number[]; seed: number }
  const dict = await Dictionary.loadFromFile()
  const isWord = (word: string): boolean => dict.isWord(word)
  const results: SoakGameResult[] = []
  for (const gameIndex of games) results.push(playSoakGame(gameIndex, seed, isWord))
  parentPort!.postMessage(results)
}

const invokedAsScript =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainThread && invokedAsScript) {
  process.exitCode = await main()
}
