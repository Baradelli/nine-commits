import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { CONDITIONS, RUNS_PER_CELL } from '../run-shell.ts'
import { TASKS, PARCEL_LINES, PARCEL_FILES, LARGEST_FILE, LARGEST_BYTES } from './tasks.ts'
import {
  binaryCounts,
  by,
  cents,
  commandsOf,
  cut,
  detectionFloor,
  fisherExact,
  meanContext,
  perTask,
  readTally,
  ruleCounts,
  rowsWhere,
  runsCalling,
} from './tally.ts'

/*
 * Every number post 8 prints about the runs, recomputed from the committed
 * tally.
 *
 * Nothing on that page is typed out of a terminal. Post 2 typed its table by
 * hand and said so; since post 4 the rule has been that if the prose and the
 * file drift apart, `npm test` says which one moved.
 *
 * `run-shell.ts` is imported for two constants and nothing else, and it does
 * not start a hundred and forty billed runs on import because it carries the
 * entry-point guard `tools/entrypoints.test.ts` pins. That sentence is here
 * because the absence of it cost this repository about $2.26 at post 7.
 */

const rows = readTally(
  readFileSync(join(POSTS_DIR, '08-shell', 'runs.tsv'), 'utf8'),
)

const four = rowsWhere(rows, { roster: 'four' })
const shell = rowsWhere(rows, { roster: 'four-shell' })
const cutFour = cut(four)
const cutShell = cut(shell)

describe('the shape of the experiment', () => {
  it('is two conditions by seven tasks by ten runs', () => {
    expect(CONDITIONS).toEqual(['four', 'four-shell'])
    expect(RUNS_PER_CELL).toBe(10)
    expect(TASKS).toHaveLength(7)
    expect(rows).toHaveLength(140)
    expect(four).toHaveLength(70)
    expect(shell).toHaveLength(70)
  })

  it('ran every cell, and no cell twice', () => {
    for (const roster of CONDITIONS) {
      for (const task of TASKS) {
        const cell = rowsWhere(rows, { roster, task: task.id })
        expect(cell, `${roster} ${task.id}`).toHaveLength(10)
        expect(new Set(cell.map((row) => row.run)).size).toBe(10)
      }
    }
  })

  it('interleaved the conditions rather than running one after the other', () => {
    // Post 6's discipline: every task under both rosters runs once before
    // either runs twice, so a provider drifting over an hour drifts across
    // both. Checked on the timestamps rather than trusted from the plan.
    const ordered = [...rows].sort((a, b) => a.when.localeCompare(b.when))
    const firstHalf = ordered.slice(0, 70)
    const share = firstHalf.filter((row) => row.roster === 'four').length
    expect(share).toBeGreaterThan(25)
    expect(share).toBeLessThan(45)
  })

  it('threw away nothing: no run is missing and none says the harness failed', () => {
    expect(rows.filter((row) => row.stopped_by === 'threw')).toHaveLength(0)
  })
})

describe('what the shell did to the outcome', () => {
  it('finished fewer tasks with the shell than without, and not significantly so', () => {
    expect(cutFour.passes).toBe(65)
    expect(cutShell.passes).toBe(60)
    const p = fisherExact(
      cutFour.passes,
      cutFour.runs - cutFour.passes,
      cutShell.passes,
      cutShell.runs - cutShell.passes,
    )
    expect(p).toBeCloseTo(0.274, 2)
    expect(p).toBeGreaterThan(0.05)
  })

  it('collapsed on the search task and won the byte-count task', () => {
    const mentionsFour = perTask(rows, 'four').get('find-mentions')
    const mentionsShell = perTask(rows, 'four-shell').get('find-mentions')
    expect([mentionsFour?.passes, mentionsShell?.passes]).toEqual([8, 2])
    expect(
      fisherExact(8, 2, 2, 8),
    ).toBeCloseTo(0.023, 3)

    const largestFour = perTask(rows, 'four').get('largest-file')
    const largestShell = perTask(rows, 'four-shell').get('largest-file')
    expect([largestFour?.passes, largestShell?.passes]).toEqual([7, 10])
    expect(fisherExact(7, 3, 10, 0)).toBeCloseTo(0.211, 2)
  })

  it('moved nothing measurable on the five tasks post 6 already ran', () => {
    // 10/10 against 10/10, 10/10 against 9/10 twice. At ten runs a cell the
    // 95% upper bound on a difference is enormous, which is why this is stated
    // as "nothing measurable" and not as "nothing".
    const expected: Record<string, [number, number]> = {
      'find-timeout': [10, 9],
      'write-note': [10, 10],
      'edit-timeout': [10, 9],
      'append-changelog': [10, 10],
      'add-setting': [10, 10],
    }
    for (const [task, [a, b]] of Object.entries(expected)) {
      expect([
        perTask(rows, 'four').get(task)?.passes,
        perTask(rows, 'four-shell').get(task)?.passes,
      ], task).toEqual([a, b])
    }
    expect(detectionFloor(10)).toBeCloseTo(0.259, 3)
    expect(detectionFloor(70)).toBeCloseTo(0.0419, 4)
  })

  it('ran out of steps eleven times, and the control never did', () => {
    // The one difference that survives being corrected for seven comparisons.
    expect(cutFour.capped).toBe(0)
    expect(cutShell.capped).toBe(11)
    const p = fisherExact(0, 70, 11, 59)
    expect(p).toBeLessThan(0.001)
    expect(p * 7).toBeLessThan(0.05)
  })

  it('changed no file it was not asked to, and never left the sandbox', () => {
    expect(cutFour.stray).toBe(0)
    expect(cutShell.stray).toBe(0)
    expect(cutFour.escaped).toBe(0)
    expect(cutShell.escaped).toBe(0)
  })
})

