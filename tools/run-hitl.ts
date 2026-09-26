import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runOnce, type RunOptions } from '../agent/src/run.ts'
import { toRawTrace } from '../agent/src/recorder.ts'
import { ALWAYS_ALLOW, ALWAYS_DENY, GATED } from '../agent/src/approval.ts'
import { changed, TASKS, type Task } from './roster/tasks.ts'
import { materialise, snapshot, dispose } from './roster/sandbox.ts'
import { HEADER, mentionsDenial, toLine, type Row } from './hitl/row.ts'
import { completesTask, decidingArgument } from './hitl/gated.ts'

/**
 * The experiment: the same five tasks, the same model, the same tools, many
 * runs, and one thing changing — whether there is a gate in front of the tools
 * that change something, and what it answers.
 *
 *   npm run hitl                         # the whole thing
 *   npm run hitl -- --runs 1             # a pilot
 *   npm run hitl -- --task write-note --conditions deny
 *
 * Fixed in this file before the first call was made:
 *
 * - **Post 6's five tasks, imported rather than copied**, so post 6, post 8 and
 *   this post grade the same work with the same code. Four of the five end in
 *   a write, so the gate fires in four of them; `find-timeout` is pure read, so
 *   it never fires at all. That task is not padding — it is the row that
 *   measures what a gate costs a run it never stops.
 * - **Three conditions.** `none` is the agent every earlier commit shipped, with
 *   no gate. `allow` has the gate and answers yes to everything. `deny` has the
 *   gate and answers no to everything.
 * - **`none` against `allow` is a calibration, not a hypothesis.** The SDK
 *   strips approval requests and responses on their way to the provider, so
 *   the two conditions send byte-identical requests — proved offline in
 *   `tools/hitl/fork.test.ts` rather than argued here. Any difference between
 *   those two columns is this experiment's own noise, measured rather than
 *   assumed, and it is the yardstick the `deny` column is read against.
 * - **`deny` loses four of the five tasks by construction**, and that is said
 *   here rather than discovered in the results. Post 8's rule is that a
 *   condition which loses by construction measures its own construction, so
 *   the pass column is not what `deny` is in the table for. What it is for is
 *   the four columns post 8 did not have: how many times the agent asked
 *   again after being told no, what it did instead, whether it said so, and
 *   what the argument cost in steps and tokens.
 * - **Ten runs per cell**, post 6's and post 8's number, kept so the three
 *   posts can be read against each other. Five tasks by three conditions by ten
 *   runs is a hundred and fifty runs. Ten runs with no failures put the 95%
 *   upper bound on a cell's failure rate at 25.9%, and fifty with none put it
 *   at 5.8%; that is the resolution this is bought at, and it is written down
 *   here rather than discovered afterwards.
 * - **The conditions are interleaved.** Every task under all three conditions
 *   runs once before any runs twice.
 * - **Nothing is retried.** A run that throws is written down as a run that
 *   threw. A denied call is not a failure of the harness — it is the
 *   measurement.
 */
export const RUNS_PER_CELL = 10
export const CONDITIONS = ['none', 'allow', 'deny'] as const
export type Condition = (typeof CONDITIONS)[number]

const TRACE_DIR = join('agent', 'traces', 'hitl')
const DEFAULT_OUT = join('agent', 'traces', 'hitl.tsv')
const COMMIT = 'v9-hitl'

/** Runs at once. Independent sandboxes, so this moves the wall clock and nothing else. */
const CONCURRENCY = 4

type Cell = { condition: Condition; task: Task; run: number }

/**
 * The gate each condition puts in front of the four tools.
 *
 * `none` returns no `approval` option at all rather than a gate that answers
 * yes, because "no gate" has to mean the program commits 1 to 8 shipped and
 * not a new code path that behaves like it.
 */
export function gateFor(condition: Condition): Pick<RunOptions, 'approval'> {
  switch (condition) {
    case 'none':
      return {}
    case 'allow':
      return { approval: { gate: GATED, decide: ALWAYS_ALLOW } }
    case 'deny':
      return { approval: { gate: GATED, decide: ALWAYS_DENY } }
  }
}

