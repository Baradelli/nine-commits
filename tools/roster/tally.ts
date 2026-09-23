import { COLUMNS, parseTally, type ParsedRow } from './row.ts'

/**
 * Every number this post prints, computed from the committed tally and
 * nothing else.
 *
 * The functions here were written before the hundred and fifty runs were made.
 * That ordering is the only thing that stops a table of results from being a
 * table of whichever cuts of the data came out interesting, and this series has
 * said so in public three times: post 4's suite wrote its expectations down as
 * predictions, post 5 fixed nine calls per case in the source before the first
 * one, and post 3 refused to change the tools after seeing what they found.
 */
export type Cut = {
  runs: number
  passes: number
  /** Runs that changed a file they were not asked to change. */
  stray: number
  /** Runs where the sandbox guard refused a path. */
  escaped: number
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

export function cut(rows: readonly ParsedRow[]): Cut {
  return rows.reduce<Cut>(
    (acc, row) => ({
      runs: acc.runs + 1,
      passes: acc.passes + (row.pass === 'pass' ? 1 : 0),
      stray: acc.stray + (isStray(row) ? 1 : 0),
      escaped: acc.escaped + (Number(row.escapes) > 0 ? 1 : 0),
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

/** Runs in which a tool was called at least once. */
export function runsCalling(rows: readonly ParsedRow[], tool: string): number {
  return rows.filter((row) => row.tools_called.split(' ').includes(tool)).length
}

/**
 * The same comparison, held to one task at a time.
 *
 * Post 5's best line was correct arithmetic that fell apart once the mix of
 * labels was controlled for. The mix here is the task set: one of the five
 * tasks is the one the fifth tool is right for, so any overall difference
 * between two conditions has to be read against the per-task numbers before it
 * is read as an effect of the roster.
 */
export function perTask(
  rows: readonly ParsedRow[],
  roster: string,
): Map<string, Cut> {
  const out = new Map<string, Cut>()
  for (const [task, taskRows] of by(rowsWhere(rows, { roster }), 'task')) {
    out.set(task, cut(taskRows))
  }
  return out
}

/**
 * The mean size of the context the model was handed before it did anything.
 *
 * A tool definition rides in every request for the whole life of a run, so an
 * extra tool is a standing charge rather than a one-off. Post 2 paid about a
 * hundred tokens a turn for two sentences of description and called it a trade
 * it would take; this is the same meter pointed at the roster.
 */
export function meanContext(rows: readonly ParsedRow[]): number {
  const present = rows
    .map((row) => Number(row.context_tokens ?? 0))
    .filter((value) => value > 0)
  if (present.length === 0) return 0
  return present.reduce((a, b) => a + b, 0) / present.length
}

/**
 * The list price of a run of this experiment, in US cents.
 *
 * The rate is an argument rather than a constant because it is the one number
 * on the page guaranteed to be wrong by the time anyone reads it.
 */
export function cents(
  rows: readonly ParsedRow[],
  perMillionInput: number,
  perMillionOutput: number,
): number {
  const totals = cut(rows)
  return (
    (totals.inputTokens / 1_000_000) * perMillionInput * 100 +
    (totals.outputTokens / 1_000_000) * perMillionOutput * 100
  )
}
