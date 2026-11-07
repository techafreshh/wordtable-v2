// Bundle-budget gate (issue #21) — sums gzip bytes of
// `dist/client/assets/*.js` and exits non-zero when the total reaches
// 800 KiB. CSS/images are excluded: only shipped JS counts.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const LIMIT = 800 * 1024

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'dist', 'client', 'assets')
if (!existsSync(assets)) {
  console.error(`check-bundle: missing ${assets}; run \`npm run build\` first`)
  process.exit(1)
}

let total = 0
const rows = []
for (const entry of readdirSync(assets)) {
  if (!entry.endsWith('.js')) continue
  const bytes = gzipSync(readFileSync(join(assets, entry))).length
  rows.push(`${entry}: ${bytes} B gzip`)
  total += bytes
}

for (const row of rows.sort()) console.log(`check-bundle: ${row}`)
console.log(`check-bundle: total JS gzip ${total} B (limit ${LIMIT} B)`)
if (total >= LIMIT) {
  console.error('check-bundle: FAIL — bundle exceeds the 800 KiB JS gzip budget')
  process.exit(1)
}
console.log('check-bundle: PASS')
