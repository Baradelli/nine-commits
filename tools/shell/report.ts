import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from '../paths.ts'
import { TASKS } from './tasks.ts'
import {
  binaryCounts,
  by,
  cents,
  cut,
  detectionFloor,
  meanContext,
  perTask,
  readTally,
  rowsWhere,
  ruleCounts,
  runsCalling,
  toolCounts,
} from './tally.ts'
import { parseAttacks } from './attack-row.ts'

/**
 * Prints the tally post 8 is written from.
 *
 *   npm run shell:tally
 *   npm run shell:tally -- agent/traces/shell.tsv
 *
 * It reads the committed files by default, so anything it prints is something a
 * reader can recount from the repository rather than something they have to
 * take from a terminal I was looking at.
 */
const POST = join(POSTS_DIR, '08-shell')
const DEFAULT = join(POST, 'runs.tsv')
const ATTACKS = join(POST, 'attacks.tsv')

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(0)}%`
}

function main(): void {
  const path = process.argv[2] ?? DEFAULT
  const rows = readTally(readFileSync(path, 'utf8'))
  const rosters = [...by(rows, 'roster').keys()].sort()

  console.log(`${rows.length} run(s) in ${path}\n`)

  console.log(
    'condition\truns\tpass\trate\tstray\tescapes\truns w/ refusal\tcommands\trefusals\tidle\tcapped\tsteps/run',
  )
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
        c.refused,
        c.commands,
        c.refusals,
        c.idle,
        c.capped,
        (c.steps / Math.max(1, c.runs)).toFixed(2),
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

  console.log('\ninput tokens per run, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) => {
      const c = perTask(rows, roster).get(task.id)
      return c === undefined ? '—' : String(Math.round(c.inputTokens / Math.max(1, c.runs)))
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

  console.log('\ncontext carried before the first action, task by task')
  console.log(['task', ...rosters].join('\t'))
  for (const task of TASKS) {
    const cells = rosters.map((roster) =>
      meanContext(rowsWhere(rows, { roster, task: task.id })).toFixed(1),
    )
    console.log([task.id, ...cells].join('\t'))
  }

  console.log('\ntool calls, by condition')
  for (const roster of rosters) {
    const counts = [...toolCounts(rowsWhere(rows, { roster })).entries()].sort(
      (a, b) => b[1] - a[1],
    )
    console.log(`${roster}\t${counts.map(([name, n]) => `${name} ${n}`).join('  ')}`)
  }

  const shellRows = rowsWhere(rows, { roster: 'four-shell' })
  console.log(`\nruns that called run_command at all\t${runsCalling(shellRows, 'run_command')} of ${shellRows.length}`)

  console.log('\nwhat the model asked for, by first word of the command line')
  const binaries = [...binaryCounts(shellRows).entries()].sort((a, b) => b[1] - a[1])
  for (const [name, n] of binaries) console.log(`  ${name}\t${n}`)

  console.log('\nwhy the guard refused, by rule')
  const rules = [...ruleCounts(shellRows).entries()].sort((a, b) => b[1] - a[1])
  for (const [rule, n] of rules) console.log(`  ${rule}\t${n}`)

  console.log('\nrefusals per task')
  for (const task of TASKS) {
    const c = perTask(rows, 'four-shell').get(task.id)
    if (c === undefined) continue
    console.log(`  ${task.id}\t${c.refusals} refused of ${c.commands} written, in ${c.refused}/${c.runs} runs`)
  }

  console.log('\ndetection floor, 95% upper bound on a failure rate with no failures')
  for (const roster of rosters) {
    const c = cut(rowsWhere(rows, { roster }))
    console.log(
      `  ${roster}\t${c.runs} runs, ${c.runs - c.passes} failure(s)` +
        (c.passes === c.runs
          ? `, floor ${(detectionFloor(c.runs) * 100).toFixed(1)}%`
          : ''),
    )
  }

  const totals = cut(rows)
  console.log(
    `\ntokens\t${totals.inputTokens} in, ${totals.outputTokens} out` +
      `\ncost\t${cents(rows, 0.25, 2).toFixed(1)}c at $0.25/$2 per million`,
  )

  try {
    const attacks = parseAttacks(readFileSync(ATTACKS, 'utf8'))
    const refusedCount = attacks.filter((a) => a.verdict === 'refused').length
    console.log(
      `\n${attacks.length} attack(s) in ${ATTACKS}: ${refusedCount} refused, ` +
        `${attacks.length - refusedCount} allowed, ` +
        `${attacks.filter((a) => a.agreed === 'no').length} disagreed with the prediction`,
    )
  } catch {
    console.log('\n(no attack table beside the post yet — run npm run attacks)')
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
