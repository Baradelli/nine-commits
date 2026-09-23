import { describe, it, expect } from 'vitest'
import { TASKS, taskById, changed } from './tasks.ts'
import { WORKSPACE } from './workspace.ts'

/*
 * A grader that cannot fail is not a grader. Post 1 shipped a leak gate that
 * had never seen a real trace and would have reported success over a leak, and
 * every post since has had to show its own instrument going wrong.
 *
 * So this file is mostly failures. Each task is handed the end state a
 * plausible bad run would leave behind — the right value in the wrong file,
 * the right file with the rest of it deleted, valid-looking JSON that is not
 * JSON any more — and asserted to say no.
 */

function after(changes: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = { ...WORKSPACE }
  for (const [path, content] of Object.entries(changes)) {
    if (content === undefined) delete out[path]
    else out[path] = content
  }
  return out
}

const SETTINGS = 'config/settings.json'
const CHANGELOG = 'docs/CHANGELOG.md'

const GOOD_SETTINGS_EDIT = (WORKSPACE[SETTINGS] ?? '').replace('4500', '9000')
const GOOD_SETTINGS_ADD = (WORKSPACE[SETTINGS] ?? '').replace(
  '"retries": 3,',
  '"retries": 3,\n  "maxBatch": 250,',
)

describe('the workspace a run starts from', () => {
  it('states each graded value in exactly one file', () => {
    for (const value of ['4500', '8137']) {
      const hits = Object.entries(WORKSPACE).filter(([, text]) => text.includes(value))
      expect(hits.map(([file]) => file)).toHaveLength(1)
    }
  })

  it('reports nothing as changed when nothing changed', () => {
    expect(changed({ ...WORKSPACE })).toEqual([])
  })
})

describe('a run that did nothing at all', () => {
  it('fails every task whose product is a file', () => {
    const idle = { after: { ...WORKSPACE }, answer: 'I would need to look at the files.' }
    for (const task of TASKS) {
      if (task.id === 'find-timeout') continue
      expect(task.check(idle).pass, task.id).toBe(false)
    }
  })

  it('fails the read task too, because the answer carries neither fact', () => {
    expect(
      taskById('find-timeout').check({ after: { ...WORKSPACE }, answer: 'I cannot see the project.' })
        .pass,
    ).toBe(false)
  })
})

describe('find-timeout', () => {
  const task = taskById('find-timeout')

  it('passes an answer with both halves', () => {
    const verdict = task.check({
      after: { ...WORKSPACE },
      answer: 'The timeout is set in `config/settings.json` — `"timeoutMs": 4500`.',
    })
    expect(verdict.pass).toBe(true)
  })

  it('fails an answer that names the file and guesses no value', () => {
    const verdict = task.check({
      after: { ...WORKSPACE },
      answer: 'It is in config/settings.json — open it to see the value.',
    })
    expect(verdict).toEqual({ pass: false, why: 'no value' })
  })

  it('fails an answer with the value and the wrong file', () => {
    const verdict = task.check({
      after: { ...WORKSPACE },
      answer: 'src/server.ts sets it to 4500.',
    })
    expect(verdict).toEqual({ pass: false, why: 'no file' })
  })
})

