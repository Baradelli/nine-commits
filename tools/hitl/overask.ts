import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { commandsOf, readTally } from '../shell/tally.ts'
import { ALLOWED } from '../../agent/src/tools/shell.ts'

/**
 * What a gate on a tool *name* would have cost, measured on runs that already
 * happened.
 *
 * The gate in `agent/src/approval.ts` is a set of tool names, because a name
 * and the arguments the model wrote are the only things the approval protocol
 * hands it. For four of the five gated tools that unit is exactly right: every
 * `write_file` call writes a file. For the fifth it is not, and post 8 left
 * behind the artifact that says by how much.
 *
 * `08-shell/runs.tsv` records every command line the model wrote across a
 * hundred and forty runs. A gate on `run_command` would have stopped every one
 * of them and asked a person. This counts how many of those questions were
 * about a command that could not have changed a byte — which is the same
 * number as *how many times the operator would have been interrupted for
 * nothing*.
 *
 * It costs no model call and no new runs: it is arithmetic over a file another
 * post committed, which is this series' rule about anchoring a number in an
 * artifact rather than in a working tree.
 */

/**
 * The five entries of post 8's allow-list that write.
 *
 * Derived rather than listed: `ALLOWED` is the table, and post 8's
 * `tools/shell/writers.test.ts` measures which of its members change the
 * filesystem by running every one of them. This set is the result of that
 * measurement, and it is spelled here because the membership is load-bearing
 * for the number below — post 8 shipped three wrong versions of this list, so
 * `overask.test.ts` checks this one against `writers.test.ts`'s.
 */
export const WRITERS: readonly string[] = ['cp', 'mkdir', 'mv', 'touch', 'uniq']

/** The first word of a command line, which is the program it names. */
export function binaryOf(command: string): string {
  return command.trim().split(/\s+/)[0] ?? ''
}

/**
 * Whether this command line could have changed anything at all.
 *
 * Deliberately generous to the gate: a command whose binary is off post 8's
 * allow-list counts as *could*, because the guard would have refused it but
 * the gate is asked first and cannot know that. So this over-counts the useful
 * questions and under-counts the wasted ones, which is the direction that
 * makes the finding harder to get rather than easier.
 */
export function couldChangeSomething(command: string): boolean {
  const binary = binaryOf(command)
  if (binary === '') return false
  if (!(binary in ALLOWED)) return true
  return WRITERS.includes(binary)
}

export type OverAsk = {
  /** Command lines written across the corpus. */
  commands: number
  /** Questions a name-based gate would have asked: one per command line. */
  questions: number
  /** Of those, the ones about something that could not have changed anything. */
  pointless: number
  /** Runs that would have been interrupted at least once. */
  runsInterrupted: number
  /** All runs in the corpus. */
  runs: number
  /** How many distinct binaries were asked about. */
  binaries: Map<string, number>
}

export function overAsk(tsv: string): OverAsk {
  const rows = readTally(tsv)
  const binaries = new Map<string, number>()
  let commands = 0
  let pointless = 0
  let runsInterrupted = 0

  for (const row of rows) {
    const written = commandsOf(row)
    if (written.length > 0) runsInterrupted += 1
    for (const command of written) {
      commands += 1
      if (!couldChangeSomething(command)) pointless += 1
      const binary = binaryOf(command)
      binaries.set(binary, (binaries.get(binary) ?? 0) + 1)
    }
  }

  return {
    commands,
    questions: commands,
    pointless,
    runsInterrupted,
    runs: rows.length,
    binaries,
  }
}

export function readShellRuns(postsDir: string = POSTS_DIR): string {
  return readFileSync(join(postsDir, '08-shell', 'runs.tsv'), 'utf8')
}
