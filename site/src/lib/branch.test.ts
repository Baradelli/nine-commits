import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { forkAt } from './branch.ts'

const POST = join(
  process.cwd(),
  'site',
  'src',
  'content',
  'posts',
  '09-hitl',
)

function trace(file: string): { frames: unknown[] } {
  return JSON.parse(readFileSync(join(POST, file), 'utf8')) as { frames: unknown[] }
}

describe('forkAt', () => {
  it('is the first index at which the recordings disagree', () => {
    expect(
      forkAt([
        { frames: ['a', 'b', 'c'] },
        { frames: ['a', 'b', 'd', 'e'] },
      ]),
    ).toBe(2)
  })

  it('is zero when they disagree immediately', () => {
    expect(forkAt([{ frames: ['a'] }, { frames: ['b'] }])).toBe(0)
  })

  it('is the shorter length when one is a prefix of the other', () => {
    expect(forkAt([{ frames: ['a', 'b'] }, { frames: ['a', 'b', 'c'] }])).toBe(2)
  })

  it('is zero for nothing to compare', () => {
    expect(forkAt([])).toBe(0)
    expect(forkAt([{ frames: ['a', 'b'] }])).toBe(0)
  })

  it('compares frames by value, not by identity', () => {
    expect(
      forkAt([
        { frames: [{ type: 'user', content: 'x' }] },
        { frames: [{ type: 'user', content: 'x' }] },
      ]),
    ).toBe(1)
  })
})

describe('the two published branches', () => {
  const allow = trace('trace-a-allow.json')
  const deny = trace('trace-b-deny.json')
  const gate = forkAt([allow, deny])

  it('fork exactly at the approval frame', () => {
    expect(allow.frames[gate]).toEqual({
      type: 'approval',
      tool: 'write_file',
      decision: 'allow',
    })
    expect(deny.frames[gate]).toEqual({
      type: 'approval',
      tool: 'write_file',
      decision: 'deny',
    })
  })

  it('share every byte before it', () => {
    expect(JSON.stringify(allow.frames.slice(0, gate))).toBe(
      JSON.stringify(deny.frames.slice(0, gate)),
    )
    // Not a coincidence of an empty prefix: there is a real run in there.
    expect(gate).toBeGreaterThan(3)
  })

  it('differ from it on', () => {
    expect(allow.frames.length).not.toBe(deny.frames.length)
  })
})
