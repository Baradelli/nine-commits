import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runOnce } from './run.ts'
import { toRawTrace } from './recorder.ts'

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()
  const traceId = process.env.TRACE_ID ?? 'run'
  const commit = process.env.TRACE_COMMIT ?? 'v1-not-an-agent'

  if (task === '') {
    console.error('usage: npm start --workspace @nine-commits/agent -- "<task>"')
    process.exit(1)
  }

  const result = await runOnce(task)
  console.log(result.text)

  const raw = toRawTrace({
    id: traceId,
    commit,
    model: result.model,
    task,
    userMessage: task,
    assistantText: result.text,
    totalTokens: result.totalTokens,
  })

  mkdirSync('traces', { recursive: true })
  const out = join('traces', `${traceId}.json`)
  writeFileSync(out, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  console.error(`\n[recorded ${out}]`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
