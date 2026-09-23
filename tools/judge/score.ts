import { observationsOf } from '../eval/observation.ts'
import type { JudgeCase } from './panel.ts'
import { VERDICTS, type JudgeVerdict } from './verdict.ts'

/** One judge call, as it is written to the tally. */
export type Judged = {
  case: string
  repeat: number
  verdict: JudgeVerdict
  citation: string
  confidence: number
  reason: string
  inputTokens: number
  outputTokens: number
  /**
   * The model's reply verbatim, before parsing.
   *
   * Optional because the tally committed with post 5 does not carry it. The
   * column was added in fix round 1, and re-running ninety calls to backfill a
   * column would have been a second roll of the dice on the result the post is
   * about. Every rerun writes it, and a reader who wants to check the parse
   * rather than the parsed result then can.
   */
  raw?: string
}

/**
 * Whether the judge's own citation supports the label it chose.
 *
 * This is a deterministic check on a model's reasoning, and it is free: the
 * judge names a `file:line`, the trace either contains that line or does not,
 * and the file either is the source of truth or is not. A verdict on its own
 * can only be compared against another opinion. A verdict with a citation can
 * be compared against the run.
 *
 * `undecidable` is exempt rather than forgiven. A judge that says it cannot
 * choose between two lines and then names the likelier one has not
 * contradicted itself, so scoring that as an error would be scoring a shape
 * of answer rather than a wrong one.
 */
export type CitationCheck =
  /** The cited line was observed and fits the verdict. */
  | 'consistent'
  /** The cited line was observed and the verdict says it came from elsewhere. */
  | 'contradicts'
  /** No tool in this run ever returned the line the judge cited. */
  | 'unobserved'
  /** The judge cited nothing. */
  | 'none'
  /** The verdict is `undecidable`, which a single citation neither supports nor denies. */
  | 'n/a'

const CITATION = /^(.+):(\d+)$/

export function checkCitation(
  judgeCase: JudgeCase,
  judgement: { verdict: JudgeVerdict; citation: string },
): CitationCheck {
  if (judgement.verdict === 'undecidable') return 'n/a'

  const cited = CITATION.exec(judgement.citation.trim())
  if (cited === null) {
    // No line named. That is the whole of the claim for `unevidenced`, and a
    // missing one for the two verdicts that assert a specific origin.
    return judgement.verdict === 'unevidenced' ? 'consistent' : 'none'
  }

  const file = cited[1] ?? ''
  const line = Number(cited[2])
  const observed = observationsOf(judgeCase.trace).some(
    (observation) =>
      observation.kind === 'line' &&
      observation.file === file &&
      observation.line === line,
  )
  if (!observed) return 'unobserved'

  const isSource = file === judgeCase.question.truthFile
  switch (judgement.verdict) {
    case 'grounded':
      return isSource ? 'consistent' : 'contradicts'
    case 'from-copy':
      return isSource ? 'contradicts' : 'consistent'
    case 'unevidenced':
      // It cited a line the run really did get back, having just said nothing
      // the tools returned carries the answer.
      return 'contradicts'
  }
}

export type Tally = {
  case: string
  /** How many of each verdict came back, over the repeats. */
  counts: Record<JudgeVerdict, number>
  runs: number
  /** The verdict with a strict plurality, or `split` when two tie. */
  majority: JudgeVerdict | 'split'
  /** How many distinct verdicts the repeats produced. One means stable. */
  distinct: number
  meanConfidence: number
}

