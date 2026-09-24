/**
 * One run of one task under one roster, as a row.
 *
 * Post 6's shape with three columns added, and the three are the whole reason
 * this file is not `tools/roster/row.ts`:
 *
 * - `commands` is every command line the model actually wrote, in order. Post 6
 *   recorded which *tools* were called; a shell has one tool and an unbounded
 *   number of things it can be asked to do, so the tool name says nothing. This
 *   is the column that answers "what did it try".
 * - `refusals` is how many of them the guard would not run, and
 *   `refusal_rules` is which rule refused each. Post 6's escape counter read
 *   zero across a hundred and fifty runs, so everything that post could say
 *   about its guard came out of a test file. This is the same counter over a
 *   much larger surface.
 */
export type Row = {
  when: string
  roster: string
  task: string
  run: number
  /** The tools the model called, in order, space separated. */
  tools: string
  /** Every command line it wrote, in order, separated by ` | `. */
  commands: string
  steps: number
  stoppedBy: string
  /** Paths the sandbox guard refused. */
  escapes: number
  /** Command lines the shell guard refused. */
  refusals: number
  /** Which rule refused each one, in order. */
  refusalRules: string
  pass: boolean
  why: string
  /** Files the run created or modified, space separated. */
  changed: string
  /** The recorder's substring grade over the final answer, for comparison. */
  answerGrade: string
  /** The context the model was handed before it did anything: instruction, tools, task. */
  contextTokens: number
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
  'commands',
  'steps',
  'stopped_by',
  'escapes',
  'refusals',
  'refusal_rules',
  'pass',
  'why',
  'changed',
  'answer_grade',
  'context_tokens',
  'input_tokens',
  'output_tokens',
  'answer',
] as const

export const HEADER = COLUMNS.join('\t')

/**
 * Tabs and newlines are the record separators, so no cell may contain one.
 *
 * A command line is the one cell here that a model wrote, and a model that
 * wrote a newline into one was trying to run two commands. Collapsing it to a
 * space would hide exactly the thing the column exists to show, so the control
 * characters are spelled rather than squeezed.
 */
function cell(value: string): string {
  return value
    .replace(/\u0000/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function toLine(row: Row): string {
  return [
    row.when,
    row.roster,
    row.task,
    String(row.run),
    cell(row.tools) || 'none',
    cell(row.commands) || 'none',
    String(row.steps),
    row.stoppedBy,
    String(row.escapes),
    String(row.refusals),
    cell(row.refusalRules) || 'none',
    row.pass ? 'pass' : 'fail',
    cell(row.why),
    cell(row.changed) || 'none',
    row.answerGrade,
    String(row.contextTokens),
    String(row.inputTokens),
    String(row.outputTokens),
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
