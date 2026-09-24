import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runOnce } from '../agent/src/run.ts'
import { toRawTrace } from '../agent/src/recorder.ts'
import type { Roster } from '../agent/src/tools/roster.ts'
import { TASKS, type Task } from './roster/tasks.ts'
import { changed } from './roster/tasks.ts'
import { materialise, snapshot, dispose } from './roster/sandbox.ts'
import { HEADER, toLine, type Row } from './roster/row.ts'

/**
 * The experiment: the same five tasks, the same model, the same descriptions,
 * many runs, and one thing changing — how many tools the agent is holding.
 *
 *   npm run roster                      # the whole thing
 *   npm run roster -- --runs 1          # a pilot
 *   npm run roster -- --task edit-timeout --conditions four
 *
 * Fixed in this file before the first call was made:
 *
 * - **Ten runs per cell.** Post 2's phrase, learned the hard way, is that one
 *   run per condition is a coin flipped once. Five tasks by three conditions
 *   by ten runs is a hundred and fifty runs, and the number was chosen for
 *   what it costs rather than for what it would show.
 * - **The conditions are interleaved.** Every task, under every roster, is run
 *   once before any of them is run twice. A provider whose behaviour drifts
 *   over an hour then drifts across all three conditions rather than into one
 *   of them.
 * - **Nothing is retried.** A run that throws is written down as a run that
 *   threw. This series does not have a mechanism for discarding a run.
 */
export const RUNS_PER_CELL = 10
export const CONDITIONS: readonly Roster[] = ['four', 'five-append', 'five-search']

const TRACE_DIR = join('agent', 'traces', 'roster')
const DEFAULT_OUT = join('agent', 'traces', 'roster.tsv')
const COMMIT = 'v6-four-operations'

/** Runs at once. Independent sandboxes, so this changes the wall clock and nothing else. */
const CONCURRENCY = 4

type Cell = { roster: Roster; task: Task; run: number }

function plan(runs: number, tasks: readonly Task[], conditions: readonly Roster[]): Cell[] {
  const cells: Cell[] = []
  for (let run = 1; run <= runs; run += 1) {
    for (const task of tasks) {
      for (const roster of conditions) cells.push({ roster, task, run })
    }
  }
  return cells
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

async function runCell(cell: Cell, traceDir: string): Promise<Row> {
  const root = materialise()
  const when = new Date().toISOString()

  try {
    const result = await runOnce(cell.task.prompt, {
      root,
      roster: cell.roster,
      style: 'precise',
    })

    const after = snapshot(root)
    const answer = [...result.steps].reverse().find((s) => s.text.trim() !== '')?.text ?? ''
    const verdict = cell.task.check({ after, answer })

    const raw = toRawTrace({
      id: `${cell.roster}-${cell.task.id}-${cell.run}`,
      commit: COMMIT,
      model: result.model,
      task: cell.task.prompt,
      userMessage: cell.task.prompt,
      steps: result.steps,
      expected: [...cell.task.expect],
    }) as { outcome: string }

    const file = join(traceDir, `${cell.roster}__${cell.task.id}__${String(cell.run).padStart(2, '0')}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

    const inputTokens = result.steps.reduce((sum, step) => sum + step.inputTokens, 0)
    const outputTokens = result.steps.reduce(
      (sum, step) => sum + Math.max(0, step.totalTokens - step.inputTokens),
      0,
    )

    return {
      when,
      roster: cell.roster,
      task: cell.task.id,
      run: cell.run,
      tools: result.steps.flatMap((s) => s.toolCalls.map((c) => c.name)).join(' '),
      steps: result.steps.length,
      stoppedBy: result.stoppedBy,
      escapes: result.escapes.length,
      pass: verdict.pass,
      why: verdict.why,
      changed: changed(after).join(' '),
      answerGrade: raw.outcome,
      inputTokens,
      outputTokens,
      answer,
    }
  } catch (error: unknown) {
    // A run that threw is a row, not a gap. The alternative is a tally with
    // holes in it and no way to tell a hole from a run that was never made.
    return {
      when,
      roster: cell.roster,
      task: cell.task.id,
      run: cell.run,
      tools: '',
      steps: 0,
      stoppedBy: 'threw',
      escapes: 0,
      pass: false,
      why: `harness error: ${error instanceof Error ? error.name : 'unknown'}`,
      changed: '',
      answerGrade: 'failure',
      inputTokens: 0,
      outputTokens: 0,
      answer: '',
    }
  } finally {
    dispose(root)
  }
}

async function main(): Promise<void> {
  const runs = Number(flag('runs') ?? RUNS_PER_CELL)
  const only = flag('task')
  const conditions = (flag('conditions')?.split(',') as Roster[] | undefined) ?? CONDITIONS
  const out = flag('out') ?? DEFAULT_OUT
  const traceDir = flag('traces') ?? TRACE_DIR

  const tasks = only === undefined ? TASKS : TASKS.filter((task) => task.id === only)
  if (tasks.length === 0) throw new Error(`no task "${only}"`)

  const cells = plan(runs, tasks, conditions)
  mkdirSync(dirname(out), { recursive: true })
  if (!existsSync(out)) appendFileSync(out, `${HEADER}\n`, 'utf8')

  console.error(
    `[roster] ${cells.length} run(s): ${tasks.length} task(s) x ${conditions.length} condition(s) x ${runs}`,
  )

  let next = 0
  let done = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      const cell = cells[index]
      if (cell === undefined) return

      const row = await runCell(cell, traceDir)
      appendFileSync(out, `${toLine(row)}\n`, 'utf8')
      done += 1
      console.error(
        `[${done}/${cells.length}] ${row.roster} ${row.task} #${row.run} — ` +
          `${row.pass ? 'pass' : 'FAIL'} (${row.why}) — ${row.tools || 'no tool'}`,
      )
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cells.length) }, () => worker()),
  )

  console.error(`[roster] wrote ${out}`)
}

/*
 * Only run when this file is the process entry point.
 *
 * A module that does its work at import time does that work for anything that
 * imports it for a constant. `tools/context/tally.test.ts` imports two out of
 * `run-context.ts`, and without this guard that made `npm test` start a
 * hundred billed runs on any machine with a key in the environment. Every
 * entry point in the repository carries the guard now, and
 * `tools/entrypoints.test.ts` goes red if one of them loses it.
 */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
