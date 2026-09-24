import { COLUMNS, parseTally, type ParsedRow } from './row.ts'
import { detectionFloor, fisherExact } from '../shell/tally.ts'

/**
 * Every number post 9 prints, computed from the committed tally and nothing
 * else.
 *
 * Written before the hundred and fifty runs were made. `detectionFloor` and
 * `fisherExact` are **imported** from post 8's tally rather than copied, so
 * the three posts that print a p-value print it from one implementation —
 * post 8's own rule about importing post 6's tasks, applied to the statistics.
 */
export type Cut = {
  runs: number
  passes: number
  /** Runs that changed a file they were not asked to change. */
  stray: number
  /** Runs where the sandbox path guard refused a path. */
  escaped: number
  /** Runs that were stopped and asked at least once. */
  gated: number
  /** Questions asked, across the runs. */
  approvals: number
  /** Runs asked more than once — the gate saying no and the model asking again. */
  reasked: number
  /** Runs whose final answer contains one of `REFUSAL_WORDS`. */
  mentioned: number
  /** Runs that called no tool at all. */
  idle: number
  /** Runs stopped by the step cap rather than by the model. */
  capped: number
  steps: number
  inputTokens: number
  outputTokens: number
}

const EMPTY: Cut = {
  runs: 0,
  passes: 0,
  stray: 0,
  escaped: 0,
  gated: 0,
  approvals: 0,
  reasked: 0,
  mentioned: 0,
  idle: 0,
  capped: 0,
  steps: 0,
  inputTokens: 0,
  outputTokens: 0,
}

export function readTally(text: string): ParsedRow[] {
  return parseTally(text)
}

/** A run whose `why` names a file it was not asked to touch. */
export function isStray(row: ParsedRow): boolean {
  return row.why.startsWith('also changed')
}

/** What each gate in this run answered, in order. */
export function decisionsOf(row: ParsedRow): string[] {
  return row.decisions === 'none' ? [] : row.decisions.split(' ')
}

/** Which tool each gate in this run was about, in order. */
export function gatedToolsOf(row: ParsedRow): string[] {
  return row.gated_tools === 'none' ? [] : row.gated_tools.split(' ')
}

export function cut(rows: readonly ParsedRow[]): Cut {
  return rows.reduce<Cut>(
    (acc, row) => ({
      runs: acc.runs + 1,
      passes: acc.passes + (row.pass === 'pass' ? 1 : 0),
      stray: acc.stray + (isStray(row) ? 1 : 0),
      escaped: acc.escaped + (Number(row.escapes) > 0 ? 1 : 0),
      gated: acc.gated + (Number(row.approvals) > 0 ? 1 : 0),
      approvals: acc.approvals + Number(row.approvals),
      reasked: acc.reasked + (Number(row.approvals) > 1 ? 1 : 0),
      mentioned: acc.mentioned + (row.mentions_denial === 'yes' ? 1 : 0),
      idle: acc.idle + (row.tools_called === 'none' ? 1 : 0),
      capped: acc.capped + (row.stopped_by === 'step-cap' ? 1 : 0),
      steps: acc.steps + Number(row.steps),
      inputTokens: acc.inputTokens + Number(row.input_tokens),
      outputTokens: acc.outputTokens + Number(row.output_tokens),
    }),
    { ...EMPTY },
  )
}

export function by(
  rows: readonly ParsedRow[],
  key: (typeof COLUMNS)[number],
): Map<string, ParsedRow[]> {
  const out = new Map<string, ParsedRow[]>()
  for (const row of rows) {
    const value = row[key]
    const bucket = out.get(value) ?? []
    bucket.push(row)
    out.set(value, bucket)
  }
  return out
}

export function rowsWhere(
  rows: readonly ParsedRow[],
  where: Partial<Record<(typeof COLUMNS)[number], string>>,
): ParsedRow[] {
  return rows.filter((row) =>
    Object.entries(where).every(
      ([key, value]) => row[key as (typeof COLUMNS)[number]] === value,
    ),
  )
}

/** How often each tool was called, across a set of runs. */
export function toolCounts(rows: readonly ParsedRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (row.tools_called === 'none') continue
    for (const name of row.tools_called.split(' ')) {
      out.set(name, (out.get(name) ?? 0) + 1)
    }
  }
  return out
}

/** How many questions each tool accounts for, across a set of runs. */
export function gateCounts(rows: readonly ParsedRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    for (const tool of gatedToolsOf(row)) {
      out.set(tool, (out.get(tool) ?? 0) + 1)
    }
  }
  return out
}

/**
 * The same comparison, held to one task at a time.
 *
 * Post 5's best line was correct arithmetic that fell apart once the mix of
 * labels was controlled for; post 7's thesis only survived once `max_parallel`
 * was; post 8's whole effect lived in the runs where the guard refused
 * something and was invisible until they were split out. The mix here is
 * whether the gate ever fired: one of the five tasks is pure read, so a third
 * of the `deny` column is made of runs that were never denied anything, and an
 * overall number that averaged them together would understate the effect on
 * the runs that were.
 */
export function perTask(rows: readonly ParsedRow[], condition: string): Map<string, Cut> {
  const out = new Map<string, Cut>()
  for (const [task, taskRows] of by(rowsWhere(rows, { condition }), 'task')) {
    out.set(task, cut(taskRows))
  }
  return out
}

/** The mean size of the context the model was handed before it did anything. */
export function meanContext(rows: readonly ParsedRow[]): number {
  const present = rows
    .map((row) => Number(row.context_tokens))
    .filter((value) => value > 0)
  if (present.length === 0) return 0
  return present.reduce((a, b) => a + b, 0) / present.length
}

/**
 * US cents for a set of runs, at a rate the caller supplies.
 *
 * Post 8's function over post 9's rows: it takes rows and reads
 * `input_tokens` and `output_tokens`, which this tally spells the same way.
 * The rate stays an argument for post 8's reason — it is the one number on the
 * page guaranteed to be wrong by the time anyone reads it.
 */
export function cents(
  rows: readonly ParsedRow[],
  perMillionInput = 0.25,
  perMillionOutput = 2,
): number {
  const totals = cut(rows)
  return (
    (totals.inputTokens / 1_000_000) * perMillionInput * 100 +
    (totals.outputTokens / 1_000_000) * perMillionOutput * 100
  )
}

export { detectionFloor, fisherExact }
