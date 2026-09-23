import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { TASKS } from './tasks.ts'
import {
  by,
  cents,
  cut,
  meanContext,
  readTally,
  rowsWhere,
  runsCalling,
  toolCounts,
} from './tally.ts'
import { finalise } from './finalise.ts'
import { HEADER, toLine } from './row.ts'

/*
 * Every number post 6 prints, recomputed from the file it ships.
 *
 * Post 2's table was typed out of a terminal by hand and the post said so.
 * Post 5's was recomputed from `judgements.tsv` and the post said which
 * numbers that covered, because the first draft of that sentence promised more
 * than the test delivered. So: this file recounts the three condition rows, the
 * per-task pass rates, the tool counts, the two step figures, the three
 * context means, the token totals and the cost. If the prose and the tally
 * drift apart, `npm test` says so.
 */

const TALLY = join(POSTS_DIR, '06-four-operations', 'runs.tsv')
const rows = readTally(readFileSync(TALLY, 'utf8'))

const four = rowsWhere(rows, { roster: 'four' })
const append = rowsWhere(rows, { roster: 'five-append' })
const search = rowsWhere(rows, { roster: 'five-search' })

describe('the shape of the tally', () => {
  it('is 150 runs: five tasks, three conditions, ten each', () => {
    expect(rows).toHaveLength(150)
    expect([...by(rows, 'roster').keys()].sort()).toEqual([
      'five-append',
      'five-search',
      'four',
    ])
    for (const roster of ['four', 'five-append', 'five-search']) {
      for (const task of TASKS) {
        expect(rowsWhere(rows, { roster, task: task.id }), `${roster}/${task.id}`).toHaveLength(10)
      }
    }
  })

  it('grades every run against a task this repository still defines', () => {
    const known = new Set(TASKS.map((task) => task.id))
    for (const row of rows) expect(known.has(row.task), row.task).toBe(true)
  })
})

describe('the condition table', () => {
  it('is 50 of 50 three times', () => {
    for (const [name, subset] of [
      ['four', four],
      ['five-append', append],
      ['five-search', search],
    ] as const) {
      const c = cut(subset)
      expect(c.runs, name).toBe(50)
      expect(c.passes, name).toBe(50)
    }
  })

  it('has no stray writes, no refused paths and no idle runs anywhere', () => {
    const all = cut(rows)
    expect(all.stray).toBe(0)
    expect(all.escaped).toBe(0)
    expect(all.idle).toBe(0)
  })

  it('has two capped runs, both in five-append', () => {
    expect(cut(four).capped).toBe(0)
    expect(cut(append).capped).toBe(2)
    expect(cut(search).capped).toBe(0)
  })

  it('prints the steps per run the post prints', () => {
    expect(cut(four).steps / 50).toBeCloseTo(5.1, 1)
    expect(cut(append).steps / 50).toBeCloseTo(5.3, 1)
    expect(cut(search).steps / 50).toBeCloseTo(4.7, 1)
    expect(cut(four).steps).toBe(253)
    expect(cut(append).steps).toBe(265)
    expect(cut(search).steps).toBe(235)
  })

  it('prints the token totals the post prints', () => {
    expect(cut(four).inputTokens).toBe(175_549)
    expect(cut(append).inputTokens).toBe(211_980)
    expect(cut(search).inputTokens).toBe(172_490)
  })
})

describe('the standing charge, which is the finding', () => {
  it('is 404.4 against 492.4 against 473.4 tokens of context', () => {
    expect(meanContext(four)).toBeCloseTo(404.4, 1)
    expect(meanContext(append)).toBeCloseTo(492.4, 1)
    expect(meanContext(search)).toBeCloseTo(473.4, 1)
  })

  it('is 88 tokens a request for append_file and 69 for search_files', () => {
    expect(meanContext(append) - meanContext(four)).toBeCloseTo(88.0, 1)
    expect(meanContext(search) - meanContext(four)).toBeCloseTo(69.0, 1)
  })
})

describe('what the fifth tool was used for', () => {
  it('called append_file on 10 runs, every one of them the task it is right for', () => {
    expect(runsCalling(append, 'append_file')).toBe(10)
    const where = append.filter((row) => row.tools_called.includes('append_file'))
    expect(new Set(where.map((row) => row.task))).toEqual(new Set(['append-changelog']))
    // And on the ambiguous task, where appending would have broken the file.
    expect(runsCalling(rowsWhere(rows, { roster: 'five-append', task: 'add-setting' }), 'append_file')).toBe(0)
  })

  it('called search_files on 24 runs, spread over four tasks', () => {
    expect(runsCalling(search, 'search_files')).toBe(24)
    const spread = new Map<string, number>()
    for (const row of search) {
      if (!row.tools_called.includes('search_files')) continue
      spread.set(row.task, (spread.get(row.task) ?? 0) + 1)
    }
    expect(spread.get('edit-timeout')).toBe(10)
    expect(spread.get('find-timeout')).toBe(9)
    expect(spread.get('write-note')).toBe(3)
    expect(spread.get('add-setting')).toBe(2)
  })

  it('never handed a tool to a condition that was not given it', () => {
    expect(toolCounts(four).get('append_file')).toBeUndefined()
    expect(toolCounts(four).get('search_files')).toBeUndefined()
    expect(toolCounts(append).get('search_files')).toBeUndefined()
    expect(toolCounts(search).get('append_file')).toBeUndefined()
  })

  it('rewrote the whole changelog seven times out of ten with four tools', () => {
    const changelog = rowsWhere(rows, { roster: 'four', task: 'append-changelog' })
    expect(changelog.filter((row) => row.tools_called.includes('write_file'))).toHaveLength(7)
  })
})

