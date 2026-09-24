import { describe, it, expect } from 'vitest'
import { toRawTrace, deriveOutcome } from './recorder.ts'
import type { RunStep } from './run.ts'
import { parseTrace } from '../../tools/trace/schema.ts'

function step(over: Partial<RunStep> = {}): RunStep {
  return {
    text: '',
    toolCalls: [],
    toolResults: [],
    inputTokens: 0,
    totalTokens: 0,
    ...over,
  }
}

/*
 * Deliberately not the question the recorded runs asked, and deliberately not
 * the answer they were graded against. The agent's tools read this repository,
 * so a fixture holding the real task and the real expected value would plant
 * the answer key inside the corpus the experiment searches. The first run
 * recorded before this was noticed found these very lines.
 */
const CALL = { id: 'call_1', name: 'search_files', args: { pattern: 'PORT' } }
const FILE = 'playwright.config.ts'
const VALUE = 'port 4321'

/**
 * The shape every recorded v2 run has: ask, call a tool, read it, answer.
 *
 * The SDK puts a tool call and its result in the same step — the step ends
 * once the tool has run — so the answer is the whole of the second step.
 */
const steps: RunStep[] = [
  step({
    toolCalls: [CALL],
    toolResults: [{ id: 'call_1', ok: true, result: { ok: true } }],
    inputTokens: 900,
    totalTokens: 1_000,
  }),
  step({
    text: `It is set in ${FILE}, to ${VALUE}.`,
    inputTokens: 1_200,
    totalTokens: 1_260,
  }),
]

const TASK = 'Which file sets the preview port, and what is it set to?'

const input = {
  id: 'a-recorded-run',
  commit: 'v2-hands',
  model: 'a-model',
  task: TASK,
  userMessage: TASK,
  steps,
  expected: [FILE, VALUE],
}

describe('toRawTrace', () => {
  it('produces a trace that passes the shared schema', () => {
    expect(() => parseTrace(toRawTrace(input))).not.toThrow()
  })

  it('emits a frame per event, in the order they happened', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames.map((f) => f.type)).toEqual([
      'user',
      'tool_call',
      'tool_result',
      'assistant',
    ])
  })

  it('carries the tool call name and arguments into the frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames[1]).toEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'search_files',
      args: { pattern: 'PORT' },
    })
  })

  it('reports context size per frame, not deltas', () => {
    const trace = parseTrace(toRawTrace(input))
    // The question already sits in a context holding the system instruction
    // and both tool definitions; the tool result is measured by the step that
    // was sent it.
    expect(trace.tokens).toEqual([900, 1_000, 1_200, 1_260])
  })

  it('records a run with no tool call as two frames', () => {
    const trace = parseTrace(
      toRawTrace({
        ...input,
        steps: [step({ text: VALUE, inputTokens: 900, totalTokens: 950 })],
        expected: [VALUE],
      }),
    )
    expect(trace.frames.map((f) => f.type)).toEqual(['user', 'assistant'])
    expect(trace.tokens).toEqual([900, 950])
  })

  it('falls back to the last measurement for a tool result nothing was sent', () => {
    const trace = parseTrace(
      toRawTrace({
        ...input,
        steps: [
          step({
            toolCalls: [CALL],
            toolResults: [{ id: 'call_1', ok: true, result: { ok: true } }],
            text: `${VALUE} is set in ${FILE}`,
            inputTokens: 900,
            totalTokens: 1_000,
          }),
        ],
      }),
    )
    expect(trace.tokens).toEqual([900, 1_000, 1_000, 1_000])
  })
})

describe('deriveOutcome', () => {
  it('is a success when the answer contains every expected fact', () => {
    expect(deriveOutcome(steps, [FILE, VALUE])).toBe('success')
  })

  it('is partial when the answer contains only some of them', () => {
    expect(deriveOutcome(steps, [FILE, 'port 9999'])).toBe('partial')
  })

  it('is a failure when the answer contains none of them', () => {
    expect(deriveOutcome(steps, ['site/src/lib/series.ts'])).toBe('failure')
  })

  it('is a failure when the run never produced an answer', () => {
    expect(deriveOutcome([step({ toolCalls: [CALL] })], [VALUE])).toBe(
      'failure',
    )
  })

  it('caps a right-looking answer at partial when a tool call failed', () => {
    const failed: RunStep[] = [
      step({
        toolCalls: [CALL],
        toolResults: [
          { id: 'call_1', ok: false, result: { ok: false, error: 'nope' } },
        ],
      }),
      step({ text: `${FILE} sets it to ${VALUE}.` }),
    ]
    expect(deriveOutcome(failed, [FILE, VALUE])).toBe('partial')
  })

  it('refuses to grade a run nobody said what to expect from', () => {
    expect(() => deriveOutcome(steps, [])).toThrow(/expected must not be empty/)
  })

  it('matches the expected facts case-insensitively', () => {
    const shouted: RunStep[] = [step({ text: 'IT IS PORT 4321.' })]
    expect(deriveOutcome(shouted, [VALUE])).toBe('success')
  })
})

