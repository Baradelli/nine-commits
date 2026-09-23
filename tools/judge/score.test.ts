import { describe, expect, it } from 'vitest'
import { buildPanel, controlCases, type JudgeCase } from './panel.ts'
import {
  checkCitation,
  readOpen,
  scoreControl,
  scorePanel,
  tally,
  type Judged,
} from './score.ts'
import type { JudgeVerdict } from './verdict.ts'

const panel = buildPanel()

function find(id: string): JudgeCase {
  const item = panel.find((entry) => entry.id === id)
  if (item === undefined) throw new Error(`no case "${id}"`)
  return item
}

function judged(
  caseId: string,
  verdict: JudgeVerdict,
  repeat = 1,
  extra: Partial<Judged> = {},
): Judged {
  return {
    case: caseId,
    repeat,
    verdict,
    citation: 'none',
    confidence: 0.5,
    reason: '',
    inputTokens: 0,
    outputTokens: 0,
    ...extra,
  }
}

/**
 * A judge that always says the same thing, used to make the scorer disagree
 * with something. Every verdict here is invented; nothing in this file calls
 * a model.
 */
function flatJudge(verdict: JudgeVerdict, repeats = 3): Judged[] {
  return panel.flatMap((item) =>
    Array.from({ length: repeats }, (_unused, index) =>
      judged(item.id, verdict, index + 1),
    ),
  )
}

describe('counting a case the judge saw several times', () => {
  const mixed = [
    judged('loop-demo', 'undecidable', 1),
    judged('loop-demo', 'undecidable', 2),
    judged('loop-demo', 'grounded', 3),
  ]

  it('reports the distribution and the plurality', () => {
    const result = tally('loop-demo', mixed)
    expect(result.counts.undecidable).toBe(2)
    expect(result.counts.grounded).toBe(1)
    expect(result.majority).toBe('undecidable')
    expect(result.distinct).toBe(2)
  })

  it('says split rather than picking one when two tie', () => {
    const tied = [
      judged('loop-demo', 'grounded', 1),
      judged('loop-demo', 'from-copy', 2),
    ]
    expect(tally('loop-demo', tied).majority).toBe('split')
  })

  it('counts how often the judge named an origin on a case that has no answer', () => {
    const reading = readOpen(find('loop-demo'), mixed)
    expect(reading.decided).toBe(1)
    expect(reading.runs).toBe(3)
  })
})

describe('checking a judge citation against the run', () => {
  const corpusHit = find('corpus-hit')
  const SOURCE = 'agent/src/config.ts:1'

  it('accepts grounded when the cited line is in the source file', () => {
    expect(
      checkCitation(corpusHit, { verdict: 'grounded', citation: SOURCE }),
    ).toBe('consistent')
  })

  it('catches grounded citing a line outside the source file', () => {
    expect(
      checkCitation(corpusHit, {
        verdict: 'grounded',
        citation: 'agent/src/cli.ts:48',
      }),
    ).toBe('contradicts')
  })

  it('catches a line no tool in the run ever returned', () => {
    expect(
      checkCitation(corpusHit, {
        verdict: 'grounded',
        citation: 'agent/src/config.ts:4242',
      }),
    ).toBe('unobserved')
  })

  it('catches unevidenced citing a line the run really did get back', () => {
    expect(
      checkCitation(corpusHit, { verdict: 'unevidenced', citation: SOURCE }),
    ).toBe('contradicts')
  })

  it('accepts unevidenced with nothing cited', () => {
    expect(
      checkCitation(corpusHit, { verdict: 'unevidenced', citation: 'none' }),
    ).toBe('consistent')
  })

  it('does not score a citation attached to undecidable', () => {
    expect(
      checkCitation(corpusHit, { verdict: 'undecidable', citation: SOURCE }),
    ).toBe('n/a')
  })
})

describe('grading the judge', () => {
  it('gives a judge that is right everywhere full marks', () => {
    const perfect = panel.flatMap((item) =>
      Array.from({ length: 3 }, (_unused, index) =>
        judged(item.id, item.known ?? 'undecidable', index + 1),
      ),
    )
    const score = scorePanel(panel, perfect)
    expect(score.correct).toBe(score.calls)
    expect(score.majoritiesCorrect).toBe(score.controlCount)
    expect(score.unstableControls).toBe(0)
  })

  /**
   * A grader that cannot fail is not a grader — the defect this project has
   * already shipped once. These two are the demonstration: a judge that says
   * `grounded` to everything scores exactly the two controls whose answer is
   * `grounded`, and a judge that says `undecidable` to everything — the reply
   * that sounds most careful — scores nothing at all.
   */
  it('marks a judge that says grounded to everything down to the grounded cases', () => {
    const score = scorePanel(panel, flatJudge('grounded'))
    const expected = controlCases(panel).filter(
      (item) => item.known === 'grounded',
    ).length
    expect(score.majoritiesCorrect).toBe(expected)
    expect(score.majoritiesCorrect).toBeLessThan(score.controlCount)
  })

  it('gives a judge that always declines a score of zero on the controls', () => {
    const score = scorePanel(panel, flatJudge('undecidable'))
    expect(score.correct).toBe(0)
    expect(score.majoritiesCorrect).toBe(0)
  })

  it('counts a control the repeats disagreed on as unstable', () => {
    const control = controlCases(panel)[0]
    if (control === undefined) throw new Error('no control cases')
    const wobbly = [
      ...flatJudge('grounded').filter((item) => item.case !== control.id),
      judged(control.id, 'grounded', 1),
      judged(control.id, 'from-copy', 2),
      judged(control.id, 'undecidable', 3),
    ]
    expect(scorePanel(panel, wobbly).unstableControls).toBe(1)
  })

  it('refuses to score a case that has no answer', () => {
    expect(() => scoreControl(find('loop-demo'), [])).toThrow(/no known answer/)
  })

  it('counts a citation that contradicts its own verdict', () => {
    const control = find('source-only')
    const score = scoreControl(control, [
      judged(control.id, 'grounded', 1, { citation: 'agent/src/cli.ts:48' }),
    ])
    expect(score.badCitations).toBe(1)
  })
})