describe('the composition check, before the causal reading', () => {
  it('puts the whole difference in the runs where the guard refused something', () => {
    // Post 5's lesson and post 7's: a difference between two conditions is not
    // an effect of the condition until the mix inside it has been looked at.
    // The mix here is whether the guard ever said no.
    const refused = shell.filter((row) => Number(row.refusals) > 0)
    const clean = shell.filter((row) => Number(row.refusals) === 0)
    expect(refused).toHaveLength(23)
    expect(clean).toHaveLength(47)

    const cutRefused = cut(refused)
    const cutClean = cut(clean)
    expect(cutRefused.passes).toBe(13)
    expect(cutClean.passes).toBe(47)
    expect(cutRefused.capped).toBe(11)
    expect(cutClean.capped).toBe(0)
    expect(fisherExact(13, 10, 47, 0)).toBeLessThan(0.0001)
  })

  it('shows a shell that was never called is the control', () => {
    const never = shell.filter(
      (row) => !row.tools_called.split(' ').includes('run_command'),
    )
    expect(never).toHaveLength(39)
    expect(cut(never).passes).toBe(39)
    expect(cut(never).capped).toBe(0)
    expect(runsCalling(shell, 'run_command')).toBe(31)
    // Against the four-tool condition's 65/70, that is not a difference.
    expect(fisherExact(39, 0, 65, 5)).toBeGreaterThan(0.05)
  })
})

describe('what the model wrote, and what the guard did with it', () => {
  const commands = shell.flatMap(commandsOf)

  it('wrote seventy-nine command lines and the guard refused forty-seven', () => {
    expect(commands).toHaveLength(79)
    expect(cutShell.refusals).toBe(47)
    expect(cutShell.refused).toBe(23)
    expect(commands.length - cutShell.refusals).toBe(32)
  })

  it('never contains the separator the tally joins commands with', () => {
    // ` | ` separates command lines in the `commands` cell, and a command
    // containing one would be silently split into two. None does, and this is
    // the assertion that keeps the count above honest.
    for (const command of commands) expect(command).not.toContain(' | ')
  })

  it('refused on shell syntax and on flags, and never on a binary', () => {
    // The part of an allow-list everyone writes first — the list of programs —
    // never fired in a hundred and forty runs. What fired was the parser.
    expect(Object.fromEntries([...ruleCounts(shell)].sort())).toEqual({
      flag: 22,
      metacharacter: 25,
    })
  })

  it('asked for four programs, all of them on the list', () => {
    expect(Object.fromEntries([...binaryCounts(shell)].sort())).toEqual({
      find: 6,
      grep: 55,
      ls: 1,
      wc: 17,
    })
  })

  it('reached for the canonical way out of a command allow-list six times', () => {
    // `find -exec` is the first thing anyone writing one of these guards is
    // warned about, and it arrived here from a model trying to do its job.
    expect(commands.filter((c) => c.includes('-exec'))).toHaveLength(6)
    // Every `find` the model wrote used it.
    expect(binaryCounts(shell).get('find')).toBe(6)
  })

  it('wrote shell rather than a command', () => {
    expect(commands.filter((c) => c.includes('||'))).toHaveLength(15)
    // All fifteen are the same idiom, which is the point: `grep` exits 1 when
    // it matches nothing and `|| true` is what you write so a shell script
    // does not stop. There is no shell script.
    expect(commands.filter((c) => c.trimEnd().endsWith('|| true'))).toHaveLength(15)
    expect(commands.filter((c) => c.includes('&&'))).toHaveLength(0)
    expect(commands.filter((c) => /[*?]/.test(c))).toHaveLength(5)
    expect(commands.filter((c) => /(^|\s)\.\.(\s|$)/.test(c))).toHaveLength(2)
  })

  it('preferred the recursion flag that follows symbolic links, four to one', () => {
    // `grep -R` dereferences links; `grep -r` does not. One letter, and the
    // model reached for the wrong one thirty times against eight.
    const capital = commands.filter((c) => /(^|\s)-[A-Za-z]*R/.test(c))
    const lower = commands.filter(
      (c) => /(^|\s)-[a-z]*r/.test(c) && !/(^|\s)-[A-Za-z]*R/.test(c),
    )
    expect(capital).toHaveLength(30)
    expect(lower).toHaveLength(8)
  })
})

