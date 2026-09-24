import { FACTS } from './task.ts'
import { parseTally, type ParsedRow } from './row.ts'

/**
 * Every number post 7 prints, computed from the committed tally and nothing
 * else.
 *
 * Written before the runs were made, for the reason this series has now given
 * four times: functions written afterwards produce a table of whichever cuts
 * of the data came out interesting.
 */
export type Cut = {
  runs: number
  /** Runs that wrote all three answers with all three citations. */
  passes: number
  /** Runs that ended because the next request would not fit. */
  overflowed: number
  /** Runs that ended because the step cap fired. */
  capped: number
  /** Runs that wrote the note at all, whatever was in it. */
  wroteNote: number
  /** Total answers written down, out of runs x 3. */
  factsFound: number
  compactions: number
  steps: number
  peakContext: number
  inputTokens: number
  outputTokens: number
  summaryInputTokens: number
  summaryOutputTokens: number
}

const EMPTY: Cut = {
  runs: 0,
  passes: 0,
  overflowed: 0,
  capped: 0,
  wroteNote: 0,
  factsFound: 0,
  compactions: 0,
  steps: 0,
  peakContext: 0,
  inputTokens: 0,
  outputTokens: 0,
  summaryInputTokens: 0,
  summaryOutputTokens: 0,
}

export function readTally(text: string): ParsedRow[] {
  return parseTally(text)
}

/** How many of the three answers this run wrote down. */
export function factCount(row: ParsedRow): number {
  return row.facts === 'none' ? 0 : row.facts.split(' ').filter(Boolean).length
}

/** A run that produced the file, whether or not what was in it was right. */
export function wroteNote(row: ParsedRow): boolean {
  return row.why !== 'no notes/research.md'
}

export function cut(rows: readonly ParsedRow[]): Cut {
  return rows.reduce<Cut>(
    (acc, row) => ({
      runs: acc.runs + 1,
      passes: acc.passes + (row.pass === 'pass' ? 1 : 0),
      overflowed: acc.overflowed + (row.stopped_by === 'context-overflow' ? 1 : 0),
      capped: acc.capped + (row.stopped_by === 'step-cap' ? 1 : 0),
      wroteNote: acc.wroteNote + (wroteNote(row) ? 1 : 0),
      factsFound: acc.factsFound + factCount(row),
      compactions: acc.compactions + Number(row.compactions),
      steps: acc.steps + Number(row.steps),
      peakContext: Math.max(acc.peakContext, Number(row.peak_context)),
      inputTokens: acc.inputTokens + Number(row.input_tokens),
      outputTokens: acc.outputTokens + Number(row.output_tokens),
      summaryInputTokens: acc.summaryInputTokens + Number(row.summary_input_tokens),
      summaryOutputTokens: acc.summaryOutputTokens + Number(row.summary_output_tokens),
    }),
    { ...EMPTY },
  )
}

/**
 * Runs that never pulled more than one page into a single turn.
 *
 * The composition check. Post 5's best line was correct arithmetic that fell
 * apart once the mix of labels was controlled for, and the mix here is this:
 * a turn that fetches three pages at once adds about eighteen thousand tokens
 * in one go, which is more than the whole budget, and no compaction that keeps
 * the most recent exchange can help. Any claim about what compaction did has
 * to be read against these two groups separately before it is read as an
 * effect of compaction.
 */
export function sequential(rows: readonly ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => Number(row.max_parallel) <= 1)
}

export function batched(rows: readonly ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => Number(row.max_parallel) > 1)
}

export function rowsWhere(
  rows: readonly ParsedRow[],
  condition: string,
): ParsedRow[] {
  return rows.filter((row) => row.condition === condition)
}

/** How often each of the three answers was written down, by condition. */
export function perFact(rows: readonly ParsedRow[]): Map<string, number> {
  const out = new Map<string, number>(FACTS.map((fact) => [fact.id, 0]))
  for (const row of rows) {
    if (row.facts === 'none') continue
    for (const id of row.facts.split(' ').filter(Boolean)) {
      out.set(id, (out.get(id) ?? 0) + 1)
    }
  }
  return out
}

/**
 * Mean of the per-run estimate error, in per cent, signed.
 *
 * The presence test is the run having taken a step, not the value being
 * non-zero. The first version filtered on `value > 0`, which was inherited
 * from post 6's `meanContext` where the column could only be positive — here
 * the column is signed, so that filter silently threw away every run whose
 * estimator read LOW and reported the mean of the half that read high. It
 * printed `0.00%` for a condition whose errors were mostly negative, which is
 * the most flattering possible number and the reason this comment is longer
 * than the function.
 */
export function meanEstimateError(rows: readonly ParsedRow[]): number {
  const present = rows
    .filter((row) => Number(row.steps) > 0)
    .map((row) => Number(row.estimate_error_pct))
    .filter((value) => Number.isFinite(value))
  if (present.length === 0) return 0
  return present.reduce((a, b) => a + b, 0) / present.length
}

/**
 * The one-sided 95% upper bound on a rate that was observed zero times in `n`
 * trials — the rule of three, exactly.
 *
 * Post 6 had to state this before its null result meant anything, and post 7
 * has a null of its own: if the compacted runs lose nothing measurable, the
 * honest report is not "nothing" but "nothing larger than this".
 */
export function zeroRateUpperBound(n: number): number {
  return n <= 0 ? 1 : 1 - Math.pow(0.05, 1 / n)
}

/**
 * The list price of a run of this experiment, in US cents.
 *
 * The rate is an argument rather than a constant because it is the one number
 * on the page guaranteed to be wrong by the time anyone reads it. The
 * summariser's tokens are counted in: compaction saves context by spending
 * tokens, and a cost table that left its own bill out would be an
 * advertisement.
 */
export function cents(
  rows: readonly ParsedRow[],
  perMillionInput: number,
  perMillionOutput: number,
): number {
  const totals = cut(rows)
  const input = totals.inputTokens + totals.summaryInputTokens
  const output = totals.outputTokens + totals.summaryOutputTokens
  return (
    (input / 1_000_000) * perMillionInput * 100 +
    (output / 1_000_000) * perMillionOutput * 100
  )
}
