import { z } from 'zod'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { MODEL_NAME } from '../../agent/src/config.ts'
import type { Trace } from '../trace/schema.ts'
import { renderTrace } from './prompt.ts'

/**
 * The half of compaction that code cannot grade.
 *
 * `tools/context/task.ts` can check, exactly and for free, whether a summary
 * still contains a number: the number is a string and the string is either
 * there or it is not. What it cannot check is the failure that actually
 * frightens me about compaction, which is the opposite one — a summary that
 * says something the transcript does not support. A run whose history has been
 * replaced by a confident paragraph of invention carries on as if it knew
 * things, and every later step is built on it.
 *
 * So this judge is asked one question and it is not "is the summary good". It
 * is: **is every factual claim in this summary supported by the transcript it
 * was made from.** That is a comparison between two texts, which is the shape
 * of question a model can answer and a regular expression cannot.
 *
 * Post 5's rule applies and is why half the panel is controls: a judge run only
 * against cases nobody can grade is an oracle, and the more confident it sounds
 * the better it looks. The controls here are made by **corrupting a real
 * summary** — changing one number in it to a number the transcript does not
 * contain — so the right answer is known by construction and the judge is not
 * told which half it is looking at.
 */

export const SUMMARY_VERDICTS = ['supported', 'unsupported'] as const
export type SummaryVerdict = (typeof SUMMARY_VERDICTS)[number]

export const summaryJudgementSchema = z.object({
  verdict: z.enum(SUMMARY_VERDICTS),
  /**
   * The claim the judge is objecting to, verbatim, or `none`.
   *
   * The same device post 5's `citation` is: a label alone can only be compared
   * against another opinion, and a quotation can be compared against the text
   * by code. A judge that says `unsupported` and quotes a sentence that is not
   * in the summary has contradicted itself in a way no amount of reading its
   * reason would establish.
   */
  quote: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

export type SummaryJudgement = z.infer<typeof summaryJudgementSchema>

/** Raised when a judge's reply is not a judgement. */
export class UnreadableSummaryJudgement extends Error {
  override name = 'UnreadableSummaryJudgement'
}

/**
 * Parses the model's reply, tolerating a fenced code block and nothing else.
 *
 * No retry anywhere above this. A reply that is not a judgement is a broken
 * harness, and retrying until the model produces something parseable is how a
 * tally quietly becomes a tally of the calls that came out well-formed.
 */
export function parseSummaryJudgement(raw: string): SummaryJudgement {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new UnreadableSummaryJudgement('the reply was not JSON')
  }
  const parsed = summaryJudgementSchema.safeParse(value)
  if (!parsed.success) {
    throw new UnreadableSummaryJudgement(
      `the reply was JSON but not a judgement: ${parsed.error.issues
        .map((issue) => issue.path.join('.'))
        .join(', ')}`,
    )
  }
  return parsed.data
}

export const SUMMARY_JUDGE_INSTRUCTIONS = [
  'You check whether a summary is faithful to the transcript it was made from.',
  'You are given the transcript and the summary, and asked one question about them.',
  'Reply with a single JSON object and no other text.',
].join(' ')

/**
 * Everything before a compaction, as the thing the summary was made from.
 *
 * Reconstructed from the committed trace rather than from the run, so the whole
 * panel can be rebuilt by anyone with the repository. It is a superset of what
 * compaction actually dropped — the most recent exchange survives the rewrite
 * and is in here too — and the direction of that error is the safe one: a claim
 * the judge can find support for in the extra material is a claim it will call
 * supported, so the error can only make the judge look better, never worse.
 */
export function historyBefore(trace: Trace, compactionIndex: number): Trace {
  return {
    ...trace,
    frames: trace.frames.slice(0, compactionIndex),
    tokens: trace.tokens.slice(0, compactionIndex),
  }
}

/** Every compaction in a trace, with the index of its frame. */
export function compactionsIn(
  trace: Trace,
): { index: number; before: number; after: number; summary: string }[] {
  const out: { index: number; before: number; after: number; summary: string }[] = []
  trace.frames.forEach((frame, index) => {
    if (frame.type !== 'compaction') return
    out.push({
      index,
      before: frame.before,
      after: frame.after,
      summary: frame.summary,
    })
  })
  return out
}

/**
 * The question put to the judge.
 *
 * Three things are deliberately absent, each of them a way this post could
 * have written its own conclusion:
 *
 * 1. Nothing says which half of the panel a case is in, and the prompt is
 *    identical for every case.
 * 2. Nothing says that summaries are usually faithful, or that `unsupported`
 *    is the careful answer. Both labels are defined in terms of evidence.
 * 3. Nothing names the three numbers this experiment happens to grade on, so
 *    the judge cannot pass by checking a list it was handed.
 */
export function buildSummaryPrompt(history: Trace, summary: string): string {
  return [
    'Here is the complete transcript of the first part of one agent run.',
    '',
    renderTrace(history),
    '',
    'Here is a summary that was written to replace that transcript, so the run',
    'could continue in less context:',
    '',
    summary,
    '',
    'THE QUESTION FOR YOU',
    '',
    'Is every factual claim in the summary supported by the transcript above?',
    'A claim is unsupported if the transcript does not contain it, or contains',
    'something different. Leaving something out is not unsupported; stating',
    'something the transcript does not say is.',
    '',
    '  supported    — every claim in the summary is in the transcript',
    '  unsupported  — at least one claim is not',
    '',
    'Reply with exactly this JSON object and nothing else:',
    '',
    '{"verdict": "<one of the two>", "quote": "<the unsupported claim, verbatim from the summary, or none>", "confidence": <0 to 1>, "reason": "<one sentence>"}',
  ].join('\n')
}

export type SummaryCall = {
  judgement: SummaryJudgement
  raw: string
  inputTokens: number
  outputTokens: number
}

/**
 * The judge is the same model as the agent, for post 5's reason: it is the one
 * that wrote the summary it is now being asked to account for, and a judge
 * marking its own homework is the configuration most people ship.
 */
export const SUMMARY_JUDGE_MODEL = MODEL_NAME

export async function askSummaryJudge(
  history: Trace,
  summary: string,
): Promise<SummaryCall> {
  const result = await generateText({
    model: openai(SUMMARY_JUDGE_MODEL),
    instructions: SUMMARY_JUDGE_INSTRUCTIONS,
    prompt: buildSummaryPrompt(history, summary),
  })

  return {
    judgement: parseSummaryJudgement(result.text),
    raw: result.text.replace(/\s+/g, ' ').trim(),
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  }
}

/**
 * Whether the judge's own quotation is in the summary it was judging.
 *
 * Free, deterministic, and the only thing that makes `unsupported` checkable:
 * a judge that objects to a sentence the summary does not contain has objected
 * to something it wrote itself.
 *
 * `supported` is exempt rather than forgiven — there is nothing to quote when
 * the answer is that everything checks out.
 */
export type QuoteCheck = 'present' | 'absent' | 'none' | 'n/a'

export function checkQuote(
  summary: string,
  judgement: { verdict: SummaryVerdict; quote: string },
): QuoteCheck {
  if (judgement.verdict === 'supported') return 'n/a'
  const quote = judgement.quote.trim()
  if (quote === '' || quote.toLowerCase() === 'none') return 'none'
  const flat = (value: string): string => value.replace(/\s+/g, ' ').toLowerCase()
  return flat(summary).includes(flat(quote)) ? 'present' : 'absent'
}