describe('what it cost', () => {
  it('charged 154 tokens of context before either agent did anything', () => {
    expect(meanContext(four)).toBeCloseTo(432.9, 1)
    expect(meanContext(shell)).toBeCloseTo(586.9, 1)
    expect(meanContext(shell) - meanContext(four)).toBeCloseTo(154.0, 1)
  })

  it('took more steps and more input tokens with the shell', () => {
    expect(cutFour.steps / 70).toBeCloseTo(4.49, 2)
    expect(cutShell.steps / 70).toBeCloseTo(5.57, 2)
    expect(cutFour.inputTokens).toBe(238_635)
    expect(cutShell.inputTokens).toBe(389_745)
  })

  it('spent six thousand output tokens a run counting bytes by hand', () => {
    // The clearest thing in the tally. `read_file` returns text and never a
    // size, so the four-tool agent counts the characters; `wc -c` returns the
    // number. The two ranges do not overlap.
    const outputs = (roster: string): number[] =>
      rowsWhere(rows, { roster, task: 'largest-file' }).map((row) =>
        Number(row.output_tokens),
      )
    const byHand = outputs('four')
    const byCommand = outputs('four-shell')
    expect(Math.min(...byHand)).toBe(5_408)
    expect(Math.max(...byCommand)).toBe(846)
    expect(Math.min(...byHand)).toBeGreaterThan(Math.max(...byCommand))
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(byHand)).toBeCloseTo(6004, -1)
    expect(mean(byCommand)).toBeCloseTo(421, -1)
  })

  it('cost about forty-three cents at the price used throughout', () => {
    expect(cents(rows, 0.25, 2)).toBeCloseTo(42.7, 1)
    expect(cents(four, 0.25, 2)).toBeCloseTo(25.3, 1)
    expect(cents(shell, 0.25, 2)).toBeCloseTo(17.4, 1)
  })
})

describe('the ground truth the two new tasks are graded against', () => {
  it('is computed from the workspace rather than typed in', () => {
    expect(PARCEL_LINES).toBe(6)
    expect(PARCEL_FILES).toEqual([
      'README.md',
      'config/settings.json',
      'package.json',
      'src/dispatch.ts',
      'src/server.ts',
    ])
    expect(LARGEST_FILE).toBe('README.md')
    expect(LARGEST_BYTES).toBe(191)
  })

  it('is what the published runs were actually graded on', () => {
    const rowsFor = (roster: string, task: string) =>
      rowsWhere(rows, { roster, task })
    // The four-tool byte count that was one too high, in the tally as well as
    // in the trace.
    const wrong = rowsFor('four', 'largest-file').filter((row) => row.pass === 'fail')
    expect(wrong).toHaveLength(3)
    for (const row of wrong) expect(row.why).toBe('no byte count')
  })
})

describe('the tally reads back the way it was written', () => {
  it('has every column, on every row', () => {
    expect([...by(rows, 'roster').keys()].sort()).toEqual(['four', 'four-shell'])
    expect([...by(rows, 'task').keys()].sort()).toEqual(
      [...TASKS].map((task) => task.id).sort(),
    )
  })
})
