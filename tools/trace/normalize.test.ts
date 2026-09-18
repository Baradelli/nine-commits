import { describe, it, expect } from 'vitest'
import { normalize } from './normalize.ts'

const opts = { homeDir: 'C:\\Users\\User', denyList: [] }

const raw = {
  id: 'r1',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'List files in C:\\Users\\User\\Documents',
  outcome: 'failure',
  tokens: [0, 120],
  frames: [
    { type: 'user', content: 'List files in C:\\Users\\User\\Documents' },
    { type: 'assistant', content: 'I cannot access C:\\Users\\User.' },
  ],
}

describe('normalize', () => {
  it('redacts before validating', () => {
    const trace = normalize(raw, opts)
    expect(trace.task).toBe('List files in ~\\Documents')
    expect(JSON.stringify(trace)).not.toContain('C:\\Users\\User')
  })

  it('throws on a structurally invalid trace', () => {
    expect(() => normalize({ ...raw, outcome: 'maybe' }, opts)).toThrow()
  })

  it('throws when a secret survives redaction', () => {
    // An empty homeDir would otherwise produce a catch-all pattern; guard it.
    expect(() => normalize(raw, { homeDir: '', denyList: [] })).toThrow(
      /homeDir/,
    )
  })
})
