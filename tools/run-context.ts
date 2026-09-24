import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runOnce } from '../agent/src/run.ts'
import { toRawTrace } from '../agent/src/recorder.ts'
import { snapshot, dispose } from './roster/sandbox.ts'
import { check, EXPECT, FACTS, PROMPT } from './context/task.ts'
import { HEADER, toLine, type Row } from './context/row.ts'

/**
 * The experiment: the same task, the same model, the same tools, many runs,
 * and one thing changing — whether the program is allowed to rewrite the
 * conversation when it gets too big.
 *
 *   npm run context                       # the whole thing
 *   npm run context -- --runs 1           # a pilot
 *   npm run context -- --conditions on --cache use
 *
 * Fixed in this file before the first call was made:
 *
 * - **Fifty runs per condition.** Post 6's number, kept so the two posts can be
 *   read against each other. Post 2's phrase is that one run per condition is a
 *   coin flipped once, and post 6's is that a result stated without its
 *   detection floor is a stronger claim than the runs support: fifty runs with
 *   no failures put the 95% upper bound on a rate at 5.8%, and that is the
 *   resolution this experiment is bought at.
 * - **The ceiling is 16,000 tokens and it is the program's, not the
 *   provider's.** The provider's is 266,684, measured by
 *   `tools/window-probe.ts`. Running this experiment against the real wall
 *   means about forty-five page fetches per run and roughly a dollar a run in
 *   re-billed context, which is a price this series has not paid for anything
 *   yet. So the ceiling is lowered and that is said out loud, here and in the
 *   post, rather than a number appearing with no owner.
 * - **The conditions are interleaved.** Every condition runs once before
 *   either runs twice, so a provider drifting over an hour drifts across both.
 * - **Nothing is retried.** A run that throws is written down as a run that
 *   threw. A run that overflows is not a failure of the harness — it is the
 *   measurement.
 * - **The cache is the corpus.** `npm run warm` fetches every page the task
 *   needs before the first run, and each run writes any search it invents into
 *   the same cache, so the fiftieth run reads the bytes the first one fetched.
 *   Wikipedia sees a few dozen requests for a fifty-run experiment instead of
 *   several hundred, and the runs are measured against one corpus rather than
 *   against fifty samples of a moving encyclopaedia. Every row records how many
 *   requests actually left the machine, and a re-run of the whole thing makes
 *   none at all. That makes a re-run a different experiment from the first
 *   pass, and the post says so rather than presenting the cache as free.
 */
export const RUNS_PER_CONDITION = 50
export const CONDITIONS = ['off', 'on'] as const
export type Condition = (typeof CONDITIONS)[number]

/**
 * The context ceiling for the experiment.
 *
 * Lower than the provider's by a factor of about seventeen, on purpose and
 * disclosed. What it preserves is the ratio that matters: a task needing three
 * page reads against a budget that holds about two and a half is the same
 * shape as a task needing forty-five against a budget that holds forty.
 */
export const CONTEXT_LIMIT = 16_000

/**
 * More turns than post 6 allowed, because the task is longer.
 *
 * Three searches, three fetches and a write is seven calls before the model
 * has said anything, and v6's cap of ten leaves almost no room for a retry. A
 * cap that fires on the control and not on the condition would be the harness
 * choosing the result.
 */
export const MAX_STEPS = 16

const TRACE_DIR = join('agent', 'traces', 'context')
const DEFAULT_OUT = join('agent', 'traces', 'context.tsv')
const COMMIT = 'v7-context'

/** One at a time. The provider is fine with more; Wikipedia's cache is not the point. */
const CONCURRENCY = 4

type Cell = { condition: Condition; run: number }

