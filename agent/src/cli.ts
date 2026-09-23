import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runOnce } from './run.ts'
import { toRawTrace } from './recorder.ts'
import { UnsafeRoot } from './tools/sandbox.ts'

const TRACE_DIR = 'traces'

/**
 * One row per run, appended next to the traces.
 *
 * Post 2's table was typed out of a terminal by hand, which is a weaker
 * artifact than the claim it supports deserved. A repeated experiment writes
 * its own log from here on, and it lives in `agent/traces/` — gitignored, and
 * outside what the agent's own tools can see, so a tally can never become part
 * of the corpus the next run searches.
 */
const RUNS_FILE = join(TRACE_DIR, 'runs.tsv')

/**
 * v3 adds `steps` and `stopped_by`. Once the agent can go round again, how
 * many times it went round and what made it stop are the two facts a row most
 * needs to carry — a run that ran out of steps and a run that finished are
 * otherwise indistinguishable in the tally.
 *
 * The header is written only when the file does not exist, so a runs file
 * started under the v2 columns has to be moved aside rather than appended to.
 */
const RUNS_HEADER =
  'when\troster\tdescriptions\ttools_called\tsteps\tstopped_by\toutcome\ttrace_id\ttask\n'

/**
 * Facts the final answer must contain for the run to count as having answered
 * the question, given as `TRACE_EXPECT="a,b"`.
 *
 * Read and checked BEFORE the model is called. The recorder refuses to grade a
 * run with no expectations, and discovering that after the request has been
 * paid for throws away a real run for a typo.
 */
function expectations(): string[] {
  const facts = (process.env.TRACE_EXPECT ?? '')
    .split(',')
    .map((fact) => fact.trim())
    .filter((fact) => fact !== '')

  if (facts.length === 0) {
    console.error(
      'TRACE_EXPECT is required: a comma-separated list of facts the answer ' +
        'must contain, e.g. TRACE_EXPECT="agent/src/config.ts,gpt-5-mini". ' +
        'A trace has to say whether the run worked.',
    )
    process.exit(1)
  }

  return facts
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()
  const traceId = process.env.TRACE_ID ?? 'run'
  const commit = process.env.TRACE_COMMIT ?? 'v6-four-operations'
  // A root other than the repository is how a single run is pointed at a
  // scratch directory. Write tools refuse any root that is not scratch space,
  // so this cannot be used to aim the agent at something that matters.
  const root = process.env.AGENT_ROOT

  if (task === '') {
    console.error(
      'usage: AGENT_ROOT=<scratch dir> npm start --workspace @nine-commits/agent -- "<task>"',
    )
    process.exit(1)
  }

  // v6's default roster can write, and a writable root must be scratch space
  // outside this repository — so with no AGENT_ROOT there is nowhere legal for
  // the agent to work and `buildTools` raises. Failing closed is right; failing
  // closed with a stack trace, on the command the README prints, is not. Said
  // here, before the model is called and before anything is paid for.
  if (root === undefined) {
    console.error(
      'AGENT_ROOT is required at v6: an absolute path to a scratch directory ' +
        'under the system temporary directory, which is the only place the write ' +
        'tools are allowed to touch. It may not be inside this repository.\n' +
        'For a read-only run of the v2-to-v5 tools, use AGENT_TOOLS=five-search ' +
        'against a scratch copy, or run the experiment with `npm run roster`, ' +
        'which makes and removes its own sandbox per run.',
    )
    process.exit(1)
  }

  const expected = expectations()

  const result = await runOnce(task, { root })
  console.log(result.steps.at(-1)?.text ?? '')

  const raw = toRawTrace({
    id: traceId,
    commit,
    model: result.model,
    task,
    userMessage: task,
    steps: result.steps,
    expected,
  })

  mkdirSync(TRACE_DIR, { recursive: true })
  const out = join(TRACE_DIR, `${traceId}.json`)
  writeFileSync(out, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

  const called = result.steps
    .flatMap((step) => step.toolCalls.map((call) => call.name))
    .join(', ')
  const outcome = (raw as { outcome: string }).outcome

  if (!existsSync(RUNS_FILE)) appendFileSync(RUNS_FILE, RUNS_HEADER, 'utf8')
  appendFileSync(
    RUNS_FILE,
    [
      new Date().toISOString(),
      result.roster,
      result.style,
      called === '' ? 'none' : called,
      String(result.steps.length),
      result.stoppedBy,
      outcome,
      traceId,
      task.replace(/\s+/g, ' '),
    ].join('\t') + '\n',
    'utf8',
  )

  console.error(
    `\n[${result.roster} roster, ${result.style} descriptions — ` +
      `called ${called === '' ? 'no tool' : called} — ` +
      `${result.steps.length} steps, stopped by ${result.stoppedBy} — ${outcome}` +
      `${result.escapes.length > 0 ? ` — ${result.escapes.length} path(s) refused` : ''}]`,
  )
  console.error(`[recorded ${out}, logged ${RUNS_FILE}]`)
}

main().catch((error: unknown) => {
  // A refused root is a configuration mistake, not a crash, and the likeliest
  // one is a typo in AGENT_ROOT. Printing the whole Error object for that
  // shows a stack through `buildTools` and buries the one sentence that says
  // what to do. Everything else still prints in full.
  if (error instanceof UnsafeRoot) {
    console.error(`AGENT_ROOT was refused: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
