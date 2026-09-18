import { describe, it, expect } from 'vitest'
import { toRawTrace } from './recorder.ts'
import { parseTrace } from '../../tools/trace/schema.ts'

describe('toRawTrace', () => {
  const input = {
    id: 'explains-instead-of-doing',
    commit: 'v1-not-an-agent',
    model: 'gpt-5-mini',
    task: 'Count the TypeScript files in this project.',
    userMessage: 'Count the TypeScript files in this project.',
    assistantText: 'You can run `find . -name "*.ts" | wc -l`.',
    totalTokens: 412,
  }

  it('produces a trace that passes the shared schema', () => {
    expect(() => parseTrace(toRawTrace(input))).not.toThrow()
  })

  it('emits exactly one user frame and one assistant frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames.map((f) => f.type)).toEqual(['user', 'assistant'])
  })

  it('records the run as a failure, because a single call cannot act', () => {
    expect(parseTrace(toRawTrace(input)).outcome).toBe('failure')
  })

  it('reports a token budget entry per frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.tokens).toEqual([0, 412])
  })
})
