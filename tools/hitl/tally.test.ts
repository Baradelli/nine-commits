import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { CONDITIONS, RUNS_PER_CELL, gateFor } from '../run-hitl.ts'
import { GATED } from '../../agent/src/approval.ts'
import { TASKS } from '../roster/tasks.ts'
import { mentionsDenial, REFUSAL_WORDS } from './row.ts'
import {
  cents,
  cut,
  decisionsOf,
  detectionFloor,
  fisherExact,
  gateCounts,
  gatedCompletesOf,
  gatedPathsOf,
  gatedToolsOf,
  meanContext,
  pathCounts,
  perTask,
  readTally,
  rowsWhere,
} from './tally.ts'

/*
 * Every figure post 9 prints, recomputed from the committed tally.
 *
 * Post 8's rule, applied: the page states no number that this file does not
 * derive from `runs.tsv`. The one class of statement it cannot cover is the
 * by-eye reading of the denied runs' answers, which the post presents as a
 * by-eye reading and which is the honest half of a measurement whose automatic
 * half is demonstrated below to be wrong.
 */

const rows = readTally(
  readFileSync(join(POSTS_DIR, '09-hitl', 'runs.tsv'), 'utf8'),
)

const none = rowsWhere(rows, { condition: 'none' })
const allow = rowsWhere(rows, { condition: 'allow' })
const deny = rowsWhere(rows, { condition: 'deny' })

const cn = cut(none)
const ca = cut(allow)
const cd = cut(deny)

/** The four tasks whose product is a change on disk. */
const WRITE_TASKS = ['write-note', 'edit-timeout', 'append-changelog', 'add-setting']
const READ_TASK = 'find-timeout'

describe('the experiment as it was planned', () => {
  it('is three conditions, five tasks, ten runs a cell', () => {
    expect(CONDITIONS).toEqual(['none', 'allow', 'deny'])
    expect(RUNS_PER_CELL).toBe(10)
    expect(TASKS).toHaveLength(5)
    expect(rows).toHaveLength(150)
  })

  it('has exactly ten runs in every cell, and nothing extra', () => {
    for (const condition of CONDITIONS) {
      for (const task of TASKS) {
        expect(rowsWhere(rows, { condition, task: task.id })).toHaveLength(10)
      }
    }
  })

  it('has no run that threw and no path the sandbox refused', () => {
    expect(rows.filter((row) => row.stopped_by === 'threw')).toHaveLength(0)
    expect(cn.escaped + ca.escaped + cd.escaped).toBe(0)
    expect(cn.stray + ca.stray + cd.stray).toBe(0)
  })

  it('runs the control with no gate at all rather than a gate that says yes', () => {
    expect(gateFor('none').approval).toBeUndefined()
    expect(gateFor('allow').approval?.gate).toEqual(GATED)
    expect(gateFor('deny').approval?.gate).toEqual(GATED)
  })
})

describe('what a gate costs when the answer is yes', () => {
  it('is nothing in the standing context, to the token', () => {
    // Not "about the same": the same. The gate adds no text to any request,
    // so the sum over fifty runs is the same integer in both columns.
    const sum = (rowSet: typeof rows) =>
      rowSet.reduce((total, row) => total + Number(row.context_tokens), 0)
    expect(sum(none)).toBe(21620)
    expect(sum(allow)).toBe(21620)
    expect(sum(deny)).toBe(21620)
    expect(meanContext(none)).toBeCloseTo(432.4, 1)
    expect(meanContext(allow)).toBeCloseTo(432.4, 1)
  })

  it('is nothing in tasks finished', () => {
    expect(cn.passes).toBe(50)
    expect(ca.passes).toBe(50)
    expect(
      fisherExact(cn.passes, cn.runs - cn.passes, ca.passes, ca.runs - ca.passes),
    ).toBeCloseTo(1, 5)
  })

  it('is within noise in steps and tokens', () => {
    expect(cn.steps / cn.runs).toBeCloseTo(4.6, 2)
    expect(ca.steps / ca.runs).toBeCloseTo(4.62, 2)
    expect((ca.inputTokens - cn.inputTokens) / cn.inputTokens).toBeLessThan(0.02)
    expect(ca.outputTokens).toBeLessThan(cn.outputTokens)
  })

  it('interrupted forty of the fifty runs anyway, once each', () => {
    expect(ca.gated).toBe(40)
    expect(ca.approvals).toBe(40)
    expect(ca.reasked).toBe(0)
    // The ten it did not interrupt are the read-only task, every time.
    expect(
      allow.filter((row) => Number(row.approvals) === 0).map((row) => row.task),
    ).toEqual(Array.from({ length: 10 }, () => READ_TASK))
  })

  it('caught nothing, because nothing was ever wrong', () => {
    // Forty interruptions, forty correct calls, nothing to stop. Post 6's
    // `escapes recorded: 0` in a different column.
    expect(ca.passes).toBe(50)
    expect(ca.stray).toBe(0)
  })
})

