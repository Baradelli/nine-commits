import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POSTS_DIR } from '../paths.ts'
import { buildPanel, REPEATS } from './panel.ts'
import { checkCitation, scorePanel, tally, type Judged } from './score.ts'
import { readJudgements } from './tally.ts'
import { VERDICTS, type JudgeVerdict } from './verdict.ts'

const TALLY = join(POSTS_DIR, '05-moving-target', 'judgements.tsv')

const panel = buildPanel()
const judgements = readJudgements(TALLY)
const score = scorePanel(panel, judgements)

const openIds = new Set(score.open.map((open) => open.case))

function mean(rows: readonly Judged[]): string {
  return (
    rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
  ).toFixed(4)
}

function counts(rows: readonly Judged[]): string {
  return VERDICTS.filter((verdict) => rows.some((row) => row.verdict === verdict))
    .map(
      (verdict) =>
        `${rows.filter((row) => row.verdict === verdict).length} × ${verdict}`,
    )
    .join(', ')
}

function byLabel(kind: 'open' | 'control', verdict: JudgeVerdict): string {
  const rows = judgements.filter(
    (row) =>
      openIds.has(row.case) === (kind === 'open') && row.verdict === verdict,
  )
  return `n=${rows.length} mean=${rows.length === 0 ? '-' : mean(rows)}`
}

/**
 * Every number post 5 prints about the judge, recomputed from the committed
 * file.
 *
 * This is not a prediction and it is not a target. The judge was run once, the
 * rows were written, and these are what the rows say — which is the opposite
 * of how `suite.ts` was built, and has to be, because nobody can predict a
 * model's verdict and pretending otherwise would be the tuning this post is
 * about. What it gates is the only thing left to gate: that the prose and the
 * artifact do not drift apart. Edit a number in the post without rerunning the
 * judge, or rerun the judge and leave the post alone, and this goes red.
 *
 * The per-case and per-label rows were added in fix round 1. The post promises
 * the reader that every judge number on the page is recomputed here, and that
 * promise was being kept for the headline figures while eleven mean
 * confidences printed in the tables were ungated. In this series, of all
 * series, that is the kind of gap that gets written about rather than left.
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

  /** Both tables in "What broke", cell for cell. */
  it.each([
    ['binary-control', '9 × grounded', '0.9144'],
    ['named-only', '9 × unevidenced', '0.9144'],
    ['empty-search', '9 × unevidenced', '0.9067'],
    ['source-only', '9 × grounded', '0.9389'],
    ['copies-only', '8 × from-copy, 1 × undecidable', '0.8144'],
    ['no-results', '9 × unevidenced', '0.8611'],
    ['loop-demo', '9 × grounded', '0.9344'],
    ['corpus-hit', '9 × grounded', '0.9300'],
    ['v4-model-name', '9 × grounded', '0.9278'],
    ['retired-control', '9 × grounded', '0.9211'],
  ])('%s: %s at mean confidence %s', (id, expected, expectedMean) => {
    const rows = judgements.filter((row) => row.case === id)
    expect(`${id}: ${counts(rows)}`).toBe(`${id}: ${expected}`)
    expect(`${id}: ${mean(rows)}`).toBe(`${id}: ${expectedMean}`)
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
   * `undecidable`. That call is also the lowest confidence anywhere on the
   * panel, which the post now says in single calls rather than in per-case
   * means.
   */
  it('used the verdict that declines exactly once, and was wrong to', () => {
    const declined = judgements.filter(
      (judgement) => judgement.verdict === 'undecidable',
    )
    expect(declined).toHaveLength(1)
    expect(declined[0]?.case).toBe('copies-only')
    expect(declined[0]?.confidence).toBe(0.65)
    expect(Math.min(...judgements.map((row) => row.confidence))).toBe(0.65)
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

  /**
   * The bound on the one leak in the panel.
   *
   * `retired-control` is the only case whose trace carries an earlier grader's
   * verdict inside its own evidence. Take its nine calls out and the open set
   * does not move, which is the difference between a disclosed confound and an
   * unhandled one.
   */
  it('still answers every open case without the one contaminated run', () => {
    const rest = judgements.filter(
      (row) => openIds.has(row.case) && row.case !== 'retired-control',
    )
    expect(rest).toHaveLength(27)
    expect(rest.every((row) => row.verdict === 'grounded')).toBe(true)
    expect(mean(rest)).toBe('0.9307')
  })

  /**
   * The claim that replaced "its confidence is pointed the wrong way", which
   * did not survive controlling for the verdict: compared like for like, the
   * judge charges the same for a `grounded` it can prove and one it cannot.
   */
  it('prices confidence by the label, not by whether the label is knowable', () => {
    expect(byLabel('open', 'grounded')).toBe('n=36 mean=0.9283')
    expect(byLabel('control', 'grounded')).toBe('n=18 mean=0.9267')
    expect(byLabel('control', 'from-copy')).toBe('n=8 mean=0.8350')
    expect(byLabel('control', 'unevidenced')).toBe('n=27 mean=0.8941')
  })

  /** The two aggregates the post quotes on its way to retracting the comparison. */
  it('reports the raw open and control-correct means it starts from', () => {
    const open = judgements.filter((row) => openIds.has(row.case))
    const rightControls = judgements.filter((row) => {
      const item = panel.find((entry) => entry.id === row.case)
      return item?.known !== undefined && row.verdict === item.known
    })
    expect(mean(open)).toBe('0.9283')
    expect(mean(rightControls)).toBe('0.8962')
  })

  it('cost what the post says it cost', () => {
    expect(score.inputTokens).toBe(142893)
    expect(score.outputTokens).toBe(46964)
  })
})
