// Room registry — pure room/seat/token ownership, no sockets or JSON here.
// The ws dispatcher in ./ws.ts maps wire envelopes onto this class.
import { randomBytes } from 'node:crypto'

export const MAX_SEATS = 4
export const CODE_LENGTH = 4

export interface Seat {
  seat: number
  name: string
  token: string
}

export interface Room {
  code: string
  seats: Seat[]
}

export type JoinResult =
  | { ok: true; room: Room; seat: Seat }
  | { ok: false; error: 'NO_ROOM' | 'ROOM_FULL' | 'BAD_TOKEN' }

export type RejoinResult =
  | { ok: true; room: Room; seat: Seat }
  | { ok: false; error: 'NO_ROOM' | 'NO_TOKEN' | 'BAD_TOKEN' }

/** Trim + uppercase; empty/missing input yields ''. */
export function normalizeCode(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  return String(raw).trim().toUpperCase()
}

/** Trim + truncate to 16 chars, defaulting to 'Player' when absent/blank. */
export function normalizeName(raw: unknown): string {
  if (raw === undefined || raw === null) return 'Player'
  const text = String(raw).trim()
  if (text === '') return 'Player'
  return text.slice(0, 16)
}

/** Trim; empty/missing input yields undefined (no token supplied). */
export function normalizeToken(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const text = String(raw).trim()
  return text === '' ? undefined : text
}

/** Random 4-letter uppercase code (letters only, no digits). */
export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String.fromCharCode(65 + (bytes[i] % 26))
  }
  return code
}

/** Random per-device session token (32 hex chars). */
export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()

  get size(): number {
    return this.rooms.size
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code)
  }

  create(name?: unknown): { room: Room; seat: Seat } {
    let code = generateCode()
    while (this.rooms.has(code)) code = generateCode()
    const seat: Seat = { seat: 0, name: normalizeName(name), token: generateToken() }
    const room: Room = { code, seats: [seat] }
    this.rooms.set(code, room)
    return { room, seat }
  }

  join(codeRaw: unknown, nameRaw?: unknown, tokenRaw?: unknown): JoinResult {
    const code = normalizeCode(codeRaw)
    if (code === '') return { ok: false, error: 'NO_ROOM' }
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: 'NO_ROOM' }
    const token = normalizeToken(tokenRaw)
    if (token !== undefined) {
      const existing = room.seats.find((s) => s.token === token)
      if (existing) return { ok: true, room, seat: existing }
      return { ok: false, error: 'BAD_TOKEN' }
    }
    if (room.seats.length >= MAX_SEATS) return { ok: false, error: 'ROOM_FULL' }
    const seat: Seat = { seat: room.seats.length, name: normalizeName(nameRaw), token: generateToken() }
    room.seats.push(seat)
    return { ok: true, room, seat }
  }

  rejoin(codeRaw: unknown, tokenRaw?: unknown): RejoinResult {
    const code = normalizeCode(codeRaw)
    if (code === '') return { ok: false, error: 'NO_ROOM' }
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: 'NO_ROOM' }
    const token = normalizeToken(tokenRaw)
    if (token === undefined) return { ok: false, error: 'NO_TOKEN' }
    const seat = room.seats.find((s) => s.token === token)
    if (!seat) return { ok: false, error: 'BAD_TOKEN' }
    return { ok: true, room, seat }
  }
}
