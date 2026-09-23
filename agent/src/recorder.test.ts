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
