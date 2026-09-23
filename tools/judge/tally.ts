import { readFileSync } from 'node:fs'
import { VERDICTS, type JudgeVerdict } from './verdict.ts'
import type { Judged } from './score.ts'

/**
 * Reads the committed tally back.
 *
 * Every number this post prints about the judge is recomputed from the file
 * by `judgements.test.ts` rather than typed out of a terminal. Post 2's table
 * was typed out of a terminal and said so, and called itself a weaker artifact
 * than the claim it supported; this is the other end of that lesson. The file
 * is the record, the prose is a reading of it, and the test is what keeps the
 * two together.
 *
 * It is strict on purpose. A column that has moved, a verdict outside the
 * vocabulary or a confidence that is not a number raises, because a reader
 * that quietly skips a row it cannot parse turns a broken tally into a
 * smaller, cleaner-looking one.
 */
export function readJudgements(path: string): Judged[] {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))

  const header = lines.shift()?.split('\t')
  if (header === undefined) throw new Error(`${path}: no header row`)

  const column = (name: string): number => {
    const index = header.indexOf(name)
    if (index === -1) throw new Error(`${path}: no "${name}" column`)
    return index
  }

  const at = {
    case: column('case'),
    repeat: column('repeat'),
    verdict: column('verdict'),
    citation: column('citation'),
    confidence: column('confidence'),
    inputTokens: column('input_tokens'),
    outputTokens: column('output_tokens'),
    reason: column('reason'),
  }

  return lines.map((line, row) => {
    const cells = line.split('\t')
    const cell = (index: number): string => {
      const value = cells[index]
      if (value === undefined) {
        throw new Error(`${path}: row ${row + 1} is missing a column`)
      }
      return value
    }

    const verdict = cell(at.verdict)
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      throw new Error(`${path}: row ${row + 1} has verdict "${verdict}"`)
    }

    const number = (index: number, name: string): number => {
      const value = Number(cell(index))
      if (!Number.isFinite(value)) {
        throw new Error(`${path}: row ${row + 1} has a non-numeric ${name}`)
      }
      return value
    }

    return {
      case: cell(at.case),
      repeat: number(at.repeat, 'repeat'),
      verdict: verdict as JudgeVerdict,
      citation: cell(at.citation),
      confidence: number(at.confidence, 'confidence'),
      reason: cell(at.reason),
      inputTokens: number(at.inputTokens, 'input_tokens'),
      outputTokens: number(at.outputTokens, 'output_tokens'),
    }
  })
}
