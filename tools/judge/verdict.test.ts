import { describe, expect, it } from 'vitest'
import { parseJudgement, UnreadableJudgement } from './verdict.ts'

const ok =
  '{"verdict":"undecidable","citation":"agent/src/config.ts:1","confidence":0.4,"reason":"both were in the same result set"}'

describe('reading a judge reply', () => {
  it('takes a bare JSON object', () => {
    expect(parseJudgement(ok).verdict).toBe('undecidable')
  })

  it('takes the same object inside a code fence', () => {
    expect(parseJudgement('```json\n' + ok + '\n```').citation).toBe(
      'agent/src/config.ts:1',
    )
  })

  /**
   * The line this file exists for. A judge whose reply cannot be read is a
   * broken harness, and the most dangerous thing to do with it is to record
   * the most defensible-sounding verdict in the vocabulary and carry on: a
   * whole panel of `undecidable` would look exactly like a careful judge and
   * would be an experiment that never ran.
   */
  it.each([
    ['prose', 'I think it came from the source file, probably.'],
    ['an empty reply', ''],
    ['a verdict outside the vocabulary', '{"verdict":"grounded-ish","citation":"none","confidence":1,"reason":"x"}'],
    ['a missing field', '{"verdict":"grounded","confidence":1,"reason":"x"}'],
    ['a confidence out of range', '{"verdict":"grounded","citation":"none","confidence":4,"reason":"x"}'],
    ['a confidence that is a string', '{"verdict":"grounded","citation":"none","confidence":"high","reason":"x"}'],
  ])('refuses %s rather than returning a verdict', (_name, reply) => {
    expect(() => parseJudgement(reply)).toThrow(UnreadableJudgement)
  })
})
