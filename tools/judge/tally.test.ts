import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJudgements } from './tally.ts'

const HEADER =
  'case\tkind\tknown_answer\trepeat\tverdict\tagrees_with_known\tcitation\tcitation_check\tconfidence\tinput_tokens\toutput_tokens\treason'
const ROW =
  'loop-demo\topen\t-\t1\tgrounded\t-\tagent/src/config.ts:1\tconsistent\t0.92\t100\t20\tit quoted the line'

function write(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'tally-')), 'judgements.tsv')
  writeFileSync(path, contents, 'utf8')
  return path
}

describe('reading a committed tally', () => {
  it('reads a row', () => {
    const [row] = readJudgements(write(`# a comment\n${HEADER}\n${ROW}\n`))
    expect(row?.case).toBe('loop-demo')
    expect(row?.verdict).toBe('grounded')
    expect(row?.confidence).toBe(0.92)
    expect(row?.inputTokens).toBe(100)
  })

  /**
   * `core.autocrlf` is true on the machine this repository is written on, so a
   * fresh Windows checkout serves this file with CRLF. Splitting on `\n` alone
   * left a carriage return on the last cell of every row and the reader threw
   * "no reason column" — loudly, because every lookup is by name. This is the
   * regression test rather than the anecdote.
   */
  it('reads the same rows whichever line ending the checkout produced', () => {
    const lf = readJudgements(write(`${HEADER}\n${ROW}\n`))
    const crlf = readJudgements(write(`${HEADER}\r\n${ROW}\r\n`))
    expect(crlf).toEqual(lf)
  })

  it('ignores an optional column it does not read', () => {
    const [row] = readJudgements(
      write(`${HEADER}\traw\n${ROW}\t{"verdict":"grounded"}\n`),
    )
    expect(row?.reason).toBe('it quoted the line')
  })

  it.each([
    ['a missing column', `case\trepeat\tverdict\n${ROW}`],
    ['a verdict outside the vocabulary', `${HEADER}\n${ROW.replace('grounded', 'probably')}`],
    ['a confidence that is not a number', `${HEADER}\n${ROW.replace('0.92', 'high')}`],
    ['a short row', `${HEADER}\nloop-demo\topen`],
  ])('refuses %s rather than skipping it', (_name, contents) => {
    expect(() => readJudgements(write(contents))).toThrow()
  })
})
