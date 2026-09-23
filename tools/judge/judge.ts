import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { MODEL_NAME } from '../../agent/src/config.ts'
import { buildJudgePrompt, JUDGE_INSTRUCTIONS } from './prompt.ts'
import { parseJudgement, type Judgement } from './verdict.ts'
import type { JudgeCase } from './panel.ts'

/**
 * The judge is the same model as the agent.
 *
 * Not because it is the best available one — because it is the one that wrote
 * the answers it is now being asked to account for, and a judge marking its
 * own homework is the configuration most people actually ship. Naming a
 * stronger model here would have made the numbers better and the measurement
 * less interesting, and it would have been a second variable in a post whose
 * subject is the first one.
 */
export const JUDGE_MODEL = MODEL_NAME

export type JudgeCall = {
  judgement: Judgement
  /** What the model actually replied, kept verbatim for the tally. */
  raw: string
  inputTokens: number
  outputTokens: number
}

/**
 * One judge call: build the prompt, send it, parse the reply or throw.
 *
 * There is no retry. A reply that is not a judgement is a broken harness and
 * has to stop the run — retrying until the model produces something parseable
 * is how a tally quietly becomes a tally of the calls that happened to come
 * out well-formed.
 */
export async function askJudge(judgeCase: JudgeCase): Promise<JudgeCall> {
  const result = await generateText({
    model: openai(JUDGE_MODEL),
    instructions: JUDGE_INSTRUCTIONS,
    prompt: buildJudgePrompt(judgeCase.trace, judgeCase.question),
  })

  return {
    judgement: parseJudgement(result.text),
    raw: result.text.replace(/\s+/g, ' ').trim(),
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  }
}
