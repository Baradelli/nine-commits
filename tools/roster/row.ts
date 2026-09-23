/**
 * One run of one task under one roster, as a row.
 *
 * The tally beside the post is this shape, one line per run, and every number
 * in the post is recomputed from it by `tally.ts`. Post 2 typed its table out
 * of a terminal by hand and said so; nothing on this page is typed by hand.
 */
export type Row = {
  when: string
  roster: string
  task: string
  run: number
  /** The tools the model called, in order, space separated. */
  tools: string
  steps: number
  stoppedBy: string
  /** Paths the sandbox guard refused during this run. */
  escapes: number
  pass: boolean
  why: string
  /** Files the run created or modified, space separated. */
  changed: string
  /** The recorder's substring grade over the final answer, for comparison. */
  answerGrade: string
  inputTokens: number
  outputTokens: number
  /** The final answer, whitespace collapsed, so a row can be read on its own. */
  answer: string
}

export const COLUMNS = [
  'when',
  'roster',
  'task',
  'run',
  'tools_called',
  'steps',
  'stopped_by',
  'escapes',
  'pass',
  'why',
  'changed',
  'answer_grade',
  'input_tokens',
  'output_tokens',
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
    row.roster,
    row.task,
    String(row.run),
    cell(row.tools) || 'none',
    String(row.steps),
    row.stoppedBy,
    String(row.escapes),
    row.pass ? 'pass' : 'fail',
    cell(row.why),
    cell(row.changed) || 'none',
    row.answerGrade,
    String(row.inputTokens),
    String(row.outputTokens),
    cell(row.answer),
  ].join('\t')
}

/**
 * A row, by column name.
 *
 * Open to columns beyond the ones the runner writes, because `finalise.ts`
 * adds one from the recorded traces after the fact, and a reader of the
 * shipped tally reads that file rather than the runner's.
 */
export type ParsedRow = Record<(typeof COLUMNS)[number], string> & {
  /** Added after the fact by `finalise.ts`, out of the recorded traces. */
  context_tokens?: string
}

/**
 * Reads a tally back, by column name.
 *
 * By name and not by position, and tolerant of CRLF, because post 5 lost a run
 * of its own analysis to a checkout that served the file with Windows line
 * endings and glued a carriage return onto the last cell of every row. A
 * reader that quietly skipped those rows would have printed a smaller, tidier
 * and entirely wrong tally.
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
