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

describe('observationsOf, on the tools v6 added', () => {
  it('reads a file read as one line observation per line, numbered from one', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'read_file', args: { path: 'a.json' } },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: {
          ok: true,
          file: 'a.json',
          lines: 2,
          truncated: false,
          content: ['{', '  "timeoutMs": 4500', '}'].join('\n'),
        },
      },
    ])

    expect(observationsOf(trace)).toEqual([
      { frame: 2, tool: 'read_file', kind: 'line', file: 'a.json', line: 1, text: '{' },
      {
        frame: 2,
        tool: 'read_file',
        kind: 'line',
        file: 'a.json',
        line: 2,
        text: '  "timeoutMs": 4500',
      },
      { frame: 2, tool: 'read_file', kind: 'line', file: 'a.json', line: 3, text: '}' },
    ])
  })

  it('reads a write as an event, not as something the model was shown', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'write_file', args: { path: 'a.md' } },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: { ok: true, file: 'a.md', bytes: 12, created: true },
      },
    ])

    // Zero observations, and it matters that this is a recognised zero: the
    // line below is what tells the two kinds of zero apart.
    expect(observationsOf(trace)).toEqual([])
  })

  it('still raises on a result shape nobody taught it about', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'rename_file', args: {} },
      { type: 'tool_result', id: '1', ok: true, result: { ok: true, from: 'a', to: 'b' } },
    ])

    expect(() => observationsOf(trace)).toThrow(UnreadableResult)
  })
})

describe('observationsOf, on the tool v8 added', () => {
  /*
   * Post 8 states two properties of these observations in prose, as safety
   * properties, and until this block existed neither was tested: dropping the
   * `$ ` prefix and merging stderr into stdout's source both left the whole
   * suite green. A claim stated as a safety property and tested by nothing is
   * this series' oldest defect, so it is pinned here.
   */
  const ran = (stdout: string, stderr = ''): Trace =>
    traceOf([
      { type: 'user', content: 'q' },
      {
        type: 'tool_call',
        id: '1',
        name: 'run_command',
        args: { command: 'grep -r parcel .' },
      },
      {
        type: 'tool_result',
        id: '1',
        ok: true,
        result: {
          ok: true,
          command: 'grep -r parcel .',
          exitCode: 0,
          stdout,
          stderr,
          truncated: false,
          timedOut: false,
        },
      },
    ])

  it('puts the command in the file field, spelled with a $ so it cannot be read as a path', () => {
    const [first] = observationsOf(ran('README.md:1:# parcel-relay'))
    expect(first?.file).toBe('$ grep -r parcel .')
    // The point of the `$ `: no path in this project starts with one, so a
    // provenance check comparing sources to file names can never match a
    // command line by accident.
    expect(first?.file.startsWith('$ ')).toBe(true)
  })

  it('makes standard error a separate source, so a complaint is not evidence about the project', () => {
    const observations = observationsOf(
      ran('README.md:1:# parcel-relay', 'grep: ..: No such file or directory'),
    )
    expect(observations.map((o) => o.file)).toEqual([
      '$ grep -r parcel .',
      '$ grep -r parcel . [stderr]',
    ])
    expect(observations[1]).toMatchObject({
      kind: 'line',
      text: 'grep: ..: No such file or directory',
    })
  })

  it('yields one observation per line of output, numbered from one within each stream', () => {
    const observations = observationsOf(ran(['a', 'b', 'c'].join('\n'), 'x\ny'))
    expect(
      observations.map((o) => (o.kind === 'line' ? [o.file, o.line, o.text] : [o.file])),
    ).toEqual([
      ['$ grep -r parcel .', 1, 'a'],
      ['$ grep -r parcel .', 2, 'b'],
      ['$ grep -r parcel .', 3, 'c'],
      ['$ grep -r parcel . [stderr]', 1, 'x'],
      ['$ grep -r parcel . [stderr]', 2, 'y'],
    ])
  })

  it('yields nothing for a refused command, because the model learned nothing about the files', () => {
    const trace = traceOf([
      { type: 'user', content: 'q' },
      { type: 'tool_call', id: '1', name: 'run_command', args: { command: 'rm -rf .' } },
      { type: 'tool_result', id: '1', ok: false, result: { ok: false, error: 'refused' } },
    ])

    expect(observationsOf(trace)).toEqual([])
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
