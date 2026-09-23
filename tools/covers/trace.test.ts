import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCoverTrace } from './trace.ts'

let postDir: string

beforeEach(() => {
  postDir = mkdtempSync(join(tmpdir(), 'cover-trace-'))
})

afterEach(() => {
  rmSync(postDir, { recursive: true, force: true })
})

function writeTrace(name: string): void {
  writeFileSync(join(postDir, name), '{"frames":[]}', 'utf8')
}

describe('resolveCoverTrace', () => {
  it('resolves the trace the post declares', () => {
    writeTrace('trace-a-allowed.json')
    writeTrace('trace-b-denied.json')

    expect(resolveCoverTrace(postDir, 'trace-b-denied.json')).toBe(
      join(postDir, 'trace-b-denied.json'),
    )
  })

  it('defaults to trace.json when the post declares nothing', () => {
    writeTrace('trace.json')

    expect(resolveCoverTrace(postDir, undefined)).toBe(join(postDir, 'trace.json'))
  })

  it('takes the declared trace even when another trace sorts before it', () => {
    writeTrace('trace-a-allowed.json')
    writeTrace('trace.json')

    expect(resolveCoverTrace(postDir, 'trace.json')).toBe(join(postDir, 'trace.json'))
  })

  it('throws naming the post directory and the missing declared file', () => {
    writeTrace('trace-a-allowed.json')

    expect(() => resolveCoverTrace(postDir, 'trace-b-denied.json')).toThrow(
      /trace-b-denied\.json/,
    )
  })

  it('does not fall back to another trace when the declared one is missing', () => {
    writeTrace('trace-a-allowed.json')

    expect(() => resolveCoverTrace(postDir, 'trace-b-denied.json')).toThrow()
  })

  it('throws telling the author to declare coverTrace when trace.json is absent', () => {
    writeTrace('trace-a-allowed.json')
    writeTrace('trace-b-denied.json')

    expect(() => resolveCoverTrace(postDir, undefined)).toThrow(/coverTrace/)
  })

  it('throws when the post carries no trace at all', () => {
    expect(() => resolveCoverTrace(postDir, undefined)).toThrow(/trace\.json/)
  })

  it('does not treat a directory named like a trace as the trace file', () => {
    mkdirSync(join(postDir, 'trace.json'))

    expect(() => resolveCoverTrace(postDir, undefined)).toThrow(/trace\.json/)
  })
})
