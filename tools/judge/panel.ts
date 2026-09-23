import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { parseTrace, type Trace } from '../trace/schema.ts'
import {
  BINARY_QUESTION,
  MODEL_NAME_QUESTION,
  type Question,
} from '../eval/question.ts'
import type { JudgeVerdict } from './verdict.ts'

/**
 * How many times each case is put to the judge.
 *
 * Fixed here, in the source, before a single judge call was made, and not
 * changed afterwards. The number is small — nine repeats resolves a minority
 * of one in nine and nothing finer — and it is nine rather than one because
 * of the sentence post 2 had to write about itself: *the thing I was
 * measuring was a coin I had flipped once per side*. A model judge is a coin
 * by construction. One call per case would produce a table of verdicts with
 * no way to tell a considered answer from a roll.
 */
export const REPEATS = 9

/**
 * A case put to the judge.
 *
 * `known` is the whole design. A judge run only against the runs nobody can
 * grade is an oracle: every answer it gives is unfalsifiable, and the more
 * confident it sounds the better it looks. So half the panel is cases where
 * the answer is not in doubt, and the judge is not told which half it is
 * looking at — the prompt is identical for every case in this file.
 */
export type JudgeCase = {
  id: string
  /** Where the trace came from, for the reader of the tally. */
  source: string
  question: Question
  trace: Trace
  /**
   * The answer, where there is one. `undefined` means this is one of the runs
   * post 4 showed a deterministic reader cannot settle, and the judge's
   * verdict here is a finding rather than a score.
   */
  known?: JudgeVerdict
  note: string
}

function load(post: string, file: string): Trace {
  return parseTrace(
    JSON.parse(readFileSync(join(POSTS_DIR, post, file), 'utf8')),
  )
}

/**
 * A committed trace with some of its search matches removed in memory.
 *
 * The same construction `tools/eval/corpus.test.ts` uses, and it is here for
 * the same reason: these are cases with a known answer built by subtraction
 * from real data, rather than cases invented to have one. Nothing is written,
 * nothing is published, and no altered trace is shown to a reader as a run.
 * What survives the filter is the part that matters — the model's final
 * sentence is untouched in all three, so the prose is identically confident
 * while the evidence underneath it is emptied out.
 *
 * One artifact of copying the construction exactly, noticed before the first
 * judge call and left alone: only `matches` is filtered, so a result that was
 * originally cut off at the forty-match limit still says so after the filter,
 * and a judge reading `0 matches, cut off at the limit` is being told there
 * was more it is not seeing. That pushes away from `unevidenced`, which is
 * the answer on those cases — it can only make the judge score worse, never
 * better, so fixing it would be adjusting the instrument in the direction of
 * the result I would prefer.
 */
export function keepingMatches(
  original: Trace,
  keep: (file: string) => boolean,
): Trace {
  const frames = original.frames.map((frame) => {
    if (frame.type !== 'tool_result') return frame
    const result = frame.result as { matches?: { file: string }[] }
    if (result.matches === undefined) return frame
    return {
      ...frame,
      result: {
        ...result,
        matches: result.matches.filter((match) => keep(match.file)),
      },
    }
  })
  return parseTrace({ ...original, frames })
}

const SOURCE = 'agent/src/config.ts'

export function buildPanel(): JudgeCase[] {
  const corpusHit = load('03-the-loop', 'trace2-corpus-hit.json')

  return [
    // ---- The control set: six cases where the answer is not in doubt. ----
    {
      id: 'binary-control',
      source: '04-does-it-work/trace-b-binary.json',
      question: BINARY_QUESTION,
      trace: load('04-does-it-work', 'trace-b-binary.json'),
      known: 'grounded',
      note: 'post 4 grades this grounded with no copies anywhere in what came back',
    },
    {
      id: 'named-only',
      source: '02-hands/trace-a-precise.json',
      question: MODEL_NAME_QUESTION,
      trace: load('02-hands', 'trace-a-precise.json'),
      known: 'unevidenced',
      note: 'made 68 observations, every one a file name, and never opened a file',
    },
    {
      id: 'empty-search',
      source: '02-hands/trace-b-thin.json',
      question: MODEL_NAME_QUESTION,
      trace: load('02-hands', 'trace-b-thin.json'),
      known: 'unevidenced',
      note: 'searched once, matched nothing, and said so',
    },
    {
      id: 'source-only',
      source: '03-the-loop/trace2-corpus-hit.json, copies removed in memory',
      question: MODEL_NAME_QUESTION,
      trace: keepingMatches(corpusHit, (file) => file === SOURCE),
      known: 'grounded',
      note: 'a real run with every match outside the source file taken away',
    },
    {
      id: 'copies-only',
      source: '03-the-loop/trace2-corpus-hit.json, the source removed in memory',
      question: MODEL_NAME_QUESTION,
      trace: keepingMatches(corpusHit, (file) => file !== SOURCE),
      known: 'from-copy',
      note: 'the same run with the source file taken away, and the same confident sentence at the end',
    },
    {
      id: 'no-results',
      source: '03-the-loop/trace2-corpus-hit.json, all matches removed in memory',
      question: MODEL_NAME_QUESTION,
      trace: keepingMatches(corpusHit, () => false),
      known: 'unevidenced',
      note: 'a run that searched, got nothing back, and answered anyway',
    },

    // ---- The open set: the runs post 4 could not settle. ----
    {
      id: 'loop-demo',
      source: '03-the-loop/trace.json',
      question: MODEL_NAME_QUESTION,
      trace: load('03-the-loop', 'trace.json'),
      note: "post 3's demonstration run — 1 ground truth, 1 copy",
    },
    {
      id: 'corpus-hit',
      source: '03-the-loop/trace2-corpus-hit.json',
      question: MODEL_NAME_QUESTION,
      trace: corpusHit,
      note: 'the run that was handed the answer key — 1 ground truth, 16 copies',
    },
    {
      id: 'v4-model-name',
      source: '04-does-it-work/trace-a-model-name.json',
      question: MODEL_NAME_QUESTION,
      trace: load('04-does-it-work', 'trace-a-model-name.json'),
      note: 'the same question a commit later, and the same sentence again',
    },
    {
      id: 'retired-control',
      source: '05-moving-target/trace-retired-control.json',
      question: BINARY_QUESTION,
      trace: load('05-moving-target', 'trace-retired-control.json'),
      note: "post 4's control asked again, after publishing put a copy of its answer in the corpus",
    },
  ]
}

export function controlCases(panel: readonly JudgeCase[]): JudgeCase[] {
  return panel.filter((item) => item.known !== undefined)
}

export function openCases(panel: readonly JudgeCase[]): JudgeCase[] {
  return panel.filter((item) => item.known === undefined)
}
