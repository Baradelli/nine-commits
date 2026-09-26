import { describe, expect, it } from 'vitest'
import { completesTask, decidingArgument, gatedCalls, taskById } from './gated.ts'

/*
 * The column that says a gated call was harmless is only worth anything if it
 * can say the opposite.
 *
 * `gated_completes` reads `yes` a hundred and sixteen times out of a hundred
 * and sixteen in the committed tally, and a function that returned `yes`
 * unconditionally would produce exactly that file. So the cases below are the
 * ones that did not happen: a write to a file the task never mentioned, a
 * rewrite that drops a value the task was told to leave alone, a path that
 * climbs out of the workspace. Post 6's lesson, in the post that quotes it —
 * a counter that reads zero is a question rather than an answer, and the
 * answer is whether the counter can count.
 */

const addSetting = taskById('add-setting')
const editTimeout = taskById('edit-timeout')
const writeNote = taskById('write-note')
const appendChangelog = taskById('append-changelog')

const SETTINGS = 'config/settings.json'
const CHANGELOG = 'docs/CHANGELOG.md'

const settingsWith = (extra: string): string =>
  `{\n  "region": "eu-west-2",\n  "timeoutMs": 4500,\n  "retries": 3,\n  "queueName": "parcel-inbound"${extra}\n}\n`

describe('the argument the gate decides on', () => {
  it('is the path, for each of the three tools that change a file', () => {
    expect(decidingArgument('write_file', { path: SETTINGS, content: '{}' })).toBe(SETTINGS)
    expect(decidingArgument('edit_file', { path: SETTINGS, old_text: 'a', new_text: 'b' })).toBe(
      SETTINGS,
    )
    expect(decidingArgument('append_file', { path: CHANGELOG, content: 'x' })).toBe(CHANGELOG)
  })

  it('refuses to invent one for a gated tool it has no rule for', () => {
    // `run_command` is in `GATED` and deliberately not in this map, for the
    // reason written beside it. A silent empty string here would read as "no
    // path" in the tally, which is the shape of the hole this file closes.
    expect(() => decidingArgument('run_command', { command: 'wc -c README.md' })).toThrow(
      /no deciding argument/,
    )
  })

  it('says so rather than guessing when the argument is missing or not a string', () => {
    expect(decidingArgument('write_file', { content: 'x' })).toBe('unknown')
    expect(decidingArgument('write_file', { path: 7 })).toBe('unknown')
  })
})

describe('whether one gated call would have finished its task', () => {
  it('says yes to the call the runs actually made', () => {
    expect(
      completesTask(addSetting, 'write_file', {
        path: SETTINGS,
        content: settingsWith(',\n  "maxBatch": 250'),
      }),
    ).toBe(true)
    expect(
      completesTask(editTimeout, 'edit_file', {
        path: SETTINGS,
        old_text: '"timeoutMs": 4500',
        new_text: '"timeoutMs": 9000',
      }),
    ).toBe(true)
    expect(
      completesTask(writeNote, 'write_file', {
        path: 'notes/ports.md',
        content: 'The service listens on 8137, set in src/server.ts.\n',
      }),
    ).toBe(true)
    expect(
      completesTask(appendChangelog, 'append_file', {
        path: CHANGELOG,
        content: '\n- Request timeout is now 9000 ms.\n',
      }),
    ).toBe(true)
  })

  it('says no to a call that changes a file the task never asked about', () => {
    expect(
      completesTask(writeNote, 'write_file', { path: 'README.md', content: 'port 8137\n' }),
    ).toBe(false)
  })

  it('says no to a rewrite that loses what the task was told to leave alone', () => {
    // The whole reason the path alone is not enough. Right file, right new
    // value, and every other setting gone.
    expect(
      completesTask(editTimeout, 'write_file', {
        path: SETTINGS,
        content: '{\n  "timeoutMs": 9000\n}\n',
      }),
    ).toBe(false)
  })

  it('says no to an append that buries the changelog instead of adding to it', () => {
    expect(
      completesTask(appendChangelog, 'write_file', {
        path: CHANGELOG,
        content: '# Changelog\n\n- Request timeout is now 9000 ms.\n',
      }),
    ).toBe(false)
  })

  it('says no to a path that climbs out of the workspace', () => {
    expect(
      completesTask(writeNote, 'write_file', {
        path: '../notes/ports.md',
        content: '8137 src/server.ts\n',
      }),
    ).toBe(false)
  })

  it('says no to an edit whose old text is not in the file, because it would not run', () => {
    expect(
      completesTask(editTimeout, 'edit_file', {
        path: SETTINGS,
        old_text: '"timeoutMs": 1234',
        new_text: '"timeoutMs": 9000',
      }),
    ).toBe(false)
  })
})

describe('reading the questions back out of a raw trace', () => {
  const call = {
    type: 'tool_call',
    id: 'c1',
    name: 'write_file',
    args: { path: 'notes/ports.md', content: 'port 8137, set in src/server.ts\n' },
  }

  it('pairs each approval with the call directly above it', () => {
    const trace = {
      frames: [
        { type: 'user', content: 'x' },
        call,
        { type: 'approval', tool: 'write_file', decision: 'deny' },
        { type: 'assistant', content: 'I could not write it.' },
      ],
    }
    expect(gatedCalls(trace, writeNote)).toEqual([
      {
        tool: 'write_file',
        decision: 'deny',
        argument: 'notes/ports.md',
        completesTask: true,
      },
    ])
  })

  it('returns nothing for a run that was never stopped', () => {
    expect(gatedCalls({ frames: [{ type: 'user', content: 'x' }] }, writeNote)).toEqual([])
  })

  it('throws rather than silently dropping a question it cannot place', () => {
    const orphaned = {
      frames: [
        { type: 'user', content: 'x' },
        { type: 'approval', tool: 'write_file', decision: 'deny' },
      ],
    }
    expect(() => gatedCalls(orphaned, writeNote)).toThrow(/does not follow its call/)
  })

  it('throws when the approval names a different tool than the call above it', () => {
    const mismatched = {
      frames: [call, { type: 'approval', tool: 'edit_file', decision: 'deny' }],
    }
    expect(() => gatedCalls(mismatched, writeNote)).toThrow(/does not follow its call/)
  })
})
