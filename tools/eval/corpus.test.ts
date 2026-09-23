import { describe, expect, it } from 'vitest'
import { parseTrace, type Trace } from '../trace/schema.ts'
import { POSTS_DIR } from '../paths.ts'
import { grade } from './grade.ts'
import { MODEL_NAME_QUESTION } from './question.ts'
import { CASES, checkCase, loadTrace, runSuite } from './suite.ts'

describe('the traces committed in this repository', () => {
  it.each(CASES.map((c) => [`${c.post}/${c.file}`, c] as const))(
    '%s still grades the way it is recorded to',
    (_name, testCase) => {
      expect(checkCase(POSTS_DIR, testCase).mismatches).toEqual([])
    },
  )

  /**
   * The prose axis is the recorder's own rule, recomputed from the committed
   * file rather than from the live run. If the two ever disagree, either the
   * trace was edited after it was graded or this reimplementation is wrong,
   * and both are worth a red line.
   */
  it('agrees with the outcome the recorder wrote, on every graded run', () => {
    for (const result of runSuite(POSTS_DIR)) {
      if (result.grade.answer === 'ungraded') continue
      expect(`${result.grade.run}: ${result.grade.answer}`).toBe(
        `${result.grade.run}: ${result.grade.recordedOutcome}`,
      )
    }
  })

  /**
   * The finding this post is built on, asserted so it cannot quietly stop
   * being true: not one committed run of the series question can be shown to
   * have answered from the source. Three had the source and a copy of it in
   * the same result set; two never saw either.
   */
  it('cannot show a single model-name run answering from the source', () => {
    const verdicts = runSuite(POSTS_DIR)
      .filter((result) => result.case.question === MODEL_NAME_QUESTION)
      .map((result) => result.grade.provenance)

    expect(verdicts.length).toBeGreaterThan(0)
    expect(verdicts).not.toContain('grounded')
  })
})

/**
 * Whether the grader can be moved by changing the decision alone.
 *
 * These fixtures are a real committed trace with matches removed in memory.
 * Nothing is written, nothing is published, and no altered trace is shown to
 * a reader as a run — the point is the opposite of dressing a result up. A
 * suite that only ever sees the traces it was written against cannot tell you
 * whether it is measuring them or remembering them, and this project has
 * already shipped one gate that had never seen anything it was supposed to
 * catch.
 */
describe('a real trace with its evidence taken away', () => {
  const testCase = CASES.find((c) => c.file === 'trace2-corpus-hit.json')
  if (testCase === undefined) throw new Error('the corpus-hit case is missing')

  const original = loadTrace(POSTS_DIR, testCase)
  const SOURCE = 'agent/src/config.ts'

  /** The same trace with its search results filtered, answer frame untouched. */
  function keepingMatches(keep: (file: string) => boolean): Trace {
    const frames = original.frames.map((frame) => {
      if (frame.type !== 'tool_result') return frame
      const result = frame.result as { matches?: { file: string }[] }
      if (result.matches === undefined) return frame
      return {
        ...frame,
        result: { ...result, matches: result.matches.filter((m) => keep(m.file)) },
      }
    })
    return parseTrace({ ...original, frames })
  }

  const sourceOnly = grade('source-only', keepingMatches((f) => f === SOURCE), MODEL_NAME_QUESTION)
  const copiesOnly = grade('copies-only', keepingMatches((f) => f !== SOURCE), MODEL_NAME_QUESTION)
  const nothing = grade('nothing', keepingMatches(() => false), MODEL_NAME_QUESTION)
  const untouched = grade('untouched', original, MODEL_NAME_QUESTION)

  it('grades the unaltered run undecidable', () => {
    expect(untouched.provenance).toBe('undecidable')
  })

  it('grades it grounded once the copies are gone', () => {
    expect(sourceOnly.provenance).toBe('grounded')
  })

  it('grades it from-copy once the source is gone', () => {
    expect(copiesOnly.provenance).toBe('from-copy')
  })

  it('grades it unevidenced once the results are empty', () => {
    expect(nothing.provenance).toBe('unevidenced')
    expect(nothing.unread).toEqual(['file', 'value'])
  })

  /**
   * And the control: through all four of those, the sentence the model wrote
   * never changed, so the grader that reads the sentence never changed its
   * mind. That is the defect post 3 reported, reproduced on demand.
   */
  it('leaves the prose grade at success throughout', () => {
    for (const result of [untouched, sourceOnly, copiesOnly, nothing]) {
      expect(`${result.run}: ${result.answer}`).toBe(`${result.run}: success`)
    }
  })
})
