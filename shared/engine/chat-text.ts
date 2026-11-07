// Shared chat-text helper — pure TS, no UI deps. Keep this module free of
// DOM/Three imports so server and client validation stay identical.

/**
 * Code-point-safe truncation for chat text. Counts Unicode code points
 * (`Array.from` length) instead of UTF-16 code units, so a cut through an
 * astral character (e.g. an emoji run) never emits a trailing lone
 * surrogate. Grapheme clusters (ZWJ sequences, flags, combining marks) are
 * out of scope — only surrogate-pair integrity is guaranteed.
 */
export function truncateChatText(text: string, max = 200): string {
  return Array.from(text).slice(0, max).join('')
}
