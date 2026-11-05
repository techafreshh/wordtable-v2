export const DEFAULT_PORT = 9080

export function resolvePort(cliArg?: string): number {
  if (cliArg) {
    const n = Number(cliArg)
    if (Number.isFinite(n)) return n
  }
  const env = Number(process.env.PORT)
  if (Number.isFinite(env) && env > 0) return env
  return DEFAULT_PORT
}
