// clean-dist (issue #24) — empties `dist/` so rebuilds start from a clean
// slate. The client build (`vite.config.ts`, `root: 'client'`) emits to
// `../dist/client`, outside the Vite project root, so Vite refuses to empty
// it (`outDir ... is not inside project root and will not be emptied`) and
// stale hashed assets could linger across rebuilds. Run once up front via
// `npm run build`; never between the client and server steps (the server
// config keeps `emptyOutDir: false` so it appends `dist/server.js`).
import { rmSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const target = process.argv[2] ? resolve(root, process.argv[2]) : join(root, 'dist')
const rel = relative(root, target)
if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
  console.error(`clean-dist: refusing to remove outside the repo: ${target}`)
  process.exit(1)
}

try {
  rmSync(target, { recursive: true, force: true })
  console.log(`clean-dist: removed ${target}`)
} catch (err) {
  console.error(`clean-dist: failed to remove ${target}: ${err}`)
  process.exit(1)
}
