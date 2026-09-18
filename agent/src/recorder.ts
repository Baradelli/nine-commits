export type RecorderInput = {
  id: string
  commit: string
  model: string
  task: string
  userMessage: string
  assistantText: string
  totalTokens: number
}

/**
 * At v1 the agent is a single model call: it can describe an action but never
 * take one, so every run is recorded as a failure. Later commits replace this
 * with a frame-per-step recorder driven by the loop.
 */
export function toRawTrace(input: RecorderInput): unknown {
  return {
    id: input.id,
    commit: input.commit,
    model: input.model,
    task: input.task,
    outcome: 'failure',
    tokens: [0, input.totalTokens],
    frames: [
      { type: 'user', content: input.userMessage },
      { type: 'assistant', content: input.assistantText },
    ],
  }
}
