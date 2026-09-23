import { describe, expect, it } from 'vitest'
import { parseTrace, type Trace } from '../trace/schema.ts'
import {
  UnreadableResult,
  finalAnswer,
  observationsOf,
  toolPath,
} from './observation.ts'

/** A schema-valid trace from frames alone; `tokens` has to match one per frame. */
function traceOf(frames: Trace['frames']): Trace {
  return parseTrace({
    id: 'fixture',
    commit: 'v4-does-it-work',
    model: 'a-model',
    task: 'a task',
    outcome: 'success',
    tokens: frames.map(() => 1),
    frames,
  })
}

describe('observationsOf', () => {
  it('reads a listing as file names, never as contents', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'list_files', args: {} },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: { ok: true, directory: '.', files: ['a.ts', 'b.ts'] },
      },
    ])

    expect(observationsOf(trace)).toEqual([
      { frame: 2, tool: 'list_files', kind: 'path', file: 'a.ts' },
      { frame: 2, tool: 'list_files', kind: 'path', file: 'b.ts' },
    ])
  })

  it('reads a search as lines, with the file and line they came from', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'search_files', args: { pattern: 'x' } },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: {
          ok: true,
          pattern: 'x',
          filesSearched: 1,
          matches: [{ file: 'a.ts', line: 7, text: 'const x = 1' }],
          truncated: false,
        },
      },
    ])

    expect(observationsOf(trace)).toEqual([
      {
        frame: 2,
        tool: 'search_files',
        kind: 'line',
        file: 'a.ts',
        line: 7,
        text: 'const x = 1',
      },
    ])
  })

  it('yields nothing for a tool that failed, without calling it unreadable', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'search_files', args: { pattern: '(' } },
      {
        type: 'tool_result',
        id: '1',
        ok: false,
        result: { ok: false, error: 'not a valid regular expression' },
      },
    ])

    expect(observationsOf(trace)).toEqual([])
  })

  // The defect this project has already shipped once: post 1's leak gate had
  // never seen a real trace, and a gate that finds nothing prints the same
  // line as a gate that is not looking. A tool whose result shape this file
  // does not recognise must not quietly contribute zero observations, because
  // zero observations is also what "the agent read nothing" looks like.
  it('refuses to grade a result shape it does not understand', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'read_file', args: { path: 'a.ts' } },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: { ok: true, contents: 'const x = 1' },
      },
    ])

    expect(() => observationsOf(trace)).toThrow(UnreadableResult)
    expect(() => observationsOf(trace)).toThrow(/read_file/)
  })

  it('refuses a result with no call to pair it to', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      {
        type: 'tool_result',
        id: 'orphan',
        ok: true,
        result: { ok: true, directory: '.', files: [] },
      },
    ])

    expect(() => observationsOf(trace)).toThrow(UnreadableResult)
  })
})

describe('toolPath', () => {
  it('is the calls in order, which is the decision with the prose removed', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'list_files', args: {} },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: { ok: true, directory: '.', files: [] },
      },
      { type: 'tool_call', id: '2', name: 'search_files', args: { pattern: 'x' } },
      {
        type: 'tool_result',
        id: '2',
        ok: true,
        result: { ok: true, pattern: 'x', filesSearched: 0, matches: [], truncated: false },
      },
      { type: 'assistant', content: 'done' },
    ])

    expect(toolPath(trace)).toEqual(['list_files', 'search_files'])
  })
})

describe('finalAnswer', () => {
  it('is the last thing the model said that was not empty', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'assistant', content: 'thinking' },
      { type: 'assistant', content: '   ' },
    ])

    expect(finalAnswer(trace)).toBe('thinking')
  })

  it('is empty when the run never got to speak', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'list_files', args: {} },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: { ok: true, directory: '.', files: [] },
      },
    ])

    expect(finalAnswer(trace)).toBe('')
  })
})
