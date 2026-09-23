import { describe, expect, it } from 'vitest'
import { parseTrace, type Trace } from '../trace/schema.ts'
import { grade } from './grade.ts'
import type { Question } from './question.ts'

/**
 * The question these fixtures are graded against, deliberately not this
 * project's own. A grader tested only against the corpus it was built for is
 * a grader that has memorised it.
 */
const QUESTION: Question = {
  id: 'fixture',
  prompt: 'Which file sets the port, and what is it set to?',
  facts: [
    { id: 'file', text: 'src/server.ts' },
    { id: 'value', text: '4321' },
  ],
  truthFile: 'src/server.ts',
  tell: '4321',
}

const TRUTH = { file: 'src/server.ts', line: 1, text: 'export const PORT = 4321' }
const COPY = { file: 'README.md', line: 9, text: 'The port is 4321, in src/server.ts.' }

type Match = { file: string; line: number; text: string }

/** A run that searched once, got `matches` back, and said `answer`. */
function run(matches: Match[], answer: string): Trace {
  const frames: Trace['frames'] = [
    { type: 'user', content: QUESTION.prompt },
    { type: 'tool_call', id: '1', name: 'search_files', args: { pattern: 'port' } },
    {
      type: 'tool_result',
      id: '1',
      ok: true,
      result: {
        ok: true,
        pattern: 'port',
        filesSearched: 2,
        matches,
        truncated: false,
      },
    },
    { type: 'assistant', content: answer },
  ]
  return parseTrace({
    id: 'fixture',
    commit: 'v4-does-it-work',
    model: 'a-model',
    task: QUESTION.prompt,
    outcome: 'success',
    tokens: frames.map(() => 1),
    frames,
  })
}

/** A run that listed files, got names back, and said `answer`. */
function listed(files: string[], answer: string): Trace {
  const frames: Trace['frames'] = [
    { type: 'user', content: QUESTION.prompt },
    { type: 'tool_call', id: '1', name: 'list_files', args: { directory: '.' } },
    {
      type: 'tool_result',
      id: '1',
      ok: true,
      result: { ok: true, directory: '.', files, truncated: false },
    },
    { type: 'assistant', content: answer },
  ]
  return parseTrace({
    id: 'fixture',
    commit: 'v4-does-it-work',
    model: 'a-model',
    task: QUESTION.prompt,
    outcome: 'partial',
    tokens: frames.map(() => 1),
    frames,
  })
}

const ANSWER = 'src/server.ts sets it, to 4321.'

describe('provenance', () => {
  it('is grounded when only the source was observed', () => {
    expect(grade('r', run([TRUTH], ANSWER), QUESTION).provenance).toBe('grounded')
  })

  it('is undecidable when the source and a copy arrived together', () => {
    expect(grade('r', run([TRUTH, COPY], ANSWER), QUESTION).provenance).toBe(
      'undecidable',
    )
  })

  it('is from-copy when only a restatement was observed', () => {
    expect(grade('r', run([COPY], ANSWER), QUESTION).provenance).toBe('from-copy')
  })

  it('is unevidenced when nothing the tools returned carries the answer', () => {
    expect(grade('r', run([], ANSWER), QUESTION).provenance).toBe('unevidenced')
  })

  it('is ungradable for a question with no single line for an answer', () => {
    const noTruth: Question = { id: 'q', prompt: 'p', facts: [] }
    expect(grade('r', run([TRUTH], ANSWER), noTruth).provenance).toBe('ungradable')
  })
})

/**
 * The whole thesis, as an assertion.
 *
 * Post 3 published two real runs whose final answers are the same string and
 * whose evidence is not. A grader that reads the answer gives them the same
 * grade, necessarily, because it is looking at the same bytes. A grader that
 * reads the frames does not.
 */
describe('the same prose over different decisions', () => {
  const grounded = grade('grounded', run([TRUTH], ANSWER), QUESTION)
  const contaminated = grade('contaminated', run([TRUTH, COPY], ANSWER), QUESTION)

  it('grades identically on the answer', () => {
    expect(grounded.answer).toBe('success')
    expect(contaminated.answer).toBe('success')
  })

  it('grades differently on the decision', () => {
    expect(grounded.provenance).not.toBe(contaminated.provenance)
  })
})

describe('support', () => {
  it('calls a fact read when it appeared in a line of file contents', () => {
    const claims = grade('r', run([TRUTH], ANSWER), QUESTION).claims
    expect(claims.map((c) => c.support)).toEqual(['read', 'read'])
  })

  /**
   * A file name in a listing tells the model a file exists. It does not tell
   * it what is inside. A run that names the right file off a listing has
   * guessed, and the substring grader gives that guess the same half-credit
   * it gives a run that read the line.
   */
  it('calls a fact named-only when it appeared just as a path', () => {
    const result = grade(
      'r',
      listed(['src/server.ts', 'README.md'], 'Probably src/server.ts.'),
      QUESTION,
    )
    expect(result.claims[0]?.support).toBe('named-only')
    expect(result.claims[1]?.support).toBe('unsupported')
    expect(result.answer).toBe('partial')
    expect(result.unread).toEqual(['file'])
  })

  it('calls a fact unsupported when no tool returned it at all', () => {
    const result = grade('r', run([], ANSWER), QUESTION)
    expect(result.unread).toEqual(['file', 'value'])
  })

  it('does not flag a fact the answer never claimed', () => {
    const result = grade('r', run([], 'I could not find it.'), QUESTION)
    expect(result.unread).toEqual([])
    expect(result.answer).toBe('failure')
  })
})

describe('the answer grade reproduces the recorder rule', () => {
  it('is success when every fact is in the answer', () => {
    expect(grade('r', run([TRUTH], ANSWER), QUESTION).answer).toBe('success')
  })

  it('is partial when some are', () => {
    expect(grade('r', run([TRUTH], 'It is src/server.ts.'), QUESTION).answer).toBe(
      'partial',
    )
  })

  it('is failure when none are', () => {
    expect(grade('r', run([TRUTH], 'No idea.'), QUESTION).answer).toBe('failure')
  })

  it('is ungraded for a question with no facts to check', () => {
    const noFacts: Question = { id: 'q', prompt: 'p', facts: [] }
    expect(grade('r', run([TRUTH], ANSWER), noFacts).answer).toBe('ungraded')
  })

  it('caps at partial when a tool call failed', () => {
    const frames: Trace['frames'] = [
      { type: 'user', content: QUESTION.prompt },
      { type: 'tool_call', id: '1', name: 'search_files', args: { pattern: '(' } },
      {
        type: 'tool_result',
        id: '1',
        ok: false,
        result: { ok: false, error: 'bad pattern' },
      },
      { type: 'assistant', content: ANSWER },
    ]
    const trace = parseTrace({
      id: 'fixture',
      commit: 'v4-does-it-work',
      model: 'a-model',
      task: QUESTION.prompt,
      outcome: 'partial',
      tokens: frames.map(() => 1),
      frames,
    })

    expect(grade('r', trace, QUESTION).answer).toBe('partial')
  })
})