describe('what happens when the answer is no', () => {
  it('finishes the read-only task and none of the other four', () => {
    const byTask = perTask(rows, 'deny')
    expect(byTask.get(READ_TASK)?.passes).toBe(10)
    for (const task of WRITE_TASKS) expect(byTask.get(task)?.passes).toBe(0)
    expect(cd.passes).toBe(10)
  })

  it('is a difference these runs can see, on the tasks where the gate fires', () => {
    const nw = cut(none.filter((row) => WRITE_TASKS.includes(row.task)))
    const dw = cut(deny.filter((row) => WRITE_TASKS.includes(row.task)))
    expect(nw.passes).toBe(40)
    expect(dw.passes).toBe(0)
    expect(
      fisherExact(nw.passes, nw.runs - nw.passes, dw.passes, dw.runs - dw.passes),
    ).toBeLessThan(1e-20)
  })

  it('makes the agent ask again three times in four', () => {
    expect(cd.gated).toBe(40)
    expect(cd.approvals).toBe(76)
    expect(cd.reasked).toBe(30)
    const asked = deny
      .filter((row) => Number(row.approvals) > 0)
      .map((row) => Number(row.approvals))
      .sort((a, b) => a - b)
    expect(asked.filter((n) => n === 1)).toHaveLength(10)
    expect(asked.filter((n) => n === 2)).toHaveLength(29)
    expect(asked.at(-1)).toBe(8)
  })

  it('doubles what the run says', () => {
    // On the four tasks where the gate fires. The read-only task is excluded
    // because the gate never fires there and it would dilute the comparison
    // with runs that were never denied anything — post 8's composition rule.
    const outPerRun = (rowSet: typeof rows) => {
      const subset = rowSet.filter((row) => WRITE_TASKS.includes(row.task))
      return cut(subset).outputTokens / subset.length
    }
    expect(outPerRun(none)).toBeCloseTo(435.3, 1)
    expect(outPerRun(allow)).toBeCloseTo(427.9, 1)
    expect(outPerRun(deny)).toBeCloseTo(916.1, 1)
    expect(outPerRun(deny) / outPerRun(none)).toBeGreaterThan(2)
  })

  it('costs a step and a half a run, and two runs to the cap', () => {
    expect(cd.steps / cd.runs).toBeCloseTo(5.32, 2)
    expect(cd.capped).toBe(2)
    expect(cn.capped).toBe(1)
    expect(ca.capped).toBe(0)
  })

  it('leaves two runs with nothing to say at all', () => {
    const silent = deny.filter((row) => row.answer.trim() === '')
    expect(silent).toHaveLength(2)
    expect(silent.every((row) => row.stopped_by === 'step-cap')).toBe(true)
  })
})

