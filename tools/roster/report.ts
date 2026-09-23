import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from '../paths.ts'
import { TASKS } from './tasks.ts'
import {
  by,
  cents,
  cut,
  meanContext,
  perTask,
  readTally,
  rowsWhere,
  runsCalling,
  toolCounts,
} from './tally.ts'

/**
 * Prints the tally the post is written from.
 *
 *   npm run roster:tally
 *   npm run roster:tally -- agent/traces/roster.tsv
 *
 * It reads the committed file by default, so anything it prints is something a
 * reader can recount from the repository rather than something they have to
 * take from a terminal I was looking at.
 */
const DEFAULT = join(POSTS_DIR, '06-four-operations', 'runs.tsv')

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(0)}%`
}

function main(): void {
  const path = process.argv[2] ?? DEFAULT
  const rows = readTally(readFileSync(path, 'utf8'))
  const rosters = [...by(rows, 'roster').keys()].sort()

  console.log(`${rows.length} run(s) in ${path}\n`)

  console.log('condition\truns\tpass\trate\tstray\tescapes\tidle\tcapped\tsteps/run')
  for (const roster of rosters) {
    const c = cut(rowsWhere(rows, { roster }))
    console.log(
      [
        roster,
        c.runs,
        c.passes,
        pct(c.passes, c.runs),
        c.stray,
        c.escaped,
        c.idle,
        c.capped,
        (c.steps / Math.max(1, c.runs)).toFixed(1),
      ].join('\t'),
    )
  }

  console.log('\npass rate, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) => {
      const c = perTask(rows, roster).get(task.id)
      return c === undefined ? '—' : `${c.passes}/${c.runs}`
    })
    console.log([task.id, ...cells].join('\t'))
  }

  console.log('\nsteps per run, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) => {
      const c = perTask(rows, roster).get(task.id)
      return c === undefined ? '—' : (c.steps / Math.max(1, c.runs)).toFixed(1)
    })
    console.log([task.id, ...cells].join('\t'))
  }

  console.log('\ninput tokens per run, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) => {
      const c = perTask(rows, roster).get(task.id)
      return c === undefined ? '—' : String(Math.round(c.inputTokens / Math.max(1, c.runs)))
    })
    console.log([task.id, ...cells].join('\t'))
  }

  console.log('\ncontext carried before the first action, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) =>
      meanContext(rowsWhere(rows, { roster, task: task.id })).toFixed(0),
    )
    console.log([task.id, ...cells].join('\t'))
  }

  console.log('\ntool calls, by condition')
  for (const roster of rosters) {
    const subset = rowsWhere(rows, { roster })
    const counts = [...toolCounts(subset).entries()].sort((a, b) => b[1] - a[1])
    console.log(
      `${roster}\t${counts.map(([name, n]) => `${name} ${n}`).join('  ')}`,
    )
  }

  console.log('\nruns that called the fifth tool at all')
  for (const [roster, tool] of [
    ['five-append', 'append_file'],
    ['five-search', 'search_files'],
  ] as const) {
    const subset = rowsWhere(rows, { roster })
    if (subset.length === 0) continue
    console.log(`${roster}\t${runsCalling(subset, tool)} of ${subset.length}`)
  }

  const totals = cut(rows)
  console.log(
    `\ntokens\t${totals.inputTokens} in, ${totals.outputTokens} out` +
      `\ncost\t${cents(rows, 0.25, 2).toFixed(1)}c at $0.25/$2 per million`,
  )
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
