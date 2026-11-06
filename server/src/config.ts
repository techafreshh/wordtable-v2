export const DEFAULT_PORT = 9080

export function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

export function parsePortArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length)
      if (value) return value
      continue
    }
    if (arg === '--port' && i + 1 < argv.length) {
      return argv[i + 1]
    }
  }
  return undefined
}

export function resolvePort(cliArg?: string, envValue?: string): number {
  if (cliArg !== undefined && cliArg !== '') {
    const n = Number(cliArg)
    if (isValidPort(n)) return n
  }
  const raw = envValue ?? process.env.PORT
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (isValidPort(n)) return n
  }
  return DEFAULT_PORT
}
