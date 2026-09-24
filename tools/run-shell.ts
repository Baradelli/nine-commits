import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runOnce } from '../agent/src/run.ts'
import { toRawTrace } from '../agent/src/recorder.ts'
import type { Roster } from '../agent/src/tools/roster.ts'
import { changed } from './roster/tasks.ts'
import { materialise, snapshot, dispose } from './roster/sandbox.ts'
import { TASKS, type Task } from './shell/tasks.ts'
import { HEADER, toLine, type Row } from './shell/row.ts'

/**
 * The experiment: the same seven tasks, the same model, the same descriptions,
 * many runs, and one thing changing — whether the agent has a shell.
 *
 *   npm run shell                       # the whole thing
 *   npm run shell -- --runs 1           # a pilot
 *   npm run shell -- --task largest-file --conditions four-shell
 *
 * Fixed in this file before the first call was made:
 *
 * - **Ten runs per cell.** Post 6's number, kept so the two posts can be read
 *   against each other. Seven tasks by two conditions by ten runs is a hundred
 *   and forty runs. Post 2's phrase is that one run per condition is a coin
 *   flipped once; post 6's is that a null result stated without its detection
 *   floor is a stronger claim than the runs support, and seventy runs with no
 *   failures put the 95% upper bound on a condition's failure rate at 4.2%.
 *   That is the resolution this experiment is bought at, and it is written
 *   here rather than discovered afterwards.
 * - **The conditions are interleaved.** Every task under both rosters runs once
 *   before either runs twice, so a provider drifting over an hour drifts across
 *   both rather than into one.
 * - **Nothing is retried.** A run that throws is written down as a run that
 *   threw. A command the guard refused is not a failure of the harness — it is
 *   the measurement.
 * - **The sandbox is post 6's workspace**, materialised fresh per run in scratch
 *   space and deleted afterwards. `createShell` refuses any other kind of root.
 */
export const RUNS_PER_CELL = 10
export const CONDITIONS: readonly Roster[] = ['four', 'four-shell']

const TRACE_DIR = join('agent', 'traces', 'shell')
const DEFAULT_OUT = join('agent', 'traces', 'shell.tsv')
const COMMIT = 'v8-shell'

/** Runs at once. Independent sandboxes, so this moves the wall clock and nothing else. */
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

/** Every command line the model wrote, in order, whether or not the guard ran it. */
function commandsIn(steps: { toolCalls: { name: string; args: unknown }[] }[]): string[] {
  return steps.flatMap((step) =>
    step.toolCalls
      .filter((call) => call.name === 'run_command')
      .map((call) => {
        const args = call.args
        const command =
          typeof args === 'object' && args !== null && 'command' in args
            ? (args as { command: unknown }).command
            : undefined
        return typeof command === 'string' ? command : String(command)
      }),
  )
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
    }) as { outcome: string; tokens: number[] }

    const file = join(
      traceDir,
      `${cell.roster}__${cell.task.id}__${String(cell.run).padStart(2, '0')}.json`,
    )
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
      commands: commandsIn(result.steps).join(' | '),
      steps: result.steps.length,
      stoppedBy: result.stoppedBy,
      escapes: result.escapes.length,
      refusals: result.refusals.length,
      refusalRules: result.refusals.map((refusal) => refusal.rule).join(' '),
      pass: verdict.pass,
      why: verdict.why,
      changed: changed(after).join(' '),
      answerGrade: raw.outcome,
      // Written by the runner rather than added afterwards. Post 6 derived this
      // column from the recorded traces once the runs were over, and said so as
      // a concern: it is the column carrying that post's one positive finding
      // and it did not exist when the instrument was frozen. It exists now.
      contextTokens: raw.tokens[0] ?? 0,
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
      commands: '',
      steps: 0,
      stoppedBy: 'threw',
      escapes: 0,
      refusals: 0,
      refusalRules: '',
      pass: false,
      why: `harness error: ${error instanceof Error ? error.name : 'unknown'}`,
      changed: '',
      answerGrade: 'failure',
      contextTokens: 0,
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
    `[shell] ${cells.length} run(s): ${tasks.length} task(s) x ${conditions.length} condition(s) x ${runs}`,
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
          `${row.pass ? 'pass' : 'FAIL'} (${row.why}) — ${row.refusals} refused — ${row.tools || 'no tool'}`,
      )
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cells.length) }, () => worker()),
  )

  console.error(`[shell] wrote ${out}`)
}

/*
 * Only run when this file is the process entry point. A module that does its
 * work at import time does that work for anything that imports it for a
 * constant, and `tools/shell/tally.test.ts` imports two out of this one.
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