function plan(
  runs: number,
  tasks: readonly Task[],
  conditions: readonly Condition[],
): Cell[] {
  const cells: Cell[] = []
  for (let run = 1; run <= runs; run += 1) {
    for (const task of tasks) {
      for (const condition of conditions) cells.push({ condition, task, run })
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
      roster: 'four',
      style: 'precise',
      ...gateFor(cell.condition),
    })

    const after = snapshot(root)
    const answer = [...result.steps].reverse().find((s) => s.text.trim() !== '')?.text ?? ''
    const verdict = cell.task.check({ after, answer })

    const raw = toRawTrace({
      id: `${cell.condition}-${cell.task.id}-${cell.run}`,
      commit: COMMIT,
      model: result.model,
      task: cell.task.prompt,
      userMessage: cell.task.prompt,
      steps: result.steps,
      expected: [...cell.task.expect],
    }) as { outcome: string; tokens: number[] }

    const file = join(
      traceDir,
      `${cell.condition}__${cell.task.id}__${String(cell.run).padStart(2, '0')}.json`,
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
      condition: cell.condition,
      task: cell.task.id,
      run: cell.run,
      tools: result.steps.flatMap((s) => s.toolCalls.map((c) => c.name)).join(' '),
      steps: result.steps.length,
      stoppedBy: result.stoppedBy,
      escapes: result.escapes.length,
      approvals: result.approvals.length,
      decisions: result.approvals.map((a) => a.decision).join(' '),
      gatedTools: result.approvals.map((a) => a.tool).join(' '),
      // What the tool name leaves out, written down at the moment the question
      // was asked rather than recovered afterwards. The first hundred and
      // fifty runs had to be backfilled from their traces by
      // `tools/retally-hitl.ts`, because this row shipped without these two
      // columns and a denied call leaves no other mark anywhere.
      gatedPaths: result.approvals
        .map((a) => decidingArgument(a.tool, a.args))
        .join(' '),
      gatedCompletes: result.approvals
        .map((a) => (completesTask(cell.task, a.tool, a.args) ? 'yes' : 'no'))
        .join(' '),
      mentionsDenial: mentionsDenial(answer),
      pass: verdict.pass,
      why: verdict.why,
      changed: changed(after).join(' '),
      answerGrade: raw.outcome,
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
      condition: cell.condition,
      task: cell.task.id,
      run: cell.run,
      tools: '',
      steps: 0,
      stoppedBy: 'threw',
      escapes: 0,
      approvals: 0,
      decisions: '',
      gatedTools: '',
      gatedPaths: '',
      gatedCompletes: '',
      mentionsDenial: false,
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
  const conditions =
    (flag('conditions')?.split(',') as Condition[] | undefined) ?? CONDITIONS
  const out = flag('out') ?? DEFAULT_OUT
  const traceDir = flag('traces') ?? TRACE_DIR

  const tasks = only === undefined ? TASKS : TASKS.filter((task) => task.id === only)
  if (tasks.length === 0) throw new Error(`no task "${only}"`)

  const cells = plan(runs, tasks, conditions)
  mkdirSync(dirname(out), { recursive: true })
  if (!existsSync(out)) appendFileSync(out, `${HEADER}\n`, 'utf8')

  console.error(
    `[hitl] ${cells.length} run(s): ${tasks.length} task(s) x ${conditions.length} condition(s) x ${runs}`,
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
        `[${done}/${cells.length}] ${row.condition} ${row.task} #${row.run} — ` +
          `${row.pass ? 'pass' : 'FAIL'} (${row.why}) — ${row.approvals} gate(s) — ${row.tools || 'no tool'}`,
      )
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cells.length) }, () => worker()),
  )

  console.error(`[hitl] wrote ${out}`)
}

/*
 * Only run when this file is the process entry point. A module that does its
 * work at import time does that work for anything that imports it for a
 * constant, and `tools/hitl/tally.test.ts` imports two out of this one.
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
