import { WORKSPACE } from './workspace.ts'

/**
 * What a run left behind: the workspace as it stands afterwards, and the last
 * thing the model said.
 */
export type RunOutcome = {
  after: Readonly<Record<string, string>>
  answer: string
}

export type Verdict = {
  pass: boolean
  /** Why, in one clause, so a failing row in the tally says what went wrong. */
  why: string
}

/**
 * One graded task.
 *
 * `check` is a pure function of the tree before, the tree after and the final
 * answer. No prose is read except where the task's whole product *is* prose —
 * which is one of the five, and it is graded by the recorder's own substring
 * rule rather than by a kinder one invented here.
 *
 * Post 4's lesson is the reason the other four are graded on files: a check
 * over the sentence cannot tell an agent that changed a file from an agent
 * that said it would. Here the file is the answer, so the file is the grade.
 */
export type Task = {
  id: string
  /** Why this task is in the set, in one line. */
  why: string
  prompt: string
  /** Facts the recorder checks for in the final answer, as `TRACE_EXPECT` takes them. */
  expect: readonly string[]
  check: (outcome: RunOutcome) => Verdict
}

const SETTINGS = 'config/settings.json'
const CHANGELOG = 'docs/CHANGELOG.md'
const PORTS_NOTE = 'notes/ports.md'

