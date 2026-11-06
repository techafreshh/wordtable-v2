import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT, parsePortArg, resolvePort } from '../../server/src/config'
import { HEALTH_BODY, isPingMessage } from '../../server/src/ws'

const savedPort = process.env.PORT

afterEach(() => {
  if (savedPort === undefined) delete process.env.PORT
  else process.env.PORT = savedPort
})

describe('parsePortArg', () => {
  it('handles --port=NNNN', () => {
    expect(parsePortArg(['--port=9081'])).toBe('9081')
  })

  it('handles --port NNNN', () => {
    expect(parsePortArg(['--port', '9082'])).toBe('9082')
  })

  it('returns undefined when absent', () => {
    expect(parsePortArg([])).toBeUndefined()
    expect(parsePortArg(['--other', 'x'])).toBeUndefined()
  })

  it('first match wins', () => {
    expect(parsePortArg(['--port=1111', '--port', '2222'])).toBe('1111')
  })
})

describe('resolvePort', () => {
  it('prefers CLI over env over default', () => {
    process.env.PORT = '9001'
    expect(resolvePort('9002')).toBe(9002)
    expect(resolvePort(undefined)).toBe(9001)
    delete process.env.PORT
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT)
  })

  it('defaults to 9080', () => {
    delete process.env.PORT
    expect(resolvePort(undefined)).toBe(9080)
    expect(DEFAULT_PORT).toBe(9080)
  })

  it('falls through when CLI is out of range', () => {
    process.env.PORT = '9003'
    expect(resolvePort('0')).toBe(9003)
    expect(resolvePort('70000')).toBe(9003)
    expect(resolvePort('abc')).toBe(9003)
  })

  it('falls through when env is out of range', () => {
    process.env.PORT = '99999'
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT)
    process.env.PORT = 'not-a-port'
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT)
  })
})

describe('ping normalization', () => {
  it('matches case/whitespace tolerant ping', () => {
    expect(isPingMessage('ping')).toBe(true)
    expect(isPingMessage('PING')).toBe(true)
    expect(isPingMessage('  Ping\n')).toBe(true)
    expect(isPingMessage(Buffer.from(' ping '))).toBe(true)
  })

  it('rejects non-ping frames', () => {
    expect(isPingMessage('pong')).toBe(false)
    expect(isPingMessage('hello')).toBe(false)
    expect(isPingMessage('')).toBe(false)
  })
})

describe('health body', () => {
  it('is exactly {"ok":true}', () => {
    expect(HEALTH_BODY).toBe('{"ok":true}')
    expect(JSON.parse(HEALTH_BODY)).toEqual({ ok: true })
  })
})

describe('static index markers', () => {
  it('client/index.html contains app div and Wordtable', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const indexPath = join(here, '../../client/index.html')
    const html = readFileSync(indexPath, 'utf8')
    expect(html).toContain('<div id="app">')
    expect(html).toContain('Wordtable')
  })
})
