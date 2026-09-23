import { generateText, stepCountIs, type FinishReason } from 'ai'
import { openai } from '@ai-sdk/openai'
import { INSTRUCTIONS, MODEL_NAME } from './config.ts'
import { buildTools } from './tools/index.ts'
import { resolveStyle, type DescriptionStyle } from './tools/descriptions.ts'

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
  steps: RunStep[]
  stoppedBy: StopReason
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
 * A step whose finish reason is `tool-calls` is a step that wanted a next one.
 * If the last step says that and the run stopped anyway, the only thing that
 * can have stopped it is the cap. Kept out of `runOnce` so it can be checked
 * without a network call: "what stopped it" is the question the loop
 * introduces, and every recorded run has to answer it.
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
export async function runOnce(task: string): Promise<RunResult> {
  const style = resolveStyle()

  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
    tools: buildTools(style),
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
    steps,
    stoppedBy: whatStopped(result.steps),
  }
}
