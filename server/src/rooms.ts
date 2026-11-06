// Room registry — pure room/seat/token ownership, no sockets or JSON here.
// The ws dispatcher in ./ws.ts maps wire envelopes onto this class.
import { randomBytes } from 'node:crypto'
import { BOT_NAME } from './bot-seat.js'

export { BOT_NAME };

export const MAX_SEATS = 4
export const CODE_LENGTH = 4

export interface Seat {
  seat: number
  name: string
  token: string
  isBot?: boolean
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

export type AddBotResult =
  | { ok: true; room: Room; seat: Seat }
  | { ok: false; error: 'NO_ROOM' | 'ROOM_FULL' }

export type RemoveBotResult =
  | { ok: true; room: Room; removed: Seat }
  | { ok: false; error: 'NO_ROOM' | 'BAD_STATE' }

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
    const seat: Seat = { seat: 0, name: normalizeName(name), token: generateToken(), isBot: false }
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
    const seat: Seat = { seat: room.seats.length, name: normalizeName(nameRaw), token: generateToken(), isBot: false }
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

  addBot(codeRaw: unknown): AddBotResult {
    const code = normalizeCode(codeRaw)
    if (code === '') return { ok: false, error: 'NO_ROOM' }
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: 'NO_ROOM' }
    if (room.seats.length >= MAX_SEATS) return { ok: false, error: 'ROOM_FULL' }
    const seat: Seat = { seat: room.seats.length, name: BOT_NAME, token: generateToken(), isBot: true }
    room.seats.push(seat)
    return { ok: true, room, seat }
  }

  removeBot(codeRaw: unknown, seatRaw?: unknown): RemoveBotResult {
    const code = normalizeCode(codeRaw)
    if (code === '') return { ok: false, error: 'NO_ROOM' }
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: 'NO_ROOM' }
    const bots = room.seats.filter((s) => s.isBot)
    if (bots.length === 0) return { ok: false, error: 'BAD_STATE' }
    let target: Seat | undefined
    if (seatRaw === undefined || seatRaw === null) {
      target = bots[bots.length - 1]
    } else if (typeof seatRaw === 'string' && seatRaw.trim() === '') {
      target = bots[bots.length - 1]
    } else {
      const n = typeof seatRaw === 'number' ? seatRaw : Number(String(seatRaw).trim())
      if (!Number.isInteger(n)) return { ok: false, error: 'BAD_STATE' }
      target = room.seats.find((s) => s.seat === n && s.isBot)
      if (!target) return { ok: false, error: 'BAD_STATE' }
    }
    const idx = room.seats.indexOf(target)
    if (idx < 0) return { ok: false, error: 'BAD_STATE' }
    const [removed] = room.seats.splice(idx, 1)
    for (let i = 0; i < room.seats.length; i++) room.seats[i].seat = i
    return { ok: true, room, removed }
  }
}
