/**
 * One run of the research task under one condition, as a row.
 *
 * The tally beside post 7 is this shape, one line per run, and every number in
 * the post is recomputed from it by `tally.test.ts`. Post 2 typed its table out
 * of a terminal by hand and said so; nothing on that page is typed by hand
 * either.
 *
 * Five kinds of column exist that post 6's row did not have, and each is a
 * thing this commit measures for the first time:
 *
 * - `compactions` — how many times the history was rewritten;
 * - `peak_context` — the largest single request this run sent, which is the
 *   number the word "window" is actually about;
 * - `facts_dropped` / `facts_kept` / `facts_lost` — of the answers that were
 *   in the history compaction threw away, which ones the summary carried
 *   through. This is the cost of compaction, measured directly rather than
 *   inferred from whether the run passed;
 * - `summary_input_tokens` / `summary_output_tokens` — compaction's own bill,
 *   kept out of the run's totals so it cannot hide inside the saving;
 * - `estimate_error_pct` — how far the program's own token estimate was from
 *   the provider's count. The compaction decision is made on the estimate, so
 *   a post that printed a threshold without printing this would be quoting a
 *   rule and hiding the meter it is read on.
 */
export type Row = {
  when: string
  /** `off` or `on`. */
  condition: string
  run: number
  /** The tools the model called, in order, space separated. */
  tools: string
  steps: number
  stoppedBy: string
  compactions: number
  /**
   * The most tool calls the model asked for in a single turn.
   *
   * Not a condition of the experiment and not something the program controls —
   * a measurement, added because the composition has to be checkable. A turn
   * that fetches three pages at once puts about eighteen thousand tokens into
   * the history in one step, and no compaction that preserves the most recent
   * exchange can rescue a budget smaller than that. A run like that and a run
   * that read one page at a time are two different experiments, and a tally
   * that could not tell them apart would let one of them be reported as the
   * other.
   */
  maxParallel: number
  pass: boolean
  why: string
  /** Answers written on a line that also names the page they came from. */
  facts: string
  /** Answers written anywhere in the note, cited or not. */
  loose: string
  /**
   * Answers that were in the history compaction threw away.
   *
   * Measured against the dropped messages themselves rather than against the
   * finished trace, because the trace records everything that happened —
   * including the part the run was then made to forget.
   */
  factsDropped: string
  /** Of those, the ones the summary carried through. */
  factsKept: string
  /** Of those, the ones it did not. This is what compaction cost. */
  factsLost: string
  /** The recorder's substring grade over the final sentence, for comparison. */
  answerGrade: string
  /** The largest single request this run sent, as the provider counted it. */
  peakContext: number
  inputTokens: number
  outputTokens: number
  /** What the summariser cost, which is compaction's own bill. */
  summaryInputTokens: number
  summaryOutputTokens: number
  /**
   * Mean (estimate − provider count) / provider count, per cent, signed.
   *
   * Signed because the direction is the whole point. An estimator that reads
   * high stops the control condition early and makes compaction look better
   * than it is; one that reads low lets a request through that the provider
   * then refuses. A magnitude alone says which of those is happening.
   */
  estimateError: number
  /** Requests that actually left the machine. Zero means the cache served it. */
  liveFetches: number
  /** The final answer, whitespace collapsed, so a row can be read on its own. */
  answer: string
}

export const COLUMNS = [
  'when',
  'condition',
  'run',
  'tools_called',
  'steps',
  'stopped_by',
  'compactions',
  'max_parallel',
  'pass',
  'why',
  'facts',
  'facts_anywhere',
  'facts_dropped',
  'facts_kept',
  'facts_lost',
  'answer_grade',
  'peak_context',
  'input_tokens',
  'output_tokens',
  'summary_input_tokens',
  'summary_output_tokens',
  'estimate_error_pct',
  'live_fetches',
  'answer',
] as const

export const HEADER = COLUMNS.join('\t')

/** Tabs and newlines are the record separators, so no cell may contain one. */
function cell(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function toLine(row: Row): string {
  return [
    row.when,
    row.condition,
    String(row.run),
    cell(row.tools) || 'none',
    String(row.steps),
    row.stoppedBy,
    String(row.compactions),
    String(row.maxParallel),
    row.pass ? 'pass' : 'fail',
    cell(row.why),
    cell(row.facts) || 'none',
    cell(row.loose) || 'none',
    cell(row.factsDropped) || 'none',
    cell(row.factsKept) || 'none',
    cell(row.factsLost) || 'none',
    row.answerGrade,
    String(row.peakContext),
    String(row.inputTokens),
    String(row.outputTokens),
    String(row.summaryInputTokens),
    String(row.summaryOutputTokens),
    row.estimateError.toFixed(2),
    String(row.liveFetches),
    cell(row.answer),
  ].join('\t')
}

export type ParsedRow = Record<(typeof COLUMNS)[number], string>

/**
 * Reads a tally back, by column name.
 *
 * By name and not by position, and tolerant of CRLF, because post 5 lost a run
 * of its own analysis to a checkout that served the file with Windows line
 * endings and glued a carriage return onto the last cell of every row.
 */
export function parseTally(text: string): ParsedRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')
  const head = lines.shift()
  if (head === undefined) throw new Error('tally: empty file')

  const names = head.split('\t').map((name) => name.trim())
  for (const column of COLUMNS) {
    if (!names.includes(column)) throw new Error(`tally: no "${column}" column`)
  }

  return lines.map((line, index) => {
    const cells = line.split('\t').map((value) => value.trim())
    if (cells.length !== names.length) {
      throw new Error(
        `tally: row ${index + 1} has ${cells.length} cells, expected ${names.length}`,
      )
    }
    return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])) as ParsedRow
  })
}
