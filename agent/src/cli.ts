import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runOnce } from './run.ts'
import { toRawTrace } from './recorder.ts'

/**
 * Facts the final answer must contain for the run to count as having answered
 * the question, given as `TRACE_EXPECT="a,b"`. The recorder refuses a run with
 * none, so a trace can never claim an outcome nobody checked.
 */
function expectations(): string[] {
  return (process.env.TRACE_EXPECT ?? '')
    .split(',')
    .map((fact) => fact.trim())
    .filter((fact) => fact !== '')
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()
  const traceId = process.env.TRACE_ID ?? 'run'
  const commit = process.env.TRACE_COMMIT ?? 'v2-hands'

  if (task === '') {
    console.error('usage: npm start --workspace @nine-commits/agent -- "<task>"')
    process.exit(1)
  }

  const result = await runOnce(task)
  console.log(result.steps.at(-1)?.text ?? '')

  const raw = toRawTrace({
    id: traceId,
    commit,
    model: result.model,
    task,
    userMessage: task,
    steps: result.steps,
    expected: expectations(),
  })

  mkdirSync('traces', { recursive: true })
  const out = join('traces', `${traceId}.json`)
  writeFileSync(out, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

  const called = result.steps
    .flatMap((step) => step.toolCalls.map((call) => call.name))
    .join(', ')

  console.error(
    `\n[${result.style} descriptions — called ${called === '' ? 'no tool' : called}]`,
  )
  console.error(`[recorded ${out}]`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
