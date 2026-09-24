import { COLUMNS, parseTally, type ParsedRow } from './row.ts'

/**
 * Every number post 8 prints, computed from the committed tally and nothing
 * else.
 *
 * Written before the hundred and forty runs were made, which is the only thing
 * that stops a table of results from being a table of whichever cuts came out
 * interesting. Post 6's `tally.ts` is the same file one condition and three
 * columns ago, and the three new cuts are the ones a shell makes possible:
 * how many command lines the model wrote, how many the guard refused, and
 * which rule refused them.
 */
export type Cut = {
  runs: number
  passes: number
  /** Runs that changed a file they were not asked to change. */
  stray: number
  /** Runs where the sandbox path guard refused a path. */
  escaped: number
  /** Runs where the shell guard refused at least one command line. */
  refused: number
  /** Command lines written, whether or not they ran. */
  commands: number
  /** Command lines the guard would not run. */
  refusals: number
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
  refused: 0,
  commands: 0,
  refusals: 0,
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

/** Every command line a run wrote, in order. */
export function commandsOf(row: ParsedRow): string[] {
  return row.commands === 'none' ? [] : row.commands.split(' | ')
}

/** Which rule refused each refused command, in order. */
export function refusalRulesOf(row: ParsedRow): string[] {
  return row.refusal_rules === 'none' ? [] : row.refusal_rules.split(' ')
}

export function cut(rows: readonly ParsedRow[]): Cut {
  return rows.reduce<Cut>(
    (acc, row) => ({
      runs: acc.runs + 1,
      passes: acc.passes + (row.pass === 'pass' ? 1 : 0),
      stray: acc.stray + (isStray(row) ? 1 : 0),
      escaped: acc.escaped + (Number(row.escapes) > 0 ? 1 : 0),
      refused: acc.refused + (Number(row.refusals) > 0 ? 1 : 0),
      commands: acc.commands + commandsOf(row).length,
      refusals: acc.refusals + Number(row.refusals),
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

/** How many refusals each rule accounts for, across a set of runs. */
export function ruleCounts(rows: readonly ParsedRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    for (const rule of refusalRulesOf(row)) {
      out.set(rule, (out.get(rule) ?? 0) + 1)
    }
  }
  return out
}

/**
 * The first binary of every command line written, however it ended.
 *
 * What the model reached for, as opposed to what it got. A model that asked for
 * `sed` nine times and was refused nine times has told you something the tool
 * column cannot: `run_command` is one name for an unbounded set of intentions.
 */
export function binaryCounts(rows: readonly ParsedRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    for (const command of commandsOf(row)) {
      const name = command.trim().split(/\s+/)[0] ?? ''
      if (name === '') continue
      out.set(name, (out.get(name) ?? 0) + 1)
    }
  }
  return out
}

/**
 * The same comparison, held to one task at a time.
 *
 * Post 5's best line was correct arithmetic that fell apart once the mix of
 * labels was controlled for, and post 7's thesis only survived once
 * `max_parallel` was. The mix here is the task set: two of the seven tasks were
 * chosen because a shell should win them, so any overall difference between the
 * conditions has to be read against the per-task numbers before it is read as
 * an effect of the roster.
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
 * extra tool is a standing charge rather than a one-off. Post 6 measured 88
 * tokens for `append_file` and that was its one positive finding; this is the
 * same meter pointed at a tool whose description has to list fifteen binaries
 * and four things it will not do.
 */
export function meanContext(rows: readonly ParsedRow[]): number {
  const present = rows
    .map((row) => Number(row.context_tokens))
    .filter((value) => value > 0)
  if (present.length === 0) return 0
  return present.reduce((a, b) => a + b, 0) / present.length
}

/**
 * The 95% upper bound on a failure rate, given `n` runs and no failures.
 *
 * `1 - 0.05 ** (1 / n)`, which is the exact one-sided Clopper–Pearson upper
 * bound for zero failures in `n` trials — **not** the rule of three, which is
 * the approximation `3 / n` and gives 30% at n = 10 against the 25.9% this
 * returns. An earlier version of this comment called it the rule of three; the
 * values were right and the name was wrong.
 *
 * It is here rather than in the prose because a null result stated without its
 * detection floor is a stronger claim than the runs support, and this series
 * has now said that three times without the arithmetic being anywhere a reader
 * could check it.
 */
export function detectionFloor(n: number): number {
  return n === 0 ? 1 : 1 - Math.pow(0.05, 1 / n)
}

/**
 * Fisher's exact test, two-tailed, on a 2×2 table.
 *
 * Here because post 8 is the first commit in this series whose conditions
 * actually separate, and a difference between two proportions that is printed
 * without a p-value is a difference the reader has to take on trust. It is also
 * the only defence against the opposite error: the overall pass rate moved from
 * 65/70 to 60/70, which looks like a result and is not one — p is 0.27, and the
 * post says so beside the number rather than four hundred lines later.
 *
 * The summation is over every table at least as extreme as the observed one,
 * by probability, which is the two-tailed definition. `1.0000001` is slack for
 * floating-point comparison of two tables that are exactly as likely as each
 * other; without it a symmetric table loses half its own tail.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const logFactorial = (n: number): number => {
    let sum = 0
    for (let i = 2; i <= n; i += 1) sum += Math.log(i)
    return sum
  }
  const probability = (w: number, x: number, y: number, z: number): number =>
    Math.exp(
      logFactorial(w + x) +
        logFactorial(y + z) +
        logFactorial(w + y) +
        logFactorial(x + z) -
        logFactorial(w) -
        logFactorial(x) -
        logFactorial(y) -
        logFactorial(z) -
        logFactorial(w + x + y + z),
    )

  const observed = probability(a, b, c, d)
  const total = a + b + c + d
  const firstRow = a + b
  const firstColumn = a + c
  let p = 0
  for (
    let x = Math.max(0, firstRow + firstColumn - total);
    x <= Math.min(firstRow, firstColumn);
    x += 1
  ) {
    const candidate = probability(
      x,
      firstRow - x,
      firstColumn - x,
      total - firstRow - firstColumn + x,
    )
    if (candidate <= observed * 1.0000001) p += candidate
  }
  return Math.min(1, p)
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
