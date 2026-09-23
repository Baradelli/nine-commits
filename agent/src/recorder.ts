import type { RunStep } from './run.ts'

export type Outcome = 'success' | 'failure' | 'partial'

export type RecorderInput = {
  id: string
  commit: string
  model: string
  task: string
  userMessage: string
  steps: RunStep[]
  /**
   * Facts the final answer has to contain for the run to have answered the
   * question — each one checkable in the repository at the tag the post is
   * bound to.
   */
  expected: string[]
}

type Frame = Record<string, unknown>

/** The last thing the model actually said, across however many steps it took. */
function finalAnswer(steps: RunStep[]): string {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const text = steps[i]?.text ?? ''
    if (text.trim() !== '') return text
  }
  return ''
}

/**
 * Whether the run answered the question.
 *
 * At v1 this was the literal string `'failure'`. That was true by construction
 * — a single model call cannot act, so no v1 run could finish a task — and it
 * stops being true the moment the agent has hands. A badge under a trace that
 * is decided at build time is decoration, so this is an observation instead.
 *
 * It is deliberately crude: a case-insensitive substring check of the final
 * answer against facts the caller knows to be true. Its one virtue is that a
 * reader can check every part of it — the answer is in the trace, the expected
 * values are in the post, and the truth is in the repository. Grading an
 * answer properly is post 4.
 *
 * All the facts present is a success, some of them is partial, none is a
 * failure. A tool call that failed caps the grade at partial: a run that got
 * there without its tool did not get there the way it claims to have.
 */
export function deriveOutcome(steps: RunStep[], expected: string[]): Outcome {
  if (expected.length === 0) {
    throw new Error(
      'recorder: expected must not be empty — a trace has to say whether the ' +
        'run worked, and the recorder will not guess',
    )
  }

  const answer = finalAnswer(steps).toLowerCase()
  if (answer === '') return 'failure'

  const hits = expected.filter((fact) =>
    answer.includes(fact.toLowerCase()),
  ).length
  if (hits === 0) return 'failure'

  const toolFailed = steps.some((step) =>
    step.toolResults.some((result) => !result.ok),
  )
  if (hits < expected.length || toolFailed) return 'partial'

  return 'success'
}

/**
 * Builds the raw trace that `tools/record-trace.ts` normalizes.
 *
 * `tokens` is one entry per frame, and it is the size of the context at that
 * point in the run rather than a delta — the site's budget meter reads it
 * directly. Every entry is a number the provider reported:
 *
 * - the user's question sits in a context that already holds the system
 *   instruction and both tool definitions, so its entry is the first step's
 *   own input count. That is why the same run costs more before the model has
 *   done anything at all when the tool descriptions are longer;
 * - a tool call ends the step that produced it, so it carries that step's
 *   total;
 * - a tool result is only measured once it is sent back, so it carries the
 *   next step's input count — or, if there is no next step because nothing was
 *   ever sent, the last measurement taken.
 */
export function toRawTrace(input: RecorderInput): unknown {
  const frames: Frame[] = [{ type: 'user', content: input.userMessage }]
  const tokens: number[] = [input.steps[0]?.inputTokens ?? 0]

  input.steps.forEach((step, index) => {
    const next = input.steps[index + 1]

    for (const call of step.toolCalls) {
      frames.push({
        type: 'tool_call',
        id: call.id,
        name: call.name,
        args: call.args,
      })
      tokens.push(step.totalTokens)
    }

    for (const result of step.toolResults) {
      frames.push({
        type: 'tool_result',
        id: result.id,
        ok: result.ok,
        result: result.result,
      })
      tokens.push(next?.inputTokens ?? step.totalTokens)
    }

    if (step.text.trim() !== '') {
      frames.push({ type: 'assistant', content: step.text })
      tokens.push(step.totalTokens)
    }
  })

  return {
    id: input.id,
    commit: input.commit,
    model: input.model,
    task: input.task,
    outcome: deriveOutcome(input.steps, input.expected),
    tokens,
    frames,
  }
}