describe('the keyword column, and why the post does not lean on it', () => {
  it('counts twenty-six of the forty denied runs', () => {
    expect(cd.mentioned).toBe(26)
    expect(
      deny.filter(
        (row) => Number(row.approvals) > 0 && row.mentions_denial === 'yes',
      ),
    ).toHaveLength(26)
  })

  it('misses eleven runs that plainly say so, in words it does not hold', () => {
    // The by-eye reading the post reports: of the fourteen the column scores
    // `no`, two are empty, eleven say they could not do it, and one never
    // mentions being stopped at all — which the column scored `no` correctly.
    // So the column is wrong on eleven of the forty, not twelve, and 26 + 11
    // is the 37 the post counted by eye. The phrasings it misses are ordinary
    // English — this is post 4's finding landing on an instrument built in
    // post 9.
    const missed = deny.filter(
      (row) =>
        Number(row.approvals) > 0 &&
        row.mentions_denial === 'no' &&
        row.answer.trim() !== '',
    )
    expect(missed).toHaveLength(12)
    const saysSo = missed.filter((row) =>
      /couldn|could not|can't|cannot|wasn|was not/i.test(row.answer),
    )
    expect(saysSo).toHaveLength(11)
    // And exactly one of the forty never mentions being stopped in any
    // phrasing at all.
    expect(missed.length - saysSo.length).toBe(1)
  })

  it('is a fixed list, and the list is what it is', () => {
    expect(REFUSAL_WORDS).toHaveLength(13)
    expect(mentionsDenial('the write was denied')).toBe(true)
    // The exact miss: a curly apostrophe and a negation the list does not hold.
    expect(mentionsDenial('I wasn’t allowed to modify files')).toBe(false)
    expect(mentionsDenial("I couldn't write the file")).toBe(false)
  })
})

describe('what the denied runs did instead', () => {
  /*
   * Computed after the runs, from the committed file, and stated as a
   * description rather than as a test of anything. The idioms are matched
   * literally and the list is narrow on purpose: `>` and `>>` appear inside
   * prose and JSON, so they are not in it.
   */
  const IDIOMS = ['sed -i', 'jq ', 'cat > ', 'printf ', 'Set-Content', 'tee ', 'echo ']
  const gated = deny.filter((row) => Number(row.approvals) > 0)
  const handed = gated.filter((row) => IDIOMS.some((idiom) => row.answer.includes(idiom)))

  it('handed the operator a command line in twenty-seven of forty', () => {
    expect(gated).toHaveLength(40)
    expect(handed).toHaveLength(27)
  })

  it('reached for sed -i eight times — a command post 8 refuses to run', () => {
    expect(gated.filter((row) => row.answer.includes('sed -i'))).toHaveLength(8)
    expect(gated.filter((row) => row.answer.includes('jq '))).toHaveLength(6)
    expect(gated.filter((row) => row.answer.includes('cat > '))).toHaveLength(7)
  })

  it('put the change itself in the answer in thirty-eight of forty', () => {
    const wanted: Record<string, string> = {
      'write-note': '8137',
      'edit-timeout': '9000',
      'append-changelog': '9000',
      'add-setting': '250',
    }
    const carried = gated.filter((row) =>
      row.answer.includes(wanted[row.task] ?? '\u0000'),
    )
    expect(carried).toHaveLength(38)
  })
})

describe('which tools the gate asked about', () => {
  it('is the two of the four that change a file', () => {
    expect(Object.fromEntries(gateCounts(rows))).toEqual({
      write_file: 57,
      edit_file: 59,
    })
    expect(57 + 59).toBe(ca.approvals + cd.approvals)
  })
})

