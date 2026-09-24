import { WORKSPACE } from '../roster/workspace.ts'
import { TASKS as ROSTER_TASKS, type Task } from '../roster/tasks.ts'

/**
 * Post 6's five tasks, plus two a shell should win.
 *
 * The five are imported rather than copied, so the two posts grade the same
 * work by the same code and a change to one is a change to both. What they
 * measure is whether a shell degrades the choice among four filesystem
 * primitives on the work those primitives were chosen for.
 *
 * The two new ones exist because of post 6's own rule. Post 6 put
 * `append-changelog` in its set on purpose — *a question set with no task the
 * extra tool is good at would make "the fifth makes it worse" true by
 * construction* — and the same rule applies with more force here, because the
 * shell in `ALLOWED` cannot author content — it copies, renames, creates and
 * counts, and has no idiom at all that puts chosen text into a file, which
 * `tools/shell/writers.test.ts` measures — while every one of post 6's five
 * tasks but one ends in exactly that. A set of five such tasks and no counting
 * task would be a set designed for the four to win.
 *
 * So: one task whose answer is a search across every file, and one whose answer
 * is a number the four tools cannot obtain at all. `read_file` returns text; it
 * does not return a size, and counting the bytes of a file by eye from its
 * contents is not something a model does reliably. `ls -la` and `wc -c` return
 * it in one call. If a shell is worth anything, it is worth it here.
 *
 * Both are graded on the final answer rather than on the filesystem, which is
 * post 4's warning and is taken deliberately: their product *is* a fact, the
 * way `find-timeout`'s is, and both ground truths are computed below from
 * `WORKSPACE` rather than typed in, so neither can drift away from the files
 * the agent is handed.
 */

/** Lines in the workspace containing the lowercase string `parcel`. */
export const PARCEL_LINES = Object.values(WORKSPACE).reduce(
  (total, content) =>
    total + content.split('\n').filter((line) => line.includes('parcel')).length,
  0,
)

/** The files that contain it, and the files that do not. */
export const PARCEL_FILES = Object.entries(WORKSPACE)
  .filter(([, content]) => content.includes('parcel'))
  .map(([path]) => path)
  .sort()

export const PARCEL_FREE_FILES = Object.keys(WORKSPACE)
  .filter((path) => !PARCEL_FILES.includes(path))
  .sort()

const bySize = Object.entries(WORKSPACE)
  .map(([path, content]) => [path, Buffer.byteLength(content, 'utf8')] as const)
  .sort((a, b) => b[1] - a[1])

export const LARGEST_FILE = bySize[0]?.[0] ?? ''
export const LARGEST_BYTES = bySize[0]?.[1] ?? 0

function has(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** A number on its own, not part of a longer one — so `6` does not match `src/server.ts:16`. */
function statesNumber(answer: string, value: number): boolean {
  return new RegExp(`(?<![0-9])${value}(?![0-9])`).test(answer)
}

const SHELL_TASKS: readonly Task[] = [
  {
    id: 'find-mentions',
    why: 'a search across every file — the four have no search tool at all at this roster',
    prompt:
      'Which files in this project contain the lowercase word "parcel", and how many ' +
      'lines contain it in total? List the files and give the total.',
    expect: [String(PARCEL_LINES)],
    check: ({ answer }) => {
      const missing = PARCEL_FILES.filter((file) => !has(answer, file))
      if (missing.length > 0) return { pass: false, why: `did not name ${missing.join(', ')}` }
      const wrong = PARCEL_FREE_FILES.filter((file) => has(answer, file))
      if (wrong.length > 0) return { pass: false, why: `named ${wrong.join(', ')}, which do not` }
      if (!statesNumber(answer, PARCEL_LINES)) {
        return { pass: false, why: `no total of ${PARCEL_LINES}` }
      }
      return { pass: true, why: 'named every file and the total' }
    },
  },
  {
    id: 'largest-file',
    why: 'a byte count, which read_file cannot produce and ls -la produces in one call',
    prompt:
      'Which file in this project is the largest, and exactly how many bytes is it?',
    expect: [LARGEST_FILE, String(LARGEST_BYTES)],
    check: ({ answer }) => {
      const named = has(answer, LARGEST_FILE)
      const size = statesNumber(answer, LARGEST_BYTES)
      if (named && size) return { pass: true, why: 'named the file and its size' }
      if (!named && !size) return { pass: false, why: 'named neither' }
      return { pass: false, why: named ? 'no byte count' : 'wrong file' }
    },
  },
]

/** The seven, in a fixed order: post 6's five, then the two a shell should win. */
export const TASKS: readonly Task[] = [...ROSTER_TASKS, ...SHELL_TASKS]

export function taskById(id: string): Task {
  const task = TASKS.find((candidate) => candidate.id === id)
  if (task === undefined) throw new Error(`no task "${id}"`)
  return task
}

export type { Task }
