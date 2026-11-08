// Float-score feedback — shared commit payoff (issue #85, moved verbatim
// from Table.ts per issue #96). #float-score mounts synchronously on
// commit (well inside the 500 ms acceptance window); CSS float-up fades
// it and a timer clears it.

export function buildFloatScoreHTML(points: number): string {
  return `<div id="float-score" class="score-float" role="status">+${points}</div>`
}

let floatTimer: ReturnType<typeof setTimeout> | null = null

// Shared commit feedback (issue #85): the session table reuses the exact
// float/slam behavior, so both stay exported with markup and timing intact.
export function appendFloatScore(points: number): void {
  const layer = document.getElementById('float-layer')
  if (!layer) return
  if (floatTimer !== null) clearTimeout(floatTimer)
  layer.innerHTML = buildFloatScoreHTML(points)
  floatTimer = setTimeout(() => {
    floatTimer = null
    layer.innerHTML = ''
  }, 950)
}

export function markCommitSlam(): void {
  for (const el of Array.from(document.querySelectorAll('.tile.last-move'))) {
    el.classList.add('slam')
  }
}
