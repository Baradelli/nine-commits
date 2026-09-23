import { generateText, stepCountIs, type FinishReason } from 'ai'
import { openai } from '@ai-sdk/openai'
import { INSTRUCTIONS, MODEL_NAME } from './config.ts'
import { buildTools } from './tools/index.ts'
import { resolveStyle, type DescriptionStyle } from './tools/descriptions.ts'
import { resolveRoster, ROSTERS, type Roster } from './tools/roster.ts'
import { PROJECT_ROOT } from './tools/fs.ts'
import type { SandboxEscape } from './tools/sandbox.ts'

export type ToolCallRecord = { id: string; name: string; args: unknown }
export type ToolResultRecord = { id: string; ok: boolean; result: unknown }

export type RunStep = {
  text: string
  toolCalls: ToolCallRecord[]
  toolResults: ToolResultRecord[]
  /** Context the model was handed for this step. */
  inputTokens: number
  /** That context plus what the model produced from it. */
  totalTokens: number
}

/**
 * Which of the two things that can end a run ended this one.
 *
 * `model` is the one that is meant to fire: a step came back asking for no
 * tool, so there was nothing to feed forward and the loop ran out of work.
 * `step-cap` is the backstop firing instead, and it means the model was still
 * mid-task when the program took the pen away.
 */
export type StopReason = 'model' | 'step-cap'

export type RunResult = {
  model: string
  style: DescriptionStyle
  roster: Roster
  /** The tool names the model was actually handed, in order. */
  tools: string[]
  steps: RunStep[]
  stoppedBy: StopReason
  /**
   * Every path the sandbox guard refused during this run.
   *
   * It is on the result rather than only on the terminal because a refusal is
   * a fact about the run: a condition that produces them is a condition where
   * the model tried to leave the directory it was given, and a tally that
   * cannot show that is a tally reporting a safety property it never measured.
   */
  escapes: string[]
}

/**
 * Everything the experiment varies, in one place.
 *
 * Each field falls back to the environment, so the CLI keeps working exactly
 * as it did at v3 and the roster harness can drive many runs in one process
 * without setting and unsetting variables around each of them.
 */
export type RunOptions = {
  root?: string
  roster?: Roster
  style?: DescriptionStyle
}

/**
 * The backstop, not the stop condition.
 *
 * What ends a run is the model declining to call a tool: the SDK goes round
 * again only while a step finishes with `tool-calls`. This number is what
 * stops a run in which that never happens, and there is nothing principled
 * about the value — high enough that this question does not reach it, low
 * enough that a loop which has stopped making progress costs ten requests
 * rather than an afternoon. v2's cap was 2, which is this same mechanism set
 * low enough to forbid the loop outright.
 */
export const MAX_STEPS = 10

/**
 * Which condition ended the run, read back off the steps.
 *
 * A step whose finish reason is `tool-calls` is a step that wanted a next one,
 * so a run whose last step says that was stopped by something other than the
 * model. With these two tools that something is the cap, and only because the
 * SDK's other exits cannot arise here: both tools have an `execute`, and
 * neither asks for approval. Approval is post 9, and when it lands this
 * function stops being a two-way answer.
 *
 * Kept out of `runOnce` so it can be checked without a network call: "what
 * stopped it" is the question the loop introduces, and every recorded run has
 * to answer it.
 */
export function whatStopped(
  steps: readonly { finishReason: FinishReason }[],
): StopReason {
  return steps.at(-1)?.finishReason === 'tool-calls' ? 'step-cap' : 'model'
}

/** A tool that returned `{ ok: false }` reports itself as failed. */
function succeeded(output: unknown): boolean {
  return (
    typeof output !== 'object' ||
    output === null ||
    !('ok' in output) ||
    output.ok === true
  )
}

/**
 * v3: call the model, run whatever tool it asked for, append the call and the
 * result to the conversation, call it again with the longer conversation —
 * until it asks for no tool.
 *
 * `generateText` has been able to do that since the moment v2 handed it
 * `tools`. What v2 did was hold it to two steps and switch the tools off for
 * the second, so there was never a turn in which the model could act on what
 * it had just read. Deleting those two lines is the whole of the loop.
 */
export async function runOnce(
  task: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const style = options.style ?? resolveStyle()
  const roster = options.roster ?? resolveRoster()
  const root = options.root ?? PROJECT_ROOT

  const escapes: SandboxEscape[] = []

  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
    tools: buildTools({
      root,
      roster,
      style,
      onEscape: (error) => {
        escapes.push(error)
        // Loud, and on the terminal rather than only in the trace: a blocked
        // path is the one event in this run that is about the program's
        // safety rather than about the model's answer.
        console.error(`[sandbox] ${error.message}`)
      },
    }),
    stopWhen: stepCountIs(MAX_STEPS),
  })

  const steps: RunStep[] = result.steps.map((step) => ({
    text: step.text,
    toolCalls: step.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      args: call.input,
    })),
    toolResults: step.toolResults.map((toolResult) => ({
      id: toolResult.toolCallId,
      ok: succeeded(toolResult.output),
      result: toolResult.output,
    })),
    inputTokens: step.usage.inputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
  }))

  return {
    model: MODEL_NAME,
    style,
    roster,
    tools: [...ROSTERS[roster]],
    steps,
    stoppedBy: whatStopped(result.steps),
    escapes: escapes.map((error) => error.attempted),
  }
}
