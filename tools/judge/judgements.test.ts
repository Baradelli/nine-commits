import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POSTS_DIR } from '../paths.ts'
import { buildPanel, REPEATS } from './panel.ts'
import { checkCitation, scorePanel, tally } from './score.ts'
import { readJudgements } from './tally.ts'

const TALLY = join(POSTS_DIR, '05-moving-target', 'judgements.tsv')

const panel = buildPanel()
const judgements = readJudgements(TALLY)
const score = scorePanel(panel, judgements)

/**
 * Every number post 5 prints about the judge, recomputed from the committed
 * file.
 *
 * This is not a prediction and it is not a target. The judge was run once,
 * the rows were written, and these are what the rows say — which is the
 * opposite of how `suite.ts` was built, and has to be, because nobody can
 * predict a model's verdict and pretending otherwise would be the tuning this
 * post is about. What it gates is the only thing left to gate: that the prose
 * and the artifact do not drift apart. Edit a number in the post without
 * rerunning the judge, or rerun the judge and leave the post alone, and this
 * goes red.
 */
describe('the committed tally', () => {
  it('has one row per case per repeat', () => {
    expect(judgements).toHaveLength(panel.length * REPEATS)
    for (const item of panel) {
      expect(`${item.id}: ${tally(item.id, judgements).runs}`).toBe(
        `${item.id}: ${REPEATS}`,
      )
    }
  })

  it('scored 53 of 54 control calls correct, and every control majority', () => {
    expect(score.calls).toBe(54)
    expect(score.correct).toBe(53)
    expect(score.majoritiesCorrect).toBe(6)
    expect(score.controlCount).toBe(6)
  })

  it('had exactly one control whose repeats disagreed', () => {
    expect(score.unstableControls).toBe(1)
    const unstable = score.controls.filter(
      (control) => tally(control.case, judgements).distinct > 1,
    )
    expect(unstable.map((control) => control.case)).toEqual(['copies-only'])
  })

  /** The finding. Thirty-six calls on four runs code cannot settle, and not one refusal. */
  it('answered every open case, every time, and always the same way', () => {
    for (const open of score.open) {
      expect(`${open.case}: ${open.decided}/${open.runs}`).toBe(
        `${open.case}: ${REPEATS}/${REPEATS}`,
      )
      expect(`${open.case}: ${open.majority}`).toBe(`${open.case}: grounded`)
      expect(`${open.case}: ${open.distinct}`).toBe(`${open.case}: 1`)
    }
    expect(score.open).toHaveLength(4)
  })

  /**
   * And the sentence the post turns on: in ninety calls the judge reached for
   * `undecidable` once, on a case whose answer was not in doubt and was not
   * `undecidable`.
   */
  it('used the verdict that declines exactly once, and was wrong to', () => {
    const declined = judgements.filter(
      (judgement) => judgement.verdict === 'undecidable',
    )
    expect(declined).toHaveLength(1)
    expect(declined[0]?.case).toBe('copies-only')
    const item = panel.find((entry) => entry.id === 'copies-only')
    expect(item?.known).toBe('from-copy')
  })

  /**
   * The second-order finding. Every manufactured verdict cites a line that was
   * really returned, in the file that really is the source, so the free
   * deterministic check on the judge's own reasoning passes on all of them. A
   * citation check catches a judge contradicting itself. It cannot catch one
   * drawing a conclusion the evidence does not carry.
   */
  it('never cited a line the run did not see, on any case', () => {
    for (const judgement of judgements) {
      const item = panel.find((entry) => entry.id === judgement.case)
      if (item === undefined) throw new Error(`no case "${judgement.case}"`)
      expect(`${judgement.case} #${judgement.repeat}`).toBe(
        ['contradicts', 'unobserved'].includes(checkCitation(item, judgement))
          ? 'a bad citation'
          : `${judgement.case} #${judgement.repeat}`,
      )
    }
  })

  it('was more confident on the runs with no answer than on the ones it got right', () => {
    const mean = (rows: typeof judgements) =>
      rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
    const openIds = new Set(score.open.map((open) => open.case))
    const open = judgements.filter((row) => openIds.has(row.case))
    const rightControls = judgements.filter((row) => {
      const item = panel.find((entry) => entry.id === row.case)
      return item?.known !== undefined && row.verdict === item.known
    })

    expect(mean(open)).toBeGreaterThan(mean(rightControls))
    expect(mean(open).toFixed(2)).toBe('0.93')
    expect(mean(rightControls).toFixed(2)).toBe('0.90')
  })

  it('cost what the post says it cost', () => {
    expect(score.inputTokens).toBe(142893)
    expect(score.outputTokens).toBe(46964)
  })
})
