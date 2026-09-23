import { describe, expect, it } from 'vitest'
import { grade } from '../eval/grade.ts'
import { buildPanel, controlCases, openCases, REPEATS } from './panel.ts'

const panel = buildPanel()

describe('the panel put to the judge', () => {
  /**
   * What makes a known answer known.
   *
   * Every control case is a case post 4's deterministic grader settles
   * without hesitating, and this asserts it rather than asserting my opinion
   * of the run. If one of these ever stops matching, the control has moved
   * and the judge's score against it means something different — which is
   * exactly the failure a golden record exists to catch.
   */
  it.each(controlCases(panel).map((item) => [item.id, item] as const))(
    'the known answer for %s is what the deterministic grader returns',
    (_id, item) => {
      expect(grade(item.id, item.trace, item.question).provenance).toBe(
        item.known,
      )
    },
  )

  /**
   * And the other half of the panel is exactly the set post 4 could not
   * settle. A case that quietly became decidable would otherwise still be
   * counted as evidence that the judge manufactures certainty.
   */
  it.each(openCases(panel).map((item) => [item.id, item] as const))(
    'the deterministic grader still returns undecidable for %s',
    (_id, item) => {
      expect(grade(item.id, item.trace, item.question).provenance).toBe(
        'undecidable',
      )
    },
  )

  it('asks each case more than once', () => {
    expect(REPEATS).toBeGreaterThan(1)
  })

  it('has both halves', () => {
    expect(controlCases(panel).length).toBeGreaterThan(0)
    expect(openCases(panel).length).toBeGreaterThan(0)
  })

  it('gives every case a distinct id', () => {
    const ids = panel.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The three constructed cases are the same run with its evidence removed,
   * so the sentence at the end of each is the sentence the real run wrote. If
   * the filter ever touched the answer frame, the cases would be three
   * different runs rather than one run against three evidence sets.
   */
  it('leaves the final answer untouched in the constructed cases', () => {
    const answers = ['source-only', 'copies-only', 'no-results', 'corpus-hit'].map(
      (id) => {
        const item = panel.find((entry) => entry.id === id)
        if (item === undefined) throw new Error(`no case "${id}" in the panel`)
        return grade(id, item.trace, item.question).finalAnswer
      },
    )
    expect(new Set(answers).size).toBe(1)
  })
})