export function tally(caseId: string, judgements: readonly Judged[]): Tally {
  const mine = judgements.filter((judgement) => judgement.case === caseId)
  const counts = Object.fromEntries(
    VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<JudgeVerdict, number>
  for (const judgement of mine) counts[judgement.verdict] += 1

  const ranked = VERDICTS.map((verdict) => ({ verdict, n: counts[verdict] }))
    .filter((entry) => entry.n > 0)
    .sort((a, b) => b.n - a.n)

  const top = ranked[0]
  const runnerUp = ranked[1]
  const majority: JudgeVerdict | 'split' =
    top === undefined
      ? 'split'
      : runnerUp !== undefined && runnerUp.n === top.n
        ? 'split'
        : top.verdict

  return {
    case: caseId,
    counts,
    runs: mine.length,
    majority,
    distinct: ranked.length,
    meanConfidence:
      mine.length === 0
        ? 0
        : mine.reduce((sum, j) => sum + j.confidence, 0) / mine.length,
  }
}

export type ControlScore = {
  case: string
  known: JudgeVerdict
  /** Individual calls that matched the known answer. */
  correct: number
  runs: number
  majority: JudgeVerdict | 'split'
  majorityCorrect: boolean
  /** Citations that contradicted the verdict, or named a line the run never saw. */
  badCitations: number
}

export function scoreControl(
  judgeCase: JudgeCase,
  judgements: readonly Judged[],
): ControlScore {
  const known = judgeCase.known
  if (known === undefined) {
    throw new Error(`case "${judgeCase.id}" has no known answer to score against`)
  }
  const mine = judgements.filter((judgement) => judgement.case === judgeCase.id)
  const summary = tally(judgeCase.id, judgements)

  return {
    case: judgeCase.id,
    known,
    correct: mine.filter((judgement) => judgement.verdict === known).length,
    runs: mine.length,
    majority: summary.majority,
    majorityCorrect: summary.majority === known,
    badCitations: mine.filter((judgement) =>
      ['contradicts', 'unobserved'].includes(checkCitation(judgeCase, judgement)),
    ).length,
  }
}

export type OpenReading = {
  case: string
  majority: JudgeVerdict | 'split'
  distinct: number
  /** Calls that named an origin instead of declining to choose one. */
  decided: number
  runs: number
  /** Mean confidence across the calls that named an origin. */
  confidenceWhenDecided: number
}

/**
 * What the judge did with a run that code cannot settle.
 *
 * There is no score here, because there is no answer to score against. What
 * there is, is a count of how often the judge answered anyway and how sure it
 * said it was — which is the measurement this post exists to take.
 */
export function readOpen(
  judgeCase: JudgeCase,
  judgements: readonly Judged[],
): OpenReading {
  const mine = judgements.filter((judgement) => judgement.case === judgeCase.id)
  const decided = mine.filter(
    (judgement) => judgement.verdict !== 'undecidable',
  )
  const summary = tally(judgeCase.id, judgements)

  return {
    case: judgeCase.id,
    majority: summary.majority,
    distinct: summary.distinct,
    decided: decided.length,
    runs: mine.length,
    confidenceWhenDecided:
      decided.length === 0
        ? 0
        : decided.reduce((sum, j) => sum + j.confidence, 0) / decided.length,
  }
}

export type PanelScore = {
  controls: ControlScore[]
  open: OpenReading[]
  /** Judge calls on control cases that matched the known answer. */
  correct: number
  calls: number
  /** Control cases whose majority verdict is the known answer. */
  majoritiesCorrect: number
  controlCount: number
  /** Control cases where the repeats did not all agree. */
  unstableControls: number
  inputTokens: number
  outputTokens: number
}

export function scorePanel(
  panel: readonly JudgeCase[],
  judgements: readonly Judged[],
): PanelScore {
  const controls = panel
    .filter((item) => item.known !== undefined)
    .map((item) => scoreControl(item, judgements))
  const open = panel
    .filter((item) => item.known === undefined)
    .map((item) => readOpen(item, judgements))

  return {
    controls,
    open,
    correct: controls.reduce((sum, score) => sum + score.correct, 0),
    calls: controls.reduce((sum, score) => sum + score.runs, 0),
    majoritiesCorrect: controls.filter((score) => score.majorityCorrect).length,
    controlCount: controls.length,
    unstableControls: controls.filter(
      (score) => tally(score.case, judgements).distinct > 1,
    ).length,
    inputTokens: judgements.reduce((sum, j) => sum + j.inputTokens, 0),
    outputTokens: judgements.reduce((sum, j) => sum + j.outputTokens, 0),
  }
}
