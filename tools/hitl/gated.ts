import { TASKS, type Task } from '../roster/tasks.ts'
import { WORKSPACE } from '../roster/workspace.ts'

/**
 * What the gate was actually asked about, beyond the tool's name.
 *
 * The defect this file exists to close. `gated_tools` records the name the
 * gate decides on, and a name is not enough to check the claim the post
 * makes: "not one was about a call I would have refused" is a statement about
 * a hundred and sixteen *calls*, and for the seventy-six that were denied the
 * call never ran, so no later column carries any trace of it. One deny trace
 * is committed. That left seventy-five questions whose subject a reader had to
 * take on trust.
 *
 * Two things are recoverable from a run's raw trace and neither costs a model
 * call:
 *
 * - **The argument that decides.** For the three write tools it is `path`:
 *   which file this call would change. The gate sees exactly that, because
 *   `gateConfig` is handed the tool call and nothing else.
 * - **What the call would have done.** Every task in the roster grades a
 *   workspace, so a gated call can be applied to the workspace the run started
 *   from and handed to that task's own `check`. That is not a new grader — it
 *   is the function that wrote the `pass` column, run against one call instead
 *   of against a finished run.
 *
 * The second is only exact because of a property of these hundred and fifty
 * runs rather than of the code: no denied run changed a file (nothing ran),
 * and no allowed run was asked twice, so at the moment of every one of the
 * hundred and sixteen questions the workspace was the untouched fixture.
 * `tally.test.ts` asserts both halves of that, so a future run that breaks it
 * turns the column's meaning red rather than quietly changing it.
 */

/**
 * The tools the gate stands in front of, and the argument each is judged on.
 *
 * `run_command` is in `GATED` and is not in here, and that is a limit written
 * down rather than a tool forgotten. The argument that decides a command is
 * the command line, which holds spaces, and the tally's list columns —
 * `decisions`, `gated_tools` — are space separated, so a command line cannot
 * be written into one without a quoting scheme that the next reader of the
 * file has to know about. This roster gives the agent four filesystem tools
 * and no shell, so no run in this experiment could produce one; what a gate on
 * `run_command` would have asked is measured instead in `tools/hitl/overask.ts`,
 * against post 8's committed command lines, where each command already has a
 * row of its own. A roster that gives the agent both needs a column of its
 * own here, and `decidingArgument` throws rather than guessing.
 */
const DECIDING_ARGUMENT: Readonly<Record<string, 'path'>> = {
  write_file: 'path',
  edit_file: 'path',
  append_file: 'path',
}

/** One question the gate asked, with the subject the name left out. */
export type GatedCall = {
  tool: string
  decision: string
  /** The `path` this call would change. */
  argument: string
  /** Whether applying this one call to the starting workspace finishes the task. */
  completesTask: boolean
}

type RawArgs = Record<string, unknown>
type RawFrame = {
  type?: unknown
  name?: unknown
  args?: unknown
  tool?: unknown
  decision?: unknown
}
export type RawTrace = { frames?: unknown }

function argsOf(frame: RawFrame): RawArgs {
  const { args } = frame
  return typeof args === 'object' && args !== null ? (args as RawArgs) : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The one argument the gate's answer turns on, for a call it is asked about.
 *
 * A tool outside `DECIDING_ARGUMENT` has no answer here and says so, rather
 * than returning an empty string that would read as "no path" in the tally.
 * The gate is a set of names and this is a map over the same set; adding a
 * tool to one without the other is the kind of silent hole post 6 shipped.
 */
export function decidingArgument(tool: string, args: unknown): string {
  const key = DECIDING_ARGUMENT[tool]
  if (key === undefined) throw new Error(`gated: no deciding argument for "${tool}"`)
  const value = argsOf({ args })[key]
  return typeof value === 'string' && value !== '' ? value : 'unknown'
}

/**
 * The workspace as it would stand if this one call had been allowed.
 *
 * `edit_file` whose `old_text` is not in the file is a call that would fail
 * and change nothing, so it produces the workspace unchanged — which is what
 * the tool does.
 */
function applied(
  tool: string,
  args: unknown,
  before: Readonly<Record<string, string>>,
): Record<string, string> {
  const a = argsOf({ args })
  const path = str(a.path)
  const after = { ...before }
  const prior = after[path]

  switch (tool) {
    case 'write_file':
      after[path] = str(a.content)
      return after
    case 'append_file':
      after[path] = (prior ?? '') + str(a.content)
      return after
    case 'edit_file': {
      const oldText = str(a.old_text)
      if (prior === undefined || oldText === '' || !prior.includes(oldText)) return after
      after[path] = prior.replace(oldText, str(a.new_text))
      return after
    }
    default:
      // `run_command` changes the filesystem through a program, which this
      // function cannot simulate and will not pretend to.
      return after
  }
}

/**
 * Whether this one call, allowed, would finish the task it was asked for.
 *
 * The task's own `check`, unmodified, over the workspace that call would
 * leave behind — so "it would have changed a file it was not asked to change"
 * and "it would have lost a value it was not asked to lose" are caught by the
 * same code that catches them in the `pass` column, and not by a second rule
 * invented here to agree with the first.
 *
 * The answer is a judgement over a file and not over prose, so the final
 * answer handed to `check` is empty. That matters for exactly one task in the
 * roster — the read-only one — and the gate never fires there.
 */
export function completesTask(task: Task, tool: string, args: unknown): boolean {
  return task.check({ after: applied(tool, args, WORKSPACE), answer: '' }).pass
}

/**
 * Every question in one raw trace, in the order the gate asked them.
 *
 * An `approval` frame carries the name and the decision; the recorder writes
 * it directly after the `tool_call` frame it is about, matched by call id
 * upstream. This reads the pair back and fails loudly if they are not
 * adjacent, because a silently skipped question would understate the count the
 * post's headline number is.
 */
export function gatedCalls(trace: RawTrace, task: Task): GatedCall[] {
  const frames: RawFrame[] = Array.isArray(trace.frames) ? (trace.frames as RawFrame[]) : []
  const out: GatedCall[] = []

  frames.forEach((frame, index) => {
    if (frame.type !== 'approval') return
    const call = frames[index - 1]
    const tool = str(frame.tool)
    if (call?.type !== 'tool_call' || str(call.name) !== tool) {
      throw new Error(
        `gated: approval for "${tool}" at frame ${index} does not follow its call`,
      )
    }
    out.push({
      tool,
      decision: str(frame.decision),
      argument: decidingArgument(tool, call.args),
      completesTask: completesTask(task, tool, call.args),
    })
  })

  return out
}

export function taskById(id: string): Task {
  const task = TASKS.find((candidate) => candidate.id === id)
  if (task === undefined) throw new Error(`gated: no task "${id}"`)
  return task
}
