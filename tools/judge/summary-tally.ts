import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from '../paths.ts'
import { SUMMARY_VERDICTS, type SummaryVerdict } from './summary.ts'

/**
 * The summary judge's tally, recomputed from the committed file.
 *
 * Same shape as post 5's: control accuracy where the answer is known, the
 * verdict spread where it is not, and a deterministic check on the judge's own
 * quotation that is free and that a verdict alone cannot give you.
 */
export const COLUMNS = [
  'case',
  'repeat',
  'known',
  'verdict',
  'correct',
  'quote_check',
  'confidence',
  'input_tokens',
  'output_tokens',
  'quote',
  'reason',
  'raw',
] as const

export type Row = Record<(typeof COLUMNS)[number], string>

export function parseJudgements(text: string): Row[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')
  const head = lines.shift()
  if (head === undefined) throw new Error('judgements: empty file')
  const names = head.split('\t').map((name) => name.trim())
  for (const column of COLUMNS) {
    if (!names.includes(column)) throw new Error(`judgements: no "${column}" column`)
  }
  return lines.map((line, index) => {
    const cells = line.split('\t').map((value) => value.trim())
    if (cells.length !== names.length) {
      throw new Error(
        `judgements: row ${index + 1} has ${cells.length} cells, expected ${names.length}`,
      )
    }
    return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])) as Row
  })
}

export type CaseTally = {
  case: string
  known: string
  runs: number
  counts: Record<SummaryVerdict, number>
  /** Individual calls that matched the known answer, where there is one. */
  correct: number
  /** How many distinct verdicts the repeats produced. One means stable. */
  distinct: number
  meanConfidence: number
  /** Objections to a sentence the summary does not contain. */
  badQuotes: number
}

export function tallyCase(caseId: string, rows: readonly Row[]): CaseTally {
  const mine = rows.filter((row) => row.case === caseId)
  const counts = Object.fromEntries(
    SUMMARY_VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<SummaryVerdict, number>
  for (const row of mine) {
    if ((SUMMARY_VERDICTS as readonly string[]).includes(row.verdict)) {
      counts[row.verdict as SummaryVerdict] += 1
    }
  }
  return {
    case: caseId,
    known: mine[0]?.known ?? 'open',
    runs: mine.length,
    counts,
    correct: mine.filter((row) => row.correct === 'yes').length,
    distinct: SUMMARY_VERDICTS.filter((verdict) => counts[verdict] > 0).length,
    meanConfidence:
      mine.length === 0
        ? 0
        : mine.reduce((sum, row) => sum + Number(row.confidence), 0) / mine.length,
    badQuotes: mine.filter((row) => row.quote_check === 'absent' || row.quote_check === 'none')
      .length,
  }
}

export function caseIds(rows: readonly Row[]): string[] {
  return [...new Set(rows.map((row) => row.case))]
}

/** Calls on cases whose answer is known, and how many of them were right. */
export function controlScore(rows: readonly Row[]): { correct: number; runs: number } {
  const known = rows.filter((row) => row.known !== 'open')
  return {
    correct: known.filter((row) => row.correct === 'yes').length,
    runs: known.length,
  }
}

export function cents(
  rows: readonly Row[],
  perMillionInput: number,
  perMillionOutput: number,
): number {
  const input = rows.reduce((sum, row) => sum + Number(row.input_tokens), 0)
  const output = rows.reduce((sum, row) => sum + Number(row.output_tokens), 0)
  return (
    (input / 1_000_000) * perMillionInput * 100 +
    (output / 1_000_000) * perMillionOutput * 100
  )
}

const DEFAULT = join(POSTS_DIR, '07-context', 'judgements.tsv')

function main(): void {
  const path = process.argv[2] ?? DEFAULT
  const rows = parseJudgements(readFileSync(path, 'utf8'))

  console.log(`${rows.length} judgement(s) in ${path}\n`)

  console.log('case\tknown\truns\tsupported\tunsupported\tcorrect\tdistinct\tconfidence\tbad quotes')
  for (const id of caseIds(rows)) {
    const t = tallyCase(id, rows)
    console.log(
      [
        t.case,
        t.known,
        t.runs,
        t.counts.supported,
        t.counts.unsupported,
        t.known === 'open' ? '—' : `${t.correct}/${t.runs}`,
        t.distinct,
        t.meanConfidence.toFixed(2),
        t.badQuotes,
      ].join('\t'),
    )
  }

  const control = controlScore(rows)
  console.log(
    `\ncontrols\t${control.correct} of ${control.runs} calls correct` +
      `\ncost\t${cents(rows, 0.25, 2).toFixed(1)}c at $0.25/$2 per million`,
  )
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
