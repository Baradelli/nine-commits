import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from '../paths.ts'
import { FACTS } from './task.ts'
import {
  batched,
  cents,
  cut,
  meanEstimateError,
  perFact,
  readTally,
  rowsWhere,
  sequential,
  zeroRateUpperBound,
} from './tally.ts'

/**
 * Prints the tally post 7 is written from.
 *
 *   npm run context:tally
 *   npm run context:tally -- agent/traces/context.tsv
 *
 * It reads the committed file by default, so everything it prints is something
 * a reader can recount from the repository rather than something they have to
 * take from a terminal I was looking at.
 */
const DEFAULT = join(POSTS_DIR, '07-context', 'runs.tsv')

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(0)}%`
}

function mean(total: number, runs: number): string {
  return runs === 0 ? '—' : (total / runs).toFixed(1)
}

function main(): void {
  const path = process.argv[2] ?? DEFAULT
  const rows = readTally(readFileSync(path, 'utf8'))
  const conditions = [...new Set(rows.map((row) => row.condition))].sort()

  console.log(`${rows.length} run(s) in ${path}\n`)

  console.log(
    'compaction\truns\tpass\trate\toverflow\tcapped\twrote note\tsteps/run\tcompactions/run',
  )
  for (const condition of conditions) {
    const c = cut(rowsWhere(rows, condition))
    console.log(
      [
        condition,
        c.runs,
        c.passes,
        pct(c.passes, c.runs),
        c.overflowed,
        c.capped,
        c.wroteNote,
        mean(c.steps, c.runs),
        mean(c.compactions, c.runs),
      ].join('\t'),
    )
  }

  console.log('\nanswers written down, out of runs')
  console.log(['fact', ...conditions].join('\t'))
  for (const fact of FACTS) {
    const cells = conditions.map((condition) => {
      const subset = rowsWhere(rows, condition)
      return `${perFact(subset).get(fact.id) ?? 0}/${subset.length}`
    })
    console.log([fact.id, ...cells].join('\t'))
  }

  console.log('\nthe composition: one page per turn, or several at once')
  console.log('compaction\tgroup\truns\tpass\toverflow')
  for (const condition of conditions) {
    const subset = rowsWhere(rows, condition)
    for (const [label, group] of [
      ['one at a time', sequential(subset)],
      ['several at once', batched(subset)],
    ] as const) {
      const c = cut(group)
      console.log([condition, label, c.runs, c.passes, c.overflowed].join('\t'))
    }
  }

  console.log('\nwhat compaction threw away, and what the summary carried')
  for (const condition of conditions) {
    const subset = rowsWhere(rows, condition)
    const dropped = subset.reduce(
      (sum, row) => sum + (row.facts_dropped === 'none' ? 0 : row.facts_dropped.split(' ').length),
      0,
    )
    const kept = subset.reduce(
      (sum, row) => sum + (row.facts_kept === 'none' ? 0 : row.facts_kept.split(' ').length),
      0,
    )
    const lost = subset.reduce(
      (sum, row) => sum + (row.facts_lost === 'none' ? 0 : row.facts_lost.split(' ').length),
      0,
    )
    console.log(`${condition}\tdropped ${dropped}\tkept ${kept}\tlost ${lost}`)
  }

  console.log('\ncontext and cost')
  console.log(
    'compaction\tpeak request\tinput tokens\toutput\tsummariser in\tsummariser out\tlive fetches',
  )
  for (const condition of conditions) {
    const subset = rowsWhere(rows, condition)
    const c = cut(subset)
    console.log(
      [
        condition,
        c.peakContext,
        c.inputTokens,
        c.outputTokens,
        c.summaryInputTokens,
        c.summaryOutputTokens,
        subset.reduce((sum, row) => sum + Number(row.live_fetches), 0),
      ].join('\t'),
    )
  }

  console.log('\nthe estimator against the provider, mean signed error')
  for (const condition of conditions) {
    console.log(
      `${condition}\t${meanEstimateError(rowsWhere(rows, condition)).toFixed(2)}%`,
    )
  }

  console.log('\ndetection floor, 95% one-sided, for a rate observed zero times')
  for (const condition of conditions) {
    const n = rowsWhere(rows, condition).length
    console.log(`${condition}\tn=${n}\t${(zeroRateUpperBound(n) * 100).toFixed(1)}%`)
  }

  console.log(
    `\ncost\t${cents(rows, 0.25, 2).toFixed(1)}c at $0.25/$2 per million, summariser included`,
  )
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