describe('what the gate asked about, beyond the tool name', () => {
  /*
   * The thesis says not one of the hundred and sixteen questions was about a
   * call I would have refused, and for a long time this file only asserted the
   * forty that ran. The seventy-six denied calls never executed, so no outcome
   * column carries anything about them; `gated_tools` carried a name and a
   * name is not a call. `gated_paths` and `gated_completes` are the subject
   * the name left out, recovered from the run traces by
   * `tools/retally-hitl.ts` and asserted here. Break one cell and this section
   * goes red, which is the whole point of it.
   */
  const asked = rows.filter((row) => Number(row.approvals) > 0)

  it('is a list the same length as the count the headline uses', () => {
    // Four columns, one entry per question, or the hundred and sixteen is
    // counting something the other three are not describing.
    for (const row of rows) {
      const n = Number(row.approvals)
      expect(decisionsOf(row)).toHaveLength(n)
      expect(gatedToolsOf(row)).toHaveLength(n)
      expect(gatedPathsOf(row)).toHaveLength(n)
      expect(gatedCompletesOf(row)).toHaveLength(n)
    }
    expect(rows.flatMap(gatedPathsOf)).toHaveLength(116)
  })

  it('never once pointed outside the workspace', () => {
    // Stated as a property rather than as the three file names, because a
    // list of what was asked about says nothing about what was not.
    for (const path of rows.flatMap(gatedPathsOf)) {
      expect(path).not.toMatch(/^([/\\]|[A-Za-z]:|~)/)
      expect(path.split(/[/\\]/)).not.toContain('..')
      expect(path).not.toBe('unknown')
    }
  })

  it('was asked against the untouched workspace every single time', () => {
    // The condition that makes the column below exact rather than
    // approximate. Nothing ran under `deny`, so no denied run had changed a
    // file by the time it was asked; and no `allow` run was asked twice, so no
    // allowed run had either. If a later run breaks that, this goes red before
    // the column quietly starts meaning something else.
    expect(deny.every((row) => row.changed === 'none')).toBe(true)
    expect(ca.reasked).toBe(0)
  })

  it('was a call that would have finished the task, all hundred and sixteen times', () => {
    // The claim the thesis makes, in the form a reader can check: every one of
    // these calls, applied to the workspace the run started from and graded by
    // its own task's `check`, completes that task. Not the path alone — the
    // same function that wrote the `pass` column, so a write to the right file
    // that dropped a setting it was told to keep would read `no` here.
    // `gated.test.ts` is where that function is shown to be able to say `no`.
    const verdicts = rows.flatMap(gatedCompletesOf)
    expect(verdicts).toHaveLength(116)
    expect(verdicts.filter((verdict) => verdict !== 'yes')).toEqual([])
  })

  it('accounts for every question under one of the four write tasks', () => {
    // Derived rather than listed: the paths are grouped by the task that was
    // asked, so a question about a file belonging to a different task would
    // show up as a new bucket rather than being absorbed into an existing one.
    const byTask = new Map<string, Set<string>>()
    for (const row of asked) {
      const set = byTask.get(row.task) ?? new Set<string>()
      for (const path of gatedPathsOf(row)) set.add(path)
      byTask.set(row.task, set)
    }
    expect([...byTask.keys()].sort()).toEqual([...WRITE_TASKS].sort())
    for (const set of byTask.values()) expect(set.size).toBe(1)
    expect([...pathCounts(rows).values()].reduce((a, b) => a + b, 0)).toBe(116)
  })
})

describe('the floors and the bill', () => {
  it('states the resolution these runs are bought at', () => {
    expect(detectionFloor(50) * 100).toBeCloseTo(5.8, 1)
    expect(detectionFloor(10) * 100).toBeCloseTo(25.9, 1)
    expect(detectionFloor(40) * 100).toBeCloseTo(7.2, 1)
    // A hundred and sixteen questions with no wrong one among them. Post 6's
    // rule about a rate observed zero times, applied to the headline.
    expect(detectionFloor(116) * 100).toBeCloseTo(2.5, 1)
  })

  it('prices the experiment from its own rows', () => {
    expect(cents(none)).toBeCloseTo(8.26, 2)
    expect(cents(allow)).toBeCloseTo(8.31, 2)
    expect(cents(deny)).toBeCloseTo(13.45, 2)
    expect(cents(rows)).toBeCloseTo(30.02, 2)
  })
})
