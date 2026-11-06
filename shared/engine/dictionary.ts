// Shared engine — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.
// The file loader below reaches node builtins only through indirect dynamic
// `import()` of a `string` variable (never a literal specifier) plus a
// `globalThis` sniff for `process.cwd()`, so this file still typechecks in
// the client project (browser-only lib/types) and never lets Vite statically
// pull a `node:` module into the browser bundle. Only call loadFromFile on
// the server.

// Default lookup chain: explicit path wins, otherwise try each candidate in
// order, resolved against the process working directory (assets first,
// dictionaries fallback).
export const DEFAULT_DICTIONARY_PATHS: readonly string[] = [
  'assets/sowpods.txt',
  'dictionaries/sowpods.txt',
]

// Split raw word-list text into normalized uppercase entries. Keeps only
// non-empty A-Z tokens; callers get no blanks, no lowercase, no punctuation.
export function parseWordList(text: string): string[] {
  const words: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().toUpperCase()
    if (w !== '' && /^[A-Z]+$/.test(w)) words.push(w)
  }
  return words
}

// Indirect specifiers stay `string`-typed so `tsc` does not resolve them as
// modules (which would fail in the browser-typed client project) and Vite
// cannot statically bundle them. Only ever imported on the server.
const FS_SPEC: string = 'node:fs/promises'
const PATH_SPEC: string = 'node:path'

interface FsPromises {
  readFile(path: string, encoding: string): Promise<string>
}

interface PathUtil {
  isAbsolute(p: string): boolean
  join(...parts: string[]): string
}

function baseDir(): string {
  const g = globalThis as unknown as {
    process?: { cwd?: () => string }
  }
  const cwd = g.process?.cwd
  if (typeof cwd === 'function') {
    try {
      return cwd.call(g.process)
    } catch {
      return '.'
    }
  }
  return '.'
}

export class Dictionary {
  private words: Set<string>

  private constructor(words: Set<string>) {
    this.words = words
  }

  static fromText(text: string): Dictionary {
    return new Dictionary(new Set(parseWordList(text)))
  }

  static async loadFromFile(path?: string): Promise<Dictionary> {
    const fs = (await import(/* @vite-ignore */ FS_SPEC)) as FsPromises
    const pathMod = (await import(/* @vite-ignore */ PATH_SPEC)) as PathUtil
    const candidates =
      path !== undefined && path !== '' ? [path] : [...DEFAULT_DICTIONARY_PATHS]
    const tried: string[] = []
    for (const candidate of candidates) {
      const resolved = pathMod.isAbsolute(candidate)
        ? candidate
        : pathMod.join(baseDir(), candidate)
      tried.push(resolved)
      try {
        const text = await fs.readFile(resolved, 'utf8')
        return Dictionary.fromText(text)
      } catch {
        // Missing/unreadable candidate: fall through to the next one.
      }
    }
    throw new Error(
      `Dictionary.loadFromFile: no word list found (tried: ${tried.join(', ')})`,
    )
  }

  get size(): number {
    return this.words.size
  }

  isWord(word: string): boolean {
    const w = word.trim().toUpperCase()
    if (w === '' || !/^[A-Z]+$/.test(w)) return false
    return this.words.has(w)
  }
}
