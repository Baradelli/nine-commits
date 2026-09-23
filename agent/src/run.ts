import { generateText, stepCountIs } from 'ai'
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

export type RunResult = {
  model: string
  style: DescriptionStyle
  steps: RunStep[]
}

/**
 * Two, and it is a cap rather than a condition: one step for the model to
 * choose a tool, one for it to answer with what came back. Nothing here asks
 * whether the work is done, and nothing goes round again if it is not. That
 * is post 3.
 */
export const MAX_STEPS = 2

/**
 * One action, then an answer.
 *
 * Without this the cap is spent rather than allocated: the first recorded run
 * called `list_files`, then called `search_files`, then hit the limit with
 * nothing to say, and the trace ended on a tool result. Turning the tools off
 * for the second step makes the agent what v2 is supposed to be — it gets one
 * action, and has to answer with whatever that action returned. Being unable
 * to have another go is the point, and it is also what makes the choice of
 * tool worth a whole post.
 */
const oneActionThenAnswer = ({ stepNumber }: { stepNumber: number }) =>
  stepNumber === 0 ? undefined : { toolChoice: 'none' as const }

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
 * v2: one model call, one tool call, one more model call, stop. The model can
 * now reach the filesystem; it still cannot decide to have another go.
 */
export async function runOnce(task: string): Promise<RunResult> {
  const style = resolveStyle()

  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
    tools: buildTools(style),
    stopWhen: stepCountIs(MAX_STEPS),
    prepareStep: oneActionThenAnswer,
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

  return { model: MODEL_NAME, style, steps }
}
