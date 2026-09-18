import { describe, it, expect } from 'vitest'
import { parseTrace } from './schema.ts'

const valid = {
  id: 'post-01-explains-instead-of-doing',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'Count the TypeScript files in this project.',
  outcome: 'failure',
  tokens: [0, 412],
  frames: [
    { type: 'user', content: 'Count the TypeScript files in this project.' },
    { type: 'assistant', content: 'You can run `find . -name "*.ts" | wc -l`.' },
  ],
}

describe('parseTrace', () => {
  it('accepts a well-formed trace', () => {
    expect(parseTrace(valid).frames).toHaveLength(2)
  })

  it('rejects an unknown frame type', () => {
    const bad = { ...valid, frames: [{ type: 'telepathy', content: 'x' }] }
    expect(() => parseTrace(bad)).toThrow()
  })

  it('rejects an unknown outcome', () => {
    expect(() => parseTrace({ ...valid, outcome: 'maybe' })).toThrow()
  })

  it('rejects a trace whose tokens array is shorter than its frames', () => {
    const bad = { ...valid, tokens: [0] }
    expect(() => parseTrace(bad)).toThrow(/tokens/)
  })

  it('accepts every documented frame variant', () => {
    const frames = [
      { type: 'user', content: 'go' },
      { type: 'tool_call', id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
      { type: 'tool_result', id: 'c1', ok: true, result: 'export const a = 1' },
      { type: 'assistant', content: 'done' },
      { type: 'compaction', before: 9000, after: 1200, summary: 'read one file' },
      { type: 'approval', tool: 'shell', decision: 'deny' },
    ]
    const t = parseTrace({ ...valid, frames, tokens: frames.map(() => 0) })
    expect(t.frames).toHaveLength(6)
  })
})
