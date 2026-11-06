// Bot seat pacing — pure think-delay math, no sockets/timers/game imports.
// The room registry owns the seat, the binding owns the clock; this module
// owns only the delay formula so it unit-tests without a binding.
export const BOT_NAME = 'Botgomery';

/** Think delay in seconds: 5 + abs(seed) % 11 (non-finite -> 5). */
export function botThinkDelaySecs(seed: unknown): number {
  const n = typeof seed === 'number' ? seed : Number(seed);
  if (!Number.isFinite(n)) return 5;
  return 5 + (Math.abs(Math.floor(n)) % 11);
}

/** Think delay in milliseconds. */
export function botThinkDelayMs(seed: unknown): number {
  return botThinkDelaySecs(seed) * 1000;
}

/** True when the seat name is the bot seat. */
export function isBotSeatName(name: unknown): boolean {
  return name === BOT_NAME;
}
