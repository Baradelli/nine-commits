/**
 * One attack on the shell guard, as a row.
 *
 * `expected` is what I predicted before the table was ever run and `verdict` is
 * what happened, so `agreed` is the column that matters: a false in it is
 * either a guard stricter than its author thought or a hole its author did not
 * see, and both are findings.
 */
export type AttackRow = {
  id: string
  class: string
  /** The exact string a model would have to write. */
  command: string
  goal: string
  expected: 'refused' | 'allowed'
  verdict: 'refused' | 'allowed'
  /** Which rule refused it, or `none`. */
  rule: string
  agreed: boolean
  /** What happened when it was executed against a decoy, or `not executed`. */
  effect: string
}

export const ATTACK_COLUMNS = [
  'id',
  'class',
  'command',
  'goal',
  'expected',
  'verdict',
  'rule',
  'agreed',
  'effect',
] as const

export const HEADER = ATTACK_COLUMNS.join('\t')

/**
 * Tabs and newlines separate records, so no cell may contain one.
 *
 * Several attacks *are* a newline or a NUL byte — that is the attack — so the
 * control characters are spelled out rather than collapsed, and the escape is
 * shown as it would be typed. A table whose most interesting rows had been
 * silently flattened into `ls rm -rf .` would be a table that hid its own
 * contents.
 */
export function cell(value: string): string {
  return value
    .replace(/\u0000/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export function toLine(row: AttackRow): string {
  return [
    row.id,
    row.class,
    cell(row.command),
    cell(row.goal),
    row.expected,
    row.verdict,
    row.rule,
    row.agreed ? 'yes' : 'no',
    cell(row.effect),
  ].join('\t')
}

export type ParsedAttackRow = Record<(typeof ATTACK_COLUMNS)[number], string>

/** Reads a committed attack table back, by column name and tolerant of CRLF. */
export function parseAttacks(text: string): ParsedAttackRow[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '')
  const head = lines.shift()
  if (head === undefined) throw new Error('attacks: empty file')

  const names = head.split('\t').map((name) => name.trim())
  for (const column of ATTACK_COLUMNS) {
    if (!names.includes(column)) throw new Error(`attacks: no "${column}" column`)
  }

  return lines.map((line, index) => {
    const cells = line.split('\t')
    if (cells.length !== names.length) {
      throw new Error(
        `attacks: row ${index + 1} has ${cells.length} cells, expected ${names.length}`,
      )
    }
    return Object.fromEntries(
      names.map((name, i) => [name, (cells[i] ?? '').trim()]),
    ) as ParsedAttackRow
  })
}
