import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
   * The prose axis is the recorder's rule recomputed from the committed file
   * rather than from the live run.
   *
   * This said, for eight posts, that the two must always agree — *"if they
   * disagree, either the trace was edited after it was graded or this
   * reimplementation is wrong"*. That was a false dichotomy and it held only
   * because nothing had ever been recorded that could break it. Post 9 broke
   * it twice, for two different and legitimate reasons, so the rule is now
   * agreement **except where a disagreement is written down with its cause**.
   * A new disagreement still goes red, which is the only thing this test was
   * ever for.
   */
  const DISAGREEMENTS: Record<string, { eval: string; recorder: string; why: string }> = {
    '09-hitl/trace-a-allow.json': {
      eval: 'partial',
      recorder: 'success',
      why:
        'the two graders were told to look for different things. The recorder ' +
        'was handed the task’s own expectation, which is the file path; this ' +
        'question also asks for the port number, and the allowed run names the ' +
        'file it created without repeating the number it put in it.',
    },
    '09-hitl/trace-b-deny.json': {
      eval: 'success',
      recorder: 'partial',
      why:
        'the recorder gained a rule this reimplementation does not have: v9 ' +
        'caps a run at partial when an approval was denied, because a call ' +
        'that never ran did not do its job. The prose axis cannot see an ' +
        'approval frame at all, and the denied run prints the whole file into ' +
        'its answer, so on sentences alone it scores higher than the run that ' +
        'actually wrote it.',
    },
  }

  it('agrees with the outcome the recorder wrote, except where it is written down', () => {
    for (const result of runSuite(POSTS_DIR)) {
      if (result.grade.answer === 'ungraded') continue
      const known = DISAGREEMENTS[result.grade.run]
      if (known !== undefined) {
        expect(`${result.grade.run}: ${result.grade.answer}`).toBe(
          `${result.grade.run}: ${known.eval}`,
        )
        expect(`${result.grade.run}: ${result.grade.recordedOutcome}`).toBe(
          `${result.grade.run}: ${known.recorder}`,
        )
        continue
      }
      expect(`${result.grade.run}: ${result.grade.answer}`).toBe(
        `${result.grade.run}: ${result.grade.recordedOutcome}`,
      )
    }
  })

  it('has a reason written down for every disagreement, and no stale ones', () => {
    const disagreeing = runSuite(POSTS_DIR)
      .filter(
        (result) =>
          result.grade.answer !== 'ungraded' &&
          result.grade.answer !== result.grade.recordedOutcome,
      )
      .map((result) => result.grade.run)
      .sort()

    expect(disagreeing).toEqual(Object.keys(DISAGREEMENTS).sort())
    for (const entry of Object.values(DISAGREEMENTS)) {
      expect(entry.why.length).toBeGreaterThan(40)
    }
  })

  it('ranks the two branches of post 9 in opposite orders', () => {
    // The finding the post turns on, asserted rather than described: the run
    // that made the change scores lower on sentences than the run that was
    // stopped from making it.
    const grades = Object.fromEntries(
      runSuite(POSTS_DIR)
        .filter((result) => result.case.post === '09-hitl')
        .map((result) => [result.case.file, result.grade]),
    )
    expect(grades['trace-a-allow.json']?.answer).toBe('partial')
    expect(grades['trace-b-deny.json']?.answer).toBe('success')
    expect(grades['trace-a-allow.json']?.recordedOutcome).toBe('success')
    expect(grades['trace-b-deny.json']?.recordedOutcome).toBe('partial')
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

  /**
   * The three identical answers, and the size the post prints for them.
   *
   * The post's own check is a shell pipeline that prints `1`. That proves the
   * three are identical and says nothing about how long they are — and the
   * byte count was in this post's LinkedIn copy before it was anywhere on the
   * page, which is a figure stated where nothing could check it. This post is
   * about grading the evidence rather than the sentence, so the figure is now
   * on the page and the check is here.
   */
  it('is the same eighty-six bytes, three times', () => {
    const answers = [
      join(POSTS_DIR, '03-the-loop', 'trace.json'),
      join(POSTS_DIR, '03-the-loop', 'trace2-corpus-hit.json'),
      join(POSTS_DIR, '04-does-it-work', 'trace-a-model-name.json'),
    ].map((file) => {
      const trace = parseTrace(JSON.parse(readFileSync(file, 'utf8')))
      const last = [...trace.frames]
        .reverse()
        .find((frame) => frame.type === 'assistant') as { content?: string } | undefined
      return last?.content ?? ''
    })

    expect(new Set(answers).size).toBe(1)
    expect(Buffer.byteLength(answers[0] ?? '', 'utf8')).toBe(86)
    expect((answers[0] ?? '').length).toBe(84)
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
