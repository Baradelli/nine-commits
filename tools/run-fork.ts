import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toRawTrace } from '../agent/src/recorder.ts'
import { taskById } from './roster/tasks.ts'
import { materialise, snapshot, dispose } from './roster/sandbox.ts'
import { forkAtGate } from './hitl/fork.ts'

/**
 * Records the two branches the post publishes.
 *
 *   npm run fork                       # the default task
 *   npm run fork -- --task edit-timeout
 *
 * One run is made until it asks, and then continued twice from the same
 * conversation. The two raw traces it writes share every frame up to the
 * approval, because those frames come from one recording; `tools/hitl/
 * fork.test.ts` asserts that property against this same code path, offline.
 *
 * The raw output goes to `agent/traces/` and is gitignored. What ships is
 * whatever `npm run record` makes of it, which is where redaction happens.
 */
const DEFAULT_TASK = 'write-note'
const TRACE_DIR = join('agent', 'traces', 'fork')
const COMMIT = 'v9-hitl'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

async function main(): Promise<void> {
  const task = taskById(flag('task') ?? DEFAULT_TASK)
  const traceDir = flag('traces') ?? TRACE_DIR

  const fork = await forkAtGate({
    task: task.prompt,
    roster: 'four',
    materialise,
    snapshot,
    dispose,
  })

  console.error(
    `[fork] suspended after ${fork.suspended.steps.length} step(s), asking about ` +
      `${fork.question.tool}`,
  )

  /*
   * What the pair cost, measured rather than estimated from the experiment's
   * per-run rate. Three steps of prefix and two continuations is not the same
   * shape as a run in `runs.tsv`, and a price quoted for a published artifact
   * should come off that artifact.
   */
  const usage = (steps: readonly { inputTokens: number; totalTokens: number }[]) => ({
    input: steps.reduce((sum, step) => sum + step.inputTokens, 0),
    output: steps.reduce(
      (sum, step) => sum + Math.max(0, step.totalTokens - step.inputTokens),
      0,
    ),
  })
  const bill = [fork.suspended, ...fork.branches.map((branch) => branch.after)]
    .map((result) => usage(result.steps))
    .reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output }), {
      input: 0,
      output: 0,
    })
  console.error(
    `[fork] ${bill.input} input + ${bill.output} output tokens = ` +
      `${((bill.input / 1e6) * 25 + (bill.output / 1e6) * 200).toFixed(2)} US cents ` +
      'at $0.25/$2 per million',
  )

  mkdirSync(traceDir, { recursive: true })

  for (const branch of fork.branches) {
    const after = snapshot(branch.root)
    const verdict = task.check({
      after,
      answer:
        [...branch.after.steps].reverse().find((s) => s.text.trim() !== '')?.text ?? '',
    })

    const raw = toRawTrace({
      id: `${task.id}-${branch.decision}`,
      commit: COMMIT,
      model: branch.after.model,
      task: task.prompt,
      userMessage: task.prompt,
      steps: branch.steps,
      expected: [...task.expect],
    }) as { outcome: string; frames: unknown[] }

    const file = join(traceDir, `${task.id}__${branch.decision}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

    console.error(
      `[fork] ${branch.decision}: ${raw.frames.length} frames, outcome ${raw.outcome}, ` +
        `task ${verdict.pass ? 'pass' : 'FAIL'} (${verdict.why}) — wrote ${file}`,
    )
    dispose(branch.root)
  }
}

/*
 * Only run when this file is the process entry point. A module that does its
 * work at import time does that work for anything that imports it for a
 * constant — and importing this one would start two billed runs.
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
