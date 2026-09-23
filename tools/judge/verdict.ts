import { z } from 'zod'

/**
 * What a model judge is allowed to say about a run.
 *
 * Deliberately the same four labels `tools/eval/grade.ts` computes, minus
 * `ungradable`, which is a property of the question rather than of the run and
 * is decided before a judge is called at all. Sharing the vocabulary is the
 * whole point: post 4's grader and this one answer the same question in the
 * same words, so the two can be put in one column and disagreed with.
 *
 * `undecidable` is in the list because taking it out would settle the thing
 * this post is measuring by construction. A judge with no way to decline is
 * not a judge that never manufactures certainty; it is a judge whose
 * certainty you cannot see.
 */
export const VERDICTS = [
  'grounded',
  'from-copy',
  'undecidable',
  'unevidenced',
] as const

export type JudgeVerdict = (typeof VERDICTS)[number]

/**
 * A single judgement.
 *
 * `citation` is what makes the label checkable. A verdict on its own can only
 * be compared against another opinion; a verdict plus the `file:line` it was
 * taken from can be compared against the trace, by code, for free. A judge
 * that says `grounded` and cites a line in some other file has contradicted
 * itself in a way no amount of reading the reason would establish.
 */
export const judgementSchema = z.object({
  verdict: z.enum(VERDICTS),
  /** `file:line` the answer is claimed to have come from, or `none`. */
  citation: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

export type Judgement = z.infer<typeof judgementSchema>

/** Raised when a judge's reply is not a judgement. */
export class UnreadableJudgement extends Error {
  override name = 'UnreadableJudgement'
}

/**
 * The one shape concession: a fenced code block around the object.
 *
 * Written before the first judge call was made, because it is a fact about
 * how chat models format replies and not a fact about this experiment. Any
 * further tolerance would be tuning, and there is none: a reply that is not a
 * JSON object with these four fields raises.
 */
function unfence(reply: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(reply.trim())
  return (fenced?.[1] ?? reply).trim()
}

/**
 * Parses a judge's reply, or throws.
 *
 * It throws rather than returning `undecidable`, and that is the important
 * line in this file. A parse failure is the harness not working; `undecidable`
 * is a finding about the run. A grader that turns its own breakage into the
 * most defensible-looking verdict in its vocabulary would report a clean sweep
 * of "I cannot tell" from an experiment that never ran — which is post 1's
 * leak gate, in a nicer jacket.
 */
export function parseJudgement(reply: string): Judgement {
  let value: unknown
  try {
    value = JSON.parse(unfence(reply))
  } catch {
    throw new UnreadableJudgement(
      `judge reply is not JSON: ${reply.slice(0, 200)}`,
    )
  }

  const parsed = judgementSchema.safeParse(value)
  if (!parsed.success) {
    throw new UnreadableJudgement(
      `judge reply is not a judgement: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    )
  }
  return parsed.data
}