describe('the task the fifth tool exists for', () => {
  it('cost more with the fifth tool than without it', () => {
    const withFive = cut(rowsWhere(rows, { roster: 'five-append', task: 'append-changelog' }))
    const without = cut(rowsWhere(rows, { roster: 'four', task: 'append-changelog' }))
    expect(withFive.steps / 10).toBeCloseTo(4.0, 1)
    expect(without.steps / 10).toBeCloseTo(3.9, 1)
    expect(Math.round(withFive.inputTokens / 10)).toBe(2924)
    expect(Math.round(without.inputTokens / 10)).toBe(2656)
  })
})

describe('the sentence grade against the file grade', () => {
  it('disagrees four times in a hundred and fifty, and the files are right every time', () => {
    const disagree = rows.filter((row) => row.answer_grade !== 'success')
    expect(disagree).toHaveLength(4)
    expect(rows.filter((row) => row.pass === 'pass')).toHaveLength(150)

    expect(
      disagree.map((row) => `${row.roster}/${row.task}#${row.run}:${row.answer_grade}`).sort(),
    ).toEqual([
      'five-append/edit-timeout#1:failure',
      'five-append/edit-timeout#9:failure',
      'five-search/find-timeout#5:partial',
      'four/append-changelog#8:failure',
    ])

    // The two with no sentence at all are the runs the cap truncated.
    const silent = disagree.filter((row) => row.answer === '')
    expect(silent).toHaveLength(2)
    for (const row of silent) expect(row.stopped_by).toBe('step-cap')
  })
})

describe('what every run touched', () => {
  it('changed exactly the file its task names, and nothing else', () => {
    const expected: Record<string, string> = {
      'find-timeout': 'none',
      'write-note': 'notes/ports.md',
      'edit-timeout': 'config/settings.json',
      'append-changelog': 'docs/CHANGELOG.md',
      'add-setting': 'config/settings.json',
    }
    for (const row of rows) {
      expect(row.changed, `${row.roster}/${row.task}#${row.run}`).toBe(expected[row.task])
    }
  })
})

describe('the bill', () => {
  it('is the token totals and the cost the post prints', () => {
    const all = cut(rows)
    expect(all.inputTokens).toBe(560_019)
    expect(all.outputTokens).toBe(57_082)
    expect(cents(rows, 0.25, 2)).toBeCloseTo(25.4, 0)
  })
})

describe('the tally reader', () => {
  it('reads the same rows out of both line endings', () => {
    // Post 5 lost a run of its own analysis to a checkout that served this
    // kind of file with CRLF and glued a carriage return to the last cell.
    const text = readFileSync(TALLY, 'utf8')
    const crlf = text.replace(/\r?\n/g, '\r\n')
    expect(readTally(crlf)).toEqual(readTally(text))
  })

  it('refuses a file missing a column rather than reading past it', () => {
    expect(() => readTally('when\troster\n2026-01-01\tfour')).toThrow(/column/)
  })

  it('refuses a row with the wrong number of cells', () => {
    const text = readFileSync(TALLY, 'utf8').split('\n').slice(0, 2).join('\n')
    expect(() => readTally(`${text}\textra`)).toThrow(/cells/)
  })
})

describe('finalise', () => {
  it('adds the context column from the traces and moves nothing else', () => {
    const base = [
      HEADER,
      toLine({
        when: '2026-01-01T00:00:00.000Z',
        roster: 'four',
        task: 'edit-timeout',
        run: 3,
        tools: 'read_file edit_file',
        steps: 3,
        stoppedBy: 'model',
        escapes: 0,
        pass: true,
        why: 'changed the one value',
        changed: 'config/settings.json',
        answerGrade: 'success',
        inputTokens: 100,
        outputTokens: 20,
        answer: 'done',
      }),
    ].join('\n')

    const out = finalise(base, (id) => (id === 'four__edit-timeout__03' ? 412 : undefined))
    const [head, row] = out.trim().split('\n')

    expect(head?.split('\t').at(-2)).toBe('context_tokens')
    expect(row?.split('\t').at(-2)).toBe('412')
    expect(row?.split('\t').at(-1)).toBe('done')
  })

  it('writes a zero rather than inventing a number when the trace is gone', () => {
    const base = [
      HEADER,
      toLine({
        when: 'w', roster: 'four', task: 't', run: 1, tools: 'x', steps: 1,
        stoppedBy: 'model', escapes: 0, pass: true, why: 'w', changed: 'c',
        answerGrade: 'success', inputTokens: 1, outputTokens: 1, answer: 'a',
      }),
    ].join('\n')
    expect(finalise(base, () => undefined).trim().split('\n')[1]?.split('\t').at(-2)).toBe('0')
  })
})