function has(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** Files that existed before and whose bytes are not what they were. */
export function modified(after: Readonly<Record<string, string>>): string[] {
  return Object.keys(WORKSPACE)
    .filter((file) => after[file] !== WORKSPACE[file])
    .sort()
}

/** Files that did not exist before. */
export function added(after: Readonly<Record<string, string>>): string[] {
  return Object.keys(after)
    .filter((file) => WORKSPACE[file] === undefined)
    .sort()
}

/** Everything that changed, one way or the other. */
export function changed(after: Readonly<Record<string, string>>): string[] {
  return [...modified(after), ...added(after)].sort()
}

/**
 * Every file except the ones named, unchanged.
 *
 * This is the check that makes an edit task an edit task. An agent that
 * rewrites the file it was asked to change is doing something different from
 * an agent that changes one value in it, and the difference only shows up in
 * the bytes it did not touch.
 */
function onlyTouched(
  after: Readonly<Record<string, string>>,
  allowed: readonly string[],
): string | undefined {
  const stray = changed(after).filter((file) => !allowed.includes(file))
  return stray.length === 0 ? undefined : `also changed ${stray.join(', ')}`
}

function parseSettings(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const ORIGINAL_SETTINGS = parseSettings(WORKSPACE[SETTINGS]) ?? {}

/**
 * The five tasks, chosen before any run and not changed since.
 *
 * One for each of the four primitives, plus one whose right answer is
 * genuinely arguable. They are deliberately small: the claim under test is
 * about which tool a model reaches for, and a task big enough to fail for
 * other reasons measures those reasons instead.
 *
 * `append-changelog` is the task the fifth tool exists for. It is in the set
 * on purpose. A question set with no task the extra tool is right for would
 * make "the fifth makes it worse" true by construction, and the point of
 * running this at all is that the fifth gets a fair go at being useful.
 */
export const TASKS: readonly Task[] = [
  {
    id: 'find-timeout',
    why: 'pure read: one value, in one file, stated nowhere else',
    prompt:
      'Which file in this project sets the request timeout, and what is it set to?',
    expect: [SETTINGS, '4500'],
    check: ({ answer }) => {
      const file = has(answer, SETTINGS)
      const value = has(answer, '4500')
      if (file && value) return { pass: true, why: 'named the file and the value' }
      if (!file && !value) return { pass: false, why: 'named neither' }
      return { pass: false, why: file ? 'no value' : 'no file' }
    },
  },
  {
    id: 'write-note',
    why: 'pure write: a file that does not exist yet, at a path the task names',
    prompt:
      'Create a file at notes/ports.md that records the port number this service ' +
      'listens on and the path of the file that sets it.',
    expect: [PORTS_NOTE],
    check: ({ after }) => {
      const note = after[PORTS_NOTE]
      if (note === undefined) return { pass: false, why: `no ${PORTS_NOTE}` }
      if (!has(note, '8137')) return { pass: false, why: 'note has no port number' }
      if (!has(note, 'src/server.ts')) return { pass: false, why: 'note has no source file' }
      const stray = onlyTouched(after, [PORTS_NOTE])
      return stray === undefined
        ? { pass: true, why: 'wrote the note and nothing else' }
        : { pass: false, why: stray }
    },
  },
  {
    id: 'edit-timeout',
    why: 'pure edit: change one value in place and leave the rest of the file alone',
    prompt:
      'Change the request timeout in this project from 4500 to 9000 milliseconds. ' +
      'Leave everything else exactly as it is.',
    expect: ['9000'],
    check: ({ after }) => {
      const text = after[SETTINGS]
      if (text === undefined) return { pass: false, why: `${SETTINGS} is gone` }
      const settings = parseSettings(text)
      if (settings === undefined) return { pass: false, why: 'settings are no longer valid JSON' }
      if (settings.timeoutMs !== 9000) {
        return { pass: false, why: `timeoutMs is ${JSON.stringify(settings.timeoutMs)}` }
      }
      const lost = Object.keys(ORIGINAL_SETTINGS).filter(
        (key) => key !== 'timeoutMs' && settings[key] !== ORIGINAL_SETTINGS[key],
      )
      if (lost.length > 0) return { pass: false, why: `lost or changed ${lost.join(', ')}` }
      const stray = onlyTouched(after, [SETTINGS])
      return stray === undefined
        ? { pass: true, why: 'changed the one value' }
        : { pass: false, why: stray }
    },
  },
  {
    id: 'append-changelog',
    why: 'the addition at the end — the one task the fifth tool is the right answer for',
    prompt:
      'Add a line at the end of docs/CHANGELOG.md recording that the request timeout ' +
      'is now 9000 milliseconds.',
    expect: ['9000'],
    check: ({ after }) => {
      const text = after[CHANGELOG]
      const before = WORKSPACE[CHANGELOG] ?? ''
      if (text === undefined) return { pass: false, why: `${CHANGELOG} is gone` }
      if (!text.startsWith(before)) return { pass: false, why: 'the existing changelog did not survive' }
      const addition = text.slice(before.length)
      if (addition.trim() === '') return { pass: false, why: 'nothing was added' }
      if (!has(addition, '9000')) return { pass: false, why: 'the added line has no value in it' }
      const stray = onlyTouched(after, [CHANGELOG])
      return stray === undefined
        ? { pass: true, why: 'added a line and kept the rest' }
        : { pass: false, why: stray }
    },
  },
  {
    id: 'add-setting',
    why: 'genuinely ambiguous: "add" to a structured file, where appending is wrong',
    prompt:
      'Add a maxBatch setting of 250 to this project’s settings.',
    expect: ['250'],
    check: ({ after }) => {
      const text = after[SETTINGS]
      if (text === undefined) return { pass: false, why: `${SETTINGS} is gone` }
      const settings = parseSettings(text)
      if (settings === undefined) return { pass: false, why: 'settings are no longer valid JSON' }
      if (settings.maxBatch !== 250) {
        return { pass: false, why: `maxBatch is ${JSON.stringify(settings.maxBatch)}` }
      }
      const lost = Object.keys(ORIGINAL_SETTINGS).filter(
        (key) => settings[key] !== ORIGINAL_SETTINGS[key],
      )
      if (lost.length > 0) return { pass: false, why: `lost or changed ${lost.join(', ')}` }
      const stray = onlyTouched(after, [SETTINGS])
      return stray === undefined
        ? { pass: true, why: 'added the key and kept the file valid' }
        : { pass: false, why: stray }
    },
  },
]

export function taskById(id: string): Task {
  const task = TASKS.find((candidate) => candidate.id === id)
  if (task === undefined) throw new Error(`no task "${id}"`)
  return task
}
