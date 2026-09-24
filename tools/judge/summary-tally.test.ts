import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { caseIds, cents, controlScore, parseJudgements, tallyCase } from './summary-tally.ts'

/*
 * The judge's tally, checked on a file rather than on a model.
 *
 * Every number post 7 prints about the summary judge comes out of these
 * functions and the committed `judgements.tsv`, so a change to either makes
 * `npm test` say which.
 */
const HEADER =
  'case\trepeat\tknown\tverdict\tcorrect\tquote_check\tconfidence\tinput_tokens\toutput_tokens\tquote\treason\traw'

const row = (
  id: string,
  repeat: number,
  known: string,
  verdict: string,
  correct: string,
  quote: string,
  confidence: string,
): string =>
  [id, repeat, known, verdict, correct, quote, confidence, '100', '10', 'q', 'r', 'raw'].join('\t')

const text = [
  HEADER,
  row('a', 1, 'supported', 'supported', 'yes', 'n/a', '0.9'),
  row('a', 2, 'supported', 'supported', 'yes', 'n/a', '0.8'),
  row('a', 3, 'supported', 'unsupported', 'no', 'absent', '0.5'),
  row('b', 1, 'open', 'supported', 'n/a', 'n/a', '1.0'),
  row('b', 2, 'open', 'unsupported', 'n/a', 'present', '0.6'),
].join('\n')

describe('parseJudgements', () => {
  it('reads by column name, not by position', () => {
    const rows = parseJudgements(text)
    expect(rows).toHaveLength(5)
    expect(rows[0]?.case).toBe('a')
    expect(rows[0]?.verdict).toBe('supported')
  })

  it('tolerates CRLF, because a Windows checkout serves it', () => {
    expect(parseJudgements(text.replace(/\n/g, '\r\n'))).toHaveLength(5)
  })

  it('refuses a file with a column missing rather than reading the wrong one', () => {
    expect(() => parseJudgements('case\trepeat\nx\t1')).toThrow(/no "known" column/)
  })

  it('refuses a ragged row', () => {
    expect(() => parseJudgements(`${HEADER}\na\t1`)).toThrow(/expected 12/)
  })
})

describe('tallyCase', () => {
  const a = tallyCase('a', parseJudgements(text))

  it('counts the verdicts a case produced', () => {
    expect(a.runs).toBe(3)
    expect(a.counts.supported).toBe(2)
    expect(a.counts.unsupported).toBe(1)
  })

  it('reports instability rather than only a majority', () => {
    // A judge that answered two ways on the same input is a fact about the
    // judge, and a table that printed only the winner would hide it.
    expect(a.distinct).toBe(2)
  })

  it('counts an objection to a sentence the summary does not contain', () => {
    expect(a.badQuotes).toBe(1)
  })

  it('scores against the known answer only where there is one', () => {
    expect(a.correct).toBe(2)
    expect(tallyCase('b', parseJudgements(text)).known).toBe('open')
  })
})

describe('controlScore', () => {
  it('counts only the calls whose answer was known', () => {
    expect(controlScore(parseJudgements(text))).toEqual({ correct: 2, runs: 3 })
  })
})

describe('caseIds', () => {
  it('keeps the order the file has them in', () => {
    expect(caseIds(parseJudgements(text))).toEqual(['a', 'b'])
  })
})

/*
 * The committed panel, recounted.
 *
 * Every number post 7 prints about the summary judge comes out of this file.
 * It is 130 calls of an intended 162: on call 131 the judge replied with
 * something that was not a judgement and the runner stopped, because nothing
 * here is retried. That is the rule post 5 wrote, firing for the first time,
 * and the shape of the file is part of the finding rather than a gap in it.
 */
describe('the judgements shipped with post 7', () => {
  const rows = parseJudgements(
    readFileSync(join(POSTS_DIR, '07-context', 'judgements.tsv'), 'utf8'),
  )

  it('is the panel that happened, not the panel that was planned', () => {
    expect(rows).toHaveLength(130)
    // Five compactions judged nine times each; the sixth never reached.
    expect(caseIds(rows).filter((id) => id.startsWith('real-'))).toHaveLength(5)
  })

  it('got every control right', () => {
    expect(controlScore(rows)).toEqual({ correct: 85, runs: 85 })
  })

  it('never objected to a sentence the summary did not contain', () => {
    expect(rows.filter((row) => row.quote_check === 'absent')).toHaveLength(0)
  })

  it('quoted the changed number back on every corrupted control', () => {
    const corrupted = rows.filter((row) => row.case.startsWith('corrupted-'))
    expect(corrupted.length).toBeGreaterThan(0)
    expect(corrupted.every((row) => row.verdict === 'unsupported')).toBe(true)
    expect(corrupted.every((row) => row.quote_check === 'present')).toBe(true)
  })

  it('dissented exactly once on a real summary, and the post explains why', () => {
    // The dissent is an artefact of the panel: the summariser is shown the
    // conversation through `renderForSummary` and the judge through
    // `renderTrace`, so a quotation that was verbatim for one is not findable
    // by the other. Left unfixed on purpose — fixing it raises the judge's
    // agreement rate, which is the direction that flatters the result.
    const real = rows.filter((row) => row.case.startsWith('real-'))
    expect(real).toHaveLength(45)
    const dissent = real.filter((row) => row.verdict === 'unsupported')
    expect(dissent).toHaveLength(1)
    expect(dissent[0]?.reason).toContain('"ok":true')
  })

  it('cost what the post says it cost', () => {
    expect(Math.round(cents(rows, 0.25, 2))).toBe(127)
  })
})
