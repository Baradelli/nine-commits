import type { LanguageModel, ModelMessage } from 'ai'
import {
  runOnce,
  type RunResult,
  type RunStep,
  type ToolResultRecord,
} from '../../agent/src/run.ts'
import {
  ALWAYS_ALLOW,
  ALWAYS_DENY,
  answer,
  type Decision,
  type PendingApproval,
} from '../../agent/src/approval.ts'

/**
 * One run, suspended at its first gate, continued twice.
 *
 * This is the whole of how post 9's two published branches were recorded, and
 * the reason the page can say *both branches were recorded* without either of
 * them being made up.
 *
 * ```
 *              list_files, read_file, write_file(…)   <- recorded once
 *                              |
 *                         [ approval ]
 *                        /            \
 *                    allow            deny           <- two real continuations
 * ```
 *
 * The prefix is **one recording**, not two that happen to agree. A model at
 * this temperature does not produce the same tokens twice, so two independent
 * runs of the same task would diverge before the gate and the page would be
 * comparing two different runs — which is what `TraceCompare` has done since
 * post 2 and is a weaker claim. Here the branch point is a value: the
 * conversation the suspended run returned. Each continuation is that value
 * plus one more message, sent to the provider for real.
 *
 * What is *not* shared is the sandbox. Each branch gets its own fresh copy of
 * the workspace, because the allow branch writes to it. Nothing gated ran
 * before the gate, by construction, so the two copies start identical to the
 * one the prefix was recorded against — and `forkAtGate` checks that rather
 * than assuming it.
 */

export type Branch = {
  decision: Decision
  /** The prefix steps with the decision attached, then the continuation's. */
  steps: RunStep[]
  /** The continuation only. What the branch did after the answer. */
  after: RunResult
  root: string
}

export type Fork = {
  /** The run that stopped to ask. */
  suspended: RunResult
  question: PendingApproval
  branches: Branch[]
}

export type ForkOptions = {
  task: string
  roster: RunResult['roster']
  /** Makes a fresh sandbox. Called once for the prefix and once per branch. */
  materialise: () => string
  /** Everything under a root, for the identical-start check. */
  snapshot: (root: string) => Record<string, string>
  dispose: (root: string) => void
  decisions?: readonly Decision[]
  /** Passed straight through to `runOnce`. A test hands it a mock. */
  model?: LanguageModel
}

/**
 * The decision, and anything it caused, put back on the step that asked.
 *
 * Two halves of the same seam, and both were found by recording a real branch
 * rather than by reading code.
 *
 * **The decision.** A resumed run does not know it was gated: the answer
 * arrived in the conversation it was handed, not in a step it produced, so
 * `result.approvals` on a continuation is empty (asserted in
 * `agent/src/approval.test.ts`). The fact belongs to the call, and the call is
 * in the prefix.
 *
 * **The result.** When the answer is yes, the SDK executes the approved call
 * before the first step of the continuation, so the result belongs to no step
 * at all — and the first fork recorded produced an allowed branch with a call,
 * an approval and then the model talking, with nothing in between to show the
 * file had been written. `runOnce` recovers those from `onToolExecutionEnd`
 * and reports them as `resumedResults`; this puts them back where they
 * happened.
 *
 * It is the only place in this repository where a recorded step is edited. It
 * adds two facts the fork itself observed and changes nothing the model said.
 */
export function attachGate(
  steps: readonly RunStep[],
  toolCallId: string,
  tool: string,
  decision: Decision,
  args: unknown,
  results: readonly ToolResultRecord[] = [],
): RunStep[] {
  return steps.map((step) =>
    step.toolCalls.some((call) => call.id === toolCallId)
      ? {
          ...step,
          approvals: [
            ...(step.approvals ?? []),
            { tool, decision, toolCallId, args },
          ],
          toolResults: [
            ...step.toolResults,
            ...results.filter(
              (result) =>
                step.toolCalls.some((call) => call.id === result.id) &&
                !step.toolResults.some((have) => have.id === result.id),
            ),
          ],
        }
      : step,
  )
}

export class NoGateReached extends Error {
  constructor(stoppedBy: string) {
    super(
      `the run finished without reaching a gate (stopped by ${stoppedBy}). ` +
        'There is nothing to fork: a branch needs a question.',
    )
    this.name = 'NoGateReached'
  }
}

export class SandboxMoved extends Error {
  constructor(changed: string[]) {
    super(
      `the sandbox changed before the gate: ${changed.join(', ')}. The two ` +
        'branches would not start from the same state, so the fork is not one.',
    )
    this.name = 'SandboxMoved'
  }
}

export async function forkAtGate(options: ForkOptions): Promise<Fork> {
  const { task, roster, materialise, snapshot, dispose } = options
  const decisions = options.decisions ?? (['allow', 'deny'] as const)

  const prefixRoot = materialise()
  const before = snapshot(prefixRoot)

  // No `decide`, so the gate has nobody to ask and the run suspends.
  const suspended = await runOnce(task, {
    root: prefixRoot,
    roster,
    approval: {},
    ...(options.model === undefined ? {} : { model: options.model }),
  })

  const question = suspended.pending[0]
  if (question === undefined) throw new NoGateReached(suspended.stoppedBy)

  const after = snapshot(prefixRoot)
  const moved = Object.keys({ ...before, ...after }).filter(
    (path) => before[path] !== after[path],
  )
  dispose(prefixRoot)
  if (moved.length > 0) throw new SandboxMoved(moved)

  const branches: Branch[] = []
  for (const decision of decisions) {
    const root = materialise()
    const messages: ModelMessage[] = [
      ...suspended.messages,
      answer(question, decision),
    ]
    const continued = await runOnce(task, {
      root,
      roster,
      approval: { decide: decision === 'allow' ? ALWAYS_ALLOW : ALWAYS_DENY },
      messages,
      ...(options.model === undefined ? {} : { model: options.model }),
    })

    branches.push({
      decision,
      steps: [
        ...attachGate(
          suspended.steps,
          question.toolCallId,
          question.tool,
          decision,
          question.args,
          continued.resumedResults,
        ),
        ...continued.steps,
      ],
      after: continued,
      root,
    })
  }

  return { suspended, question, branches }
}