/*
 * v7: the frame the schema has carried since commit 1, and the reason its
 * arrival needed a rule change rather than a new branch.
 *
 * `tokens` drives the site's budget meter, and the meter's whole job in post 7
 * is to go down. It could not. A tool result is sized by what the next request
 * cost, and when a compaction happens in between, the next request is made of a
 * different conversation — so the post-rewrite figure landed on the frame
 * BEFORE the rewrite, the drop was attributed to the wrong frame, and the
 * compaction itself rendered as a flat line. Caught by reading a real trace's
 * token curve, not by reading the code.
 */
describe('a compacted run', () => {
  const compaction = {
    before: 15_000,
    after: 6_500,
    summary: 'searched, read two pages, found both numbers',
    dropped: 6,
    droppedText: '[]',
  }

  const compacted: RunStep[] = [
    step({
      toolCalls: [CALL],
      toolResults: [{ id: 'call_1', ok: true, result: { ok: true } }],
      inputTokens: 900,
      totalTokens: 1_000,
    }),
    step({
      text: `It is set in ${FILE}, to ${VALUE}.`,
      inputTokens: 6_600,
      totalTokens: 6_700,
      compaction,
    }),
  ]

  const input = {
    id: 'a-compacted-run',
    commit: 'v7-context',
    model: 'a-model',
    task: TASK,
    userMessage: TASK,
    steps: compacted,
    expected: [FILE, VALUE],
  }

  it('emits the frame in the place the rewrite happened', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames.map((f) => f.type)).toEqual([
      'user',
      'tool_call',
      'tool_result',
      'compaction',
      'assistant',
    ])
  })

  it('carries the rewrite\u2019s own numbers into the frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames[3]).toEqual({
      type: 'compaction',
      before: 15_000,
      after: 6_500,
      summary: compaction.summary,
    })
  })

  it('lets the budget go down, which is the whole point of the frame', () => {
    const trace = parseTrace(toRawTrace(input))
    // The result landed in a 15,000-token history; the rewrite left 6,500.
    expect(trace.tokens[2]).toBe(15_000)
    expect(trace.tokens[3]).toBe(6_500)
    expect(trace.tokens[3]).toBeLessThan(trace.tokens[2] as number)
    // And the peak the meter scales against is the pre-rewrite size, so the
    // retreat is visible rather than being the top of the chart.
    expect(Math.max(...trace.tokens)).toBe(15_000)
  })

  it('still sizes a tool result by the next request when nothing intervened', () => {
    const plain = { ...input, steps: [compacted[0] as RunStep, step({ text: 'done', inputTokens: 1_200, totalTokens: 1_260 })] }
    const trace = parseTrace(toRawTrace(plain))
    expect(trace.tokens[2]).toBe(1_200)
  })
})

/*
 * The rewrite that was followed by nothing.
 *
 * The history is compacted, the rewrite is not enough, and the request it was
 * making room for never goes. There is no step to hang the frame on, so the
 * first version of this dropped it: the run's own tally said it compacted once
 * and its trace showed no compaction at all. Found by opening three traces of
 * overflowed runs and counting.
 */
describe('a rewrite that did not save the run', () => {
  const trailing = {
    before: 20_500,
    after: 19_100,
    summary: 'searched three times, then fetched three pages at once',
    dropped: 2,
    droppedText: '[]',
  }

  const input = {
    id: 'an-overflowed-run',
    commit: 'v7-context',
    model: 'a-model',
    task: TASK,
    userMessage: TASK,
    steps: [
      step({
        toolCalls: [CALL],
        toolResults: [{ id: 'call_1', ok: true, result: { ok: true } }],
        inputTokens: 900,
        totalTokens: 1_000,
      }),
      step({
        text: 'looking that up',
        toolCalls: [{ id: 'call_2', name: 'fetch_page', args: { url: 'x' } }],
        toolResults: [{ id: 'call_2', ok: true, result: { ok: true } }],
        inputTokens: 1_200,
        totalTokens: 1_400,
      }),
    ],
    expected: [FILE, VALUE],
    trailingCompaction: trailing,
  }

  it('still records the compaction, at the end, where it happened', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames.at(-1)).toEqual({
      type: 'compaction',
      before: 20_500,
      after: 19_100,
      summary: trailing.summary,
    })
  })

  it('sizes the last result by the history the rewrite was measuring', () => {
    const trace = parseTrace(toRawTrace(input))
    const lastResult = trace.frames
      .map((frame, index) => ({ frame, index }))
      .filter(({ frame }) => frame.type === 'tool_result')
      .map(({ index }) => index)
      .pop() as number
    expect(trace.tokens[lastResult]).toBe(20_500)
    expect(trace.tokens.at(-1)).toBe(19_100)
  })

  it('leaves an ordinary run alone', () => {
    const { trailingCompaction, ...plain } = input
    expect(trailingCompaction).toBeDefined()
    const trace = parseTrace(toRawTrace(plain))
    expect(trace.frames.some((f) => f.type === 'compaction')).toBe(false)
  })
})