describe('write-note', () => {
  const task = taskById('write-note')

  it('passes a note with the port and the file', () => {
    expect(
      task.check({
        after: after({ 'notes/ports.md': 'Port 8137, set in src/server.ts\n' }),
        answer: 'done',
      }).pass,
    ).toBe(true)
  })

  it('fails a note written to a different path', () => {
    const verdict = task.check({
      after: after({ 'ports.md': 'Port 8137, set in src/server.ts\n' }),
      answer: 'done',
    })
    expect(verdict).toEqual({ pass: false, why: 'no notes/ports.md' })
  })

  it('fails a note that names the port and not the file', () => {
    expect(
      task.check({
        after: after({ 'notes/ports.md': 'The service listens on 8137.\n' }),
        answer: 'done',
      }),
    ).toEqual({ pass: false, why: 'note has no source file' })
  })

  it('fails a run that wrote the note and also clobbered something else', () => {
    const verdict = task.check({
      after: after({
        'notes/ports.md': 'Port 8137, set in src/server.ts\n',
        'src/server.ts': 'gone\n',
      }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toMatch(/also changed src\/server\.ts/)
  })
})

describe('edit-timeout', () => {
  const task = taskById('edit-timeout')

  it('passes the one-value change', () => {
    expect(task.check({ after: after({ [SETTINGS]: GOOD_SETTINGS_EDIT }), answer: 'done' }))
      .toEqual({ pass: true, why: 'changed the one value' })
  })

  it('fails a rewrite that dropped the other settings', () => {
    // The failure the four primitives are supposed to prevent: reaching for
    // write_file on a file you have not read and losing everything else in it.
    const verdict = task.check({
      after: after({ [SETTINGS]: '{\n  "timeoutMs": 9000\n}\n' }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toMatch(/lost or changed/)
  })

  it('fails an append that broke the JSON', () => {
    const verdict = task.check({
      after: after({ [SETTINGS]: `${WORKSPACE[SETTINGS] ?? ''}"timeoutMs": 9000\n` }),
      answer: 'done',
    })
    expect(verdict).toEqual({ pass: false, why: 'settings are no longer valid JSON' })
  })

  it('fails a change to the wrong number', () => {
    const verdict = task.check({
      after: after({ [SETTINGS]: (WORKSPACE[SETTINGS] ?? '').replace('4500', '900') }),
      answer: 'done',
    })
    expect(verdict.why).toMatch(/timeoutMs is 900/)
  })

  it('fails a correct edit that also rewrote a second file', () => {
    const verdict = task.check({
      after: after({ [SETTINGS]: GOOD_SETTINGS_EDIT, 'README.md': 'rewritten\n' }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toMatch(/also changed README\.md/)
  })
})

describe('append-changelog', () => {
  const task = taskById('append-changelog')

  it('passes a line added at the end', () => {
    expect(
      task.check({
        after: after({ [CHANGELOG]: `${WORKSPACE[CHANGELOG] ?? ''}- Timeout is now 9000 ms.\n` }),
        answer: 'done',
      }).pass,
    ).toBe(true)
  })

  it('fails a rewrite that lost the history', () => {
    const verdict = task.check({
      after: after({ [CHANGELOG]: '# Changelog\n\n- Timeout is now 9000 ms.\n' }),
      answer: 'done',
    })
    expect(verdict).toEqual({ pass: false, why: 'the existing changelog did not survive' })
  })

  it('fails an addition with no value in it', () => {
    const verdict = task.check({
      after: after({ [CHANGELOG]: `${WORKSPACE[CHANGELOG] ?? ''}- Changed the timeout.\n` }),
      answer: 'done',
    })
    expect(verdict).toEqual({ pass: false, why: 'the added line has no value in it' })
  })

  it('fails an insertion at the top, which is not the end', () => {
    const verdict = task.check({
      after: after({ [CHANGELOG]: `- Timeout is now 9000 ms.\n${WORKSPACE[CHANGELOG] ?? ''}` }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
  })
})

describe('add-setting', () => {
  const task = taskById('add-setting')

  it('passes a key added to the object', () => {
    expect(task.check({ after: after({ [SETTINGS]: GOOD_SETTINGS_ADD }), answer: 'done' }).pass).toBe(
      true,
    )
  })

  it('fails the append that looks right and is not', () => {
    // "Add a setting" reads like an addition at the end. At the end of a JSON
    // object it is not an addition, it is a syntax error.
    const verdict = task.check({
      after: after({ [SETTINGS]: `${WORKSPACE[SETTINGS] ?? ''}"maxBatch": 250\n` }),
      answer: 'done',
    })
    expect(verdict).toEqual({ pass: false, why: 'settings are no longer valid JSON' })
  })

  it('fails a rewrite that added the key and dropped another', () => {
    const verdict = task.check({
      after: after({
        [SETTINGS]: '{\n  "region": "eu-west-2",\n  "timeoutMs": 4500,\n  "maxBatch": 250\n}\n',
      }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toMatch(/lost or changed/)
  })

  it('fails the key written into a new file instead', () => {
    const verdict = task.check({
      after: after({ 'config/batch.json': '{ "maxBatch": 250 }\n' }),
      answer: 'done',
    })
    expect(verdict.pass).toBe(false)
  })
})
