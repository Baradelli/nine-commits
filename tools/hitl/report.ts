import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from '../paths.ts'
import {
  cents,
  cut,
  detectionFloor,
  fisherExact,
  gateCounts,
  meanContext,
  perTask,
  readTally,
  rowsWhere,
  toolCounts,
} from './tally.ts'
import { overAsk, readShellRuns } from './overask.ts'

/**
 * Prints the tables post 9 prints, from the committed tally.
 *
 *   npm run hitl:tally
 *
 * Reading only. It makes no model call and writes nothing, so it can be run
 * against a checkout at any time to check the page against its own file.
 */
const CONDITIONS = ['none', 'allow', 'deny'] as const

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

function main(): void {
  const file = join(POSTS_DIR, '09-hitl', 'runs.tsv')
  const rows = readTally(readFileSync(file, 'utf8'))
  const byCondition = CONDITIONS.map((condition) => ({
    condition,
    rows: rowsWhere(rows, { condition }),
  }))

  console.log(`\n${rows.length} runs from ${file}\n`)

  console.log(
    pad('', 24) + CONDITIONS.map((c) => pad(c, 12)).join(''),
  )
  const lines: [string, (c: ReturnType<typeof cut>) => string][] = [
    ['runs', (c) => String(c.runs)],
    ['tasks completed', (c) => String(c.passes)],
    ['runs gated', (c) => String(c.gated)],
    ['questions asked', (c) => String(c.approvals)],
    ['asked more than once', (c) => String(c.reasked)],
    ['answer names a refusal', (c) => String(c.mentioned)],
    ['stopped by the cap', (c) => String(c.capped)],
    ['stray file changes', (c) => String(c.stray)],
    ['paths refused', (c) => String(c.escaped)],
    ['steps per run', (c) => (c.steps / Math.max(1, c.runs)).toFixed(2)],
    ['input tokens', (c) => String(c.inputTokens)],
    ['output tokens', (c) => String(c.outputTokens)],
  ]
  for (const [label, render] of lines) {
    console.log(
      pad(label, 24) +
        byCondition.map(({ rows: r }) => pad(render(cut(r)), 12)).join(''),
    )
  }
  console.log(
    pad('context before acting', 24) +
      byCondition
        .map(({ rows: r }) => pad(meanContext(r).toFixed(1), 12))
        .join(''),
  )
  console.log(
    pad('US cents', 24) +
      byCondition.map(({ rows: r }) => pad(cents(r).toFixed(1), 12)).join(''),
  )

  console.log('\nper task (passes out of runs)\n')
  const tasks = [...new Set(rows.map((row) => row.task))]
  const byTask = CONDITIONS.map((condition) => perTask(rows, condition))
  console.log(pad('task', 22) + CONDITIONS.map((c) => pad(c, 10)).join('') + 'p(none vs deny)')
  for (const task of tasks) {
    const cells = byTask.map((map) => map.get(task))
    const none = cells[0]
    const deny = cells[2]
    const p =
      none === undefined || deny === undefined
        ? 1
        : fisherExact(
            none.passes,
            none.runs - none.passes,
            deny.passes,
            deny.runs - deny.passes,
          )
    console.log(
      pad(task, 22) +
        cells
          .map((c) => pad(c === undefined ? '-' : `${c.passes}/${c.runs}`, 10))
          .join('') +
        p.toFixed(4),
    )
  }

  const none = cut(rowsWhere(rows, { condition: 'none' }))
  const allow = cut(rowsWhere(rows, { condition: 'allow' }))
  const deny = cut(rowsWhere(rows, { condition: 'deny' }))

  console.log('\ncomparisons')
  console.log(
    `  none vs allow, tasks completed: ${none.passes}/${none.runs} vs ${allow.passes}/${allow.runs}` +
      `  p = ${fisherExact(none.passes, none.runs - none.passes, allow.passes, allow.runs - allow.passes).toFixed(4)}`,
  )
  console.log(
    `  none vs deny,  tasks completed: ${none.passes}/${none.runs} vs ${deny.passes}/${deny.runs}` +
      `  p = ${fisherExact(none.passes, none.runs - none.passes, deny.passes, deny.runs - deny.passes).toFixed(4)}`,
  )

  console.log('\ndetection floors (95% upper bound, no failures observed)')
  console.log(`  ${none.runs} runs a condition: ${(detectionFloor(none.runs) * 100).toFixed(1)}%`)
  console.log(`  10 runs a cell:           ${(detectionFloor(10) * 100).toFixed(1)}%`)

  console.log('\nwhich tools the gate asked about')
  for (const [tool, count] of [...gateCounts(rows)].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(tool, 16)} ${count}`)
  }

  console.log('\ntool calls, by condition')
  for (const { condition, rows: r } of byCondition) {
    const counts = [...toolCounts(r)].sort((a, b) => b[1] - a[1])
    console.log(`  ${pad(condition, 8)} ${counts.map(([n, c]) => `${n} ${c}`).join(', ')}`)
  }

  const over = overAsk(readShellRuns())
  console.log(
    `\nwhat a gate on run_command would have cost post 8: ${over.questions} question(s) ` +
      `across ${over.runs} runs, ${over.pointless} of them about a command that could not ` +
      `change a byte, interrupting ${over.runsInterrupted} runs.`,
  )
}

/* Only run when this file is the process entry point. */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