function plan(runs: number, conditions: readonly Condition[]): Cell[] {
  const cells: Cell[] = []
  for (let run = 1; run <= runs; run += 1) {
    for (const condition of conditions) cells.push({ condition, run })
  }
  return cells
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

/**
 * An empty sandbox.
 *
 * Post 6's workspace was eight files of an invented project, because the task
 * was to change one of them. Here the corpus is the web and the only thing the
 * agent should produce locally is its note — so anything else in the directory
 * afterwards is a stray write, and an empty tree is the only `before` that
 * makes that check exact.
 */
function materialise(): string {
  return mkdtempSync(join(tmpdir(), 'nine-context-'))
}

async function runCell(
  cell: Cell,
  traceDir: string,
  cache: 'use' | 'only' | 'off',
): Promise<Row> {
  const root = materialise()
  const when = new Date().toISOString()

  try {
    const result = await runOnce(PROMPT, {
      root,
      roster: 'web',
      style: 'precise',
      compaction: cell.condition === 'on',
      contextLimit: CONTEXT_LIMIT,
      maxSteps: MAX_STEPS,
      web: { cache },
    })

    const after = snapshot(root)
    const answer = [...result.steps].reverse().find((s) => s.text.trim() !== '')?.text ?? ''
    const verdict = check(after)

    const raw = toRawTrace({
      id: `${cell.condition}-${cell.run}`,
      commit: COMMIT,
      model: result.model,
      task: PROMPT,
      userMessage: PROMPT,
      steps: result.steps,
      expected: [...EXPECT],
      ...(result.trailingCompaction === undefined
        ? {}
        : { trailingCompaction: result.trailingCompaction }),
    }) as { outcome: string }

    const file = join(
      traceDir,
      `${cell.condition}__${String(cell.run).padStart(2, '0')}.json`,
    )
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

    const inputTokens = result.steps.reduce((sum, step) => sum + step.inputTokens, 0)
    const outputTokens = result.steps.reduce(
      (sum, step) => sum + Math.max(0, step.totalTokens - step.inputTokens),
      0,
    )
    const peakContext = result.steps.reduce(
      (peak, step) => Math.max(peak, step.inputTokens),
      0,
    )

    // How far the estimator that makes the compaction decision was from the
    // bill. Measured per step and averaged, over the steps the provider
    // actually counted.
    const errors = result.steps
      .filter((step) => step.estimatedInputTokens !== undefined && step.inputTokens > 0)
      .map(
        (step) =>
          (((step.estimatedInputTokens ?? 0) - step.inputTokens) / step.inputTokens) *
          100,
      )
    const estimateError =
      errors.length === 0 ? 0 : errors.reduce((a, b) => a + b, 0) / errors.length

    // What compaction cost, measured against the messages it removed rather
    // than against the finished trace. The trace keeps every frame, including
    // the ones the model was made to forget, so a reader of the trace cannot
    // tell the difference and neither could a grader that only read it.
    const dropped = new Set<string>()
    const kept = new Set<string>()
    const events = [
      ...result.steps.map((step) => step.compaction),
      result.trailingCompaction,
    ]
    for (const event of events) {
      if (event === undefined) continue
      for (const fact of FACTS) {
        if (!fact.pattern.test(event.droppedText)) continue
        dropped.add(fact.id)
        if (fact.pattern.test(event.summary)) kept.add(fact.id)
      }
    }
    const lost = [...dropped].filter((id) => !kept.has(id))

    return {
      when,
      condition: cell.condition,
      run: cell.run,
      tools: result.steps.flatMap((s) => s.toolCalls.map((c) => c.name)).join(' '),
      steps: result.steps.length,
      stoppedBy: result.stoppedBy,
      compactions: result.compactions,
      maxParallel: result.steps.reduce(
        (most, step) => Math.max(most, step.toolCalls.length),
        0,
      ),
      pass: verdict.pass,
      why: verdict.why,
      facts: verdict.facts.join(' '),
      loose: verdict.loose.join(' '),
      factsDropped: [...dropped].sort().join(' '),
      factsKept: [...kept].sort().join(' '),
      factsLost: lost.sort().join(' '),
      answerGrade: raw.outcome,
      peakContext,
      inputTokens,
      outputTokens,
      summaryInputTokens: result.summariserInputTokens,
      summaryOutputTokens: result.summariserOutputTokens,
      estimateError,
      liveFetches: result.fetched.length,
      answer,
    }
  } catch (error: unknown) {
    // A run that threw is a row, not a gap. The alternative is a tally with
    // holes in it and no way to tell a hole from a run that was never made.
    return {
      when,
      condition: cell.condition,
      run: cell.run,
      tools: '',
      steps: 0,
      stoppedBy: 'threw',
      compactions: 0,
      maxParallel: 0,
      pass: false,
      why: `harness error: ${error instanceof Error ? error.name : 'unknown'}`,
      facts: '',
      loose: '',
      factsDropped: '',
      factsKept: '',
      factsLost: '',
      answerGrade: 'failure',
      peakContext: 0,
      inputTokens: 0,
      outputTokens: 0,
      summaryInputTokens: 0,
      summaryOutputTokens: 0,
      estimateError: 0,
      liveFetches: 0,
      answer: '',
    }
  } finally {
    dispose(root)
  }
}

async function main(): Promise<void> {
  const runs = Number(flag('runs') ?? RUNS_PER_CONDITION)
  const conditions =
    (flag('conditions')?.split(',') as Condition[] | undefined) ?? [...CONDITIONS]
  const out = flag('out') ?? DEFAULT_OUT
  const traceDir = flag('traces') ?? TRACE_DIR
  const cache = (flag('cache') as 'use' | 'only' | 'off' | undefined) ?? 'use'

  const cells = plan(runs, conditions)
  mkdirSync(dirname(out), { recursive: true })
  if (!existsSync(out)) appendFileSync(out, `${HEADER}\n`, 'utf8')

  console.error(
    `[context] ${cells.length} run(s): ${conditions.length} condition(s) x ${runs}, ` +
      `ceiling ${CONTEXT_LIMIT} tokens, cache "${cache}"`,
  )

  let next = 0
  let done = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      const cell = cells[index]
      if (cell === undefined) return

      const row = await runCell(cell, traceDir, cache)
      appendFileSync(out, `${toLine(row)}\n`, 'utf8')
      done += 1
      console.error(
        `[${done}/${cells.length}] compaction ${row.condition} #${row.run} — ` +
          `${row.pass ? 'pass' : 'FAIL'} (${row.why}) — ${row.steps} steps, ` +
          `${row.compactions} compaction(s), stopped by ${row.stoppedBy}`,
      )
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cells.length) }, () => worker()),
  )

  console.error(`[context] wrote ${out}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
