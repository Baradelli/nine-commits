import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from './paths.ts'
import { COLUMNS, HEADER, type ParsedRow } from './hitl/row.ts'
import { gatedCalls, taskById, type RawTrace } from './hitl/gated.ts'

/**
 * Puts two columns back into a tally that shipped without them.
 *
 *   npm run hitl:retally
 *
 * Reading only, and it makes no model call: the hundred and fifty runs were
 * paid for once, and every one of them wrote a trace to `agent/traces/hitl/`.
 * Those traces hold the `tool_call` frame under every `approval` frame, which
 * is the argument the gate decided on — so `gated_paths` and
 * `gated_completes` are recoverable from data already on this disk, and the
 * alternative was to assert a claim about a hundred and sixteen calls that a
 * reader could check for one of them.
 *
 * **The trace directory is not committed**, and that is worth being plain
 * about rather than leaving as a surprise to whoever runs this next. It is
 * gitignored for the reason every raw run directory in this repository is:
 * the traces carry provider-side identifiers, and post 7 shipped some of those
 * into a published file once already. So this command works on the machine
 * that made the runs, and on any other machine it says so and changes nothing.
 * What ships is the tally, which is what every other number on post 9's page
 * is read from too.
 *
 * Idempotent: rerunning it against the same traces writes the same bytes.
 */
const TRACE_DIR = join('agent', 'traces', 'hitl')
const TALLY = join(POSTS_DIR, '09-hitl', 'runs.tsv')

/** `deny__add-setting__07.json` — the name the runner wrote. */
const TRACE_NAME = /^(?<condition>[^_]+)__(?<task>.+)__(?<run>\d+)\.json$/

type Key = string
const keyOf = (condition: string, task: string, run: string): Key =>
  `${condition}\u0000${task}\u0000${String(Number(run))}`

export type Backfill = { paths: string; completes: string }

/**
 * Every question in every trace, keyed by the row it belongs to.
 *
 * A trace with no approval frame contributes `none`/`none` rather than being
 * left out, so a row whose trace is missing is distinguishable from a row
 * whose run was never stopped — the same reason the runner writes a row for a
 * run that threw.
 */
export function backfillFrom(dir: string): Map<Key, Backfill> {
  const out = new Map<Key, Backfill>()
  for (const name of readdirSync(dir).sort()) {
    const match = TRACE_NAME.exec(name)
    if (match?.groups === undefined) continue
    const { condition, task, run } = match.groups
    const trace = JSON.parse(readFileSync(join(dir, name), 'utf8')) as RawTrace
    const calls = gatedCalls(trace, taskById(task ?? ''))
    out.set(keyOf(condition ?? '', task ?? '', run ?? ''), {
      paths: calls.map((call) => call.argument).join(' ') || 'none',
      completes: calls.map((call) => (call.completesTask ? 'yes' : 'no')).join(' ') || 'none',
    })
  }
  return out
}

/**
 * The tally read by *its own* header rather than by the current `COLUMNS`.
 *
 * `parseTally` insists that every column the code knows about is in the file,
 * which is the right rule everywhere else and the wrong one here: the file
 * this command exists to fix is the file that does not have the new columns
 * yet. So this one reader is tolerant of their absence, and nothing else is.
 * Every other cell is carried across by name, so a column that moves in
 * `COLUMNS` moves in the output and nowhere else.
 */
function parseByOwnHeader(text: string): ParsedRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')
  const head = lines.shift()
  if (head === undefined) throw new Error('retally: empty tally')
  const names = head.split('\t')
  const missing = COLUMNS.filter(
    (column) => !names.includes(column) && column !== 'gated_paths' && column !== 'gated_completes',
  )
  if (missing.length > 0) throw new Error(`retally: tally has no ${missing.join(', ')} column`)

  return lines.map((line, index) => {
    const cells = line.split('\t')
    if (cells.length !== names.length) {
      throw new Error(
        `retally: row ${index + 1} has ${cells.length} cells, expected ${names.length}`,
      )
    }
    return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])) as ParsedRow
  })
}

/**
 * The tally with the two columns filled in, as text.
 *
 * Every other cell is passed through untouched — this rewrites a file that
 * hundreds of assertions are read from, and the only honest way to do that is
 * for the diff to be the two columns and nothing else. A row whose trace is
 * missing, or whose question count disagrees with the `approvals` the runner
 * wrote at the time, stops the whole thing rather than being written with a
 * hole in it.
 */
export function rewrite(tallyText: string, backfill: Map<Key, Backfill>): string {
  const lines = parseByOwnHeader(tallyText).map((row) => {
    const key = keyOf(row.condition, row.task, row.run)
    const found = backfill.get(key)
    if (found === undefined) throw new Error(`retally: no trace for ${key.replace(/\u0000/g, ' ')}`)
    const asked = found.paths === 'none' ? 0 : found.paths.split(' ').length
    if (asked !== Number(row.approvals)) {
      throw new Error(
        `retally: ${key.replace(/\u0000/g, ' ')} has ${row.approvals} approval(s) in the ` +
          `tally and ${asked} in its trace`,
      )
    }
    const filled: ParsedRow = { ...row, gated_paths: found.paths, gated_completes: found.completes }
    return COLUMNS.map((column) => filled[column]).join('\t')
  })
  return `${[HEADER, ...lines].join('\n')}\n`
}

function main(): void {
  if (!existsSync(TRACE_DIR)) {
    console.error(
      `[retally] ${TRACE_DIR} is not here, so there is nothing to recover from.\n` +
        '[retally] The directory is gitignored; this command only works on the machine\n' +
        '[retally] that made the runs. Nothing was written.',
    )
    return
  }

  const before = readFileSync(TALLY, 'utf8')
  const after = rewrite(before, backfillFrom(TRACE_DIR))
  writeFileSync(TALLY, after, 'utf8')
  console.error(
    `[retally] ${TALLY}: ${after === before ? 'unchanged' : 'gated_paths and gated_completes written'}`,
  )
}

/* Only run when this file is the process entry point. */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
