import { describe, it, expect } from 'vitest'
import type { FinishReason } from 'ai'
import { whatStopped, MAX_STEPS } from './run.ts'

/*
 * The loop's stop condition, checked without a network call.
 *
 * A step that finished with `tool-calls` is a step that asked for another one.
 * If that is the last step in the run, the loop did not end because the work
 * was done — it ended because the cap said so. The post claims that the cap is
 * the backstop rather than the stop condition, and this is where the claim is
 * pinned to the code.
 */

const step = (finishReason: FinishReason) => ({ finishReason })

/** Every finish reason the SDK can report that is not `tool-calls`. */
const NOT_TOOL_CALLS: FinishReason[] = [
  'stop',
  'length',
  'content-filter',
  'error',
  'other',
]

describe('whatStopped', () => {
  it('reads the cap when the last step still wanted a tool', () => {
    expect(whatStopped([step('tool-calls'), step('tool-calls')])).toBe(
      'step-cap',
    )
  })

  it('reads the model when the last step asked for no tool', () => {
    expect(whatStopped([step('tool-calls'), step('stop')])).toBe('model')
  })

  it.each(NOT_TOOL_CALLS)('treats %s as the model stopping', (reason) => {
    expect(whatStopped([step(reason)])).toBe('model')
  })

  it('looks only at the last step', () => {
    const steps = [step('stop'), step('tool-calls')]
    expect(whatStopped(steps)).toBe('step-cap')
  })

  /*
   * A run with no steps cannot have been cut short by the cap, so it reports
   * the model. It is not a state `generateText` produces; the branch exists so
   * an empty array does not read as a truncated run.
   */
  it('does not blame the cap for a run that never started', () => {
    expect(whatStopped([])).toBe('model')
  })
})

describe('MAX_STEPS', () => {
  it('leaves room for more than one action', () => {
    expect(MAX_STEPS).toBeGreaterThan(2)
  })
})
