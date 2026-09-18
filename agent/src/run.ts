import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { INSTRUCTIONS, MODEL_NAME } from './config.ts'

export type RunResult = {
  text: string
  model: string
  totalTokens: number
}

/**
 * v1: one model call. No tools, no loop, no history.
 * This is the thing the series argues is not an agent.
 */
export async function runOnce(task: string): Promise<RunResult> {
  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
  })

  return {
    text: result.text,
    model: MODEL_NAME,
    totalTokens: result.usage?.totalTokens ?? 0,
  }
}
