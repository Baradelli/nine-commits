import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseTally, COLUMNS } from './row.ts'

/**
 * Adds the one column the runner could not write, and writes the tally that
 * ships beside the post.
 *
 *   npx tsx tools/roster/finalise.ts agent/traces/roster.tsv agent/traces/roster <out.tsv>
 *
 * `context_tokens` is the size of the context the model was handed on its
 * first step: the system instruction, the tool definitions, and the task. It
 * is the only figure that prices the fifth tool directly — a tool definition
 * is part of every request for the whole life of a run, so an extra tool is a
 * bill before it is a behaviour. Post 2 measured the same thing for two
 * sentences of description and it was the most durable number in that post.
 *
 * It comes out of the recorded traces rather than out of the runner because
 * it was not in the first version of the row, and the runner's output is not
 * edited after a run: the traces are the primary record, the tally is derived
 * from them, and this is the derivation. Nothing else in the row is touched.
 */
export function finalise(tallyText: string, tokensFor: (id: string) => number | undefined): string {
  const rows = parseTally(tallyText)
  const header = [...COLUMNS.slice(0, -1), 'context_tokens', 'answer'].join('\t')

  const lines = rows.map((row) => {
    const id = `${row.roster}__${row.task}__${row.run.padStart(2, '0')}`
    const tokens = tokensFor(id)
    const cells = COLUMNS.map((name) => row[name])
    // Keep `answer` last: it is the only free-text cell, and a reader
    // scanning the file should not have to step over it to reach a number.
    const answer = cells.pop() ?? ''
    return [...cells, String(tokens ?? 0), answer].join('\t')
  })

  return [header, ...lines].join('\n') + '\n'
}

function main(): void {
  const [tally, traceDir, out] = process.argv.slice(2)
  if (tally === undefined || traceDir === undefined || out === undefined) {
    console.error('usage: finalise <tally.tsv> <trace-dir> <out.tsv>')
    process.exit(1)
  }

  const written = finalise(readFileSync(tally, 'utf8'), (id) => {
    const path = join(traceDir, `${id}.json`)
    if (!existsSync(path)) return undefined
    const trace = JSON.parse(readFileSync(path, 'utf8')) as { tokens: number[] }
    return trace.tokens[0]
  })

  writeFileSync(out, written, 'utf8')
  console.log(`wrote ${out}`)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
