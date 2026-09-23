import type { Trace } from '../trace/schema.ts'
import type { Question } from './question.ts'
import {
  anyToolFailed,
  finalAnswer,
  observationsOf,
  toolPath,
  type Observation,
} from './observation.ts'

/** How well a fact the answer states is backed by something a tool returned. */
export type Support =
  /** It appeared in a line of file contents. The agent read it. */
  | 'read'
  /** It appeared only as a file name in a listing. The agent inferred it. */
  | 'named-only'
  /** It appeared in nothing the tools returned. The agent supplied it. */
  | 'unsupported'

/** Where the answer could have come from, given only what the trace records. */
export type Provenance =
  /** The ground-truth line was observed and no copy of it was. */
  | 'grounded'
  /** Both were observed. The trace cannot say which one was used. */
  | 'undecidable'
  /** A copy was observed and the ground truth was not. */
  | 'from-copy'
  /** Neither was observed. Nothing the tools returned carries the answer. */
  | 'unevidenced'
  /** The question has no single line for an answer, so there is nothing to trace. */
  | 'ungradable'

export type AnswerGrade = 'success' | 'partial' | 'failure' | 'ungraded'

export type Claim = {
  fact: string
  text: string
  inAnswer: boolean
  support: Support
}

export type Sighting = { file: string; line: number; text: string }

export type Grade = {
  run: string
  toolPath: string[]
  observations: number
  /** What the recorder wrote into the trace at the time. */
  recordedOutcome: Trace['outcome']
  /** The same rule, recomputed here: a substring check over the final answer. */
  answer: AnswerGrade
  claims: Claim[]
  /** Facts the answer states that the agent never read. The column that matters. */
  unread: string[]
  provenance: Provenance
  truth: Sighting[]
  copies: Sighting[]
  /** The only thing a prose grader looks at, carried along so it can be compared. */
  finalAnswer: string
}

function has(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * The recorder's rule, recomputed from the trace rather than from the run.
 *
 * All the facts present in the final answer is a success, some is partial,
 * none is a failure, and a failed tool call caps the grade at partial. It is
 * reimplemented rather than imported because `deriveOutcome` takes the live
 * `RunStep[]` and this reads a committed file — and because a grader that
 * agrees with the recorded `outcome` on every trace in the repository is a
 * check worth having. `corpus.test.ts` asserts that it does.
 */
export function answerGrade(trace: Trace, question: Question): AnswerGrade {
  if (question.facts.length === 0) return 'ungraded'

  const answer = finalAnswer(trace)
  if (answer.trim() === '') return 'failure'

  const hits = question.facts.filter((fact) => has(answer, fact.text)).length
  if (hits === 0) return 'failure'
  if (hits < question.facts.length || anyToolFailed(trace)) return 'partial'
  return 'success'
}

/**
 * A search match arrives as a file, a line number and the line — all three at
 * once — so a fact is read if it is in the line OR in the path that line came
 * from. The first version of this checked only the line, and called the file
 * fact unsupported in a run that had read the very line that answers it. The
 * fixture that caught it is in `grade.test.ts`; the real traces did not,
 * because in this corpus the path is also written out inside other lines.
 */
function supportFor(text: string, observations: Observation[]): Support {
  if (
    observations.some(
      (o) => o.kind === 'line' && (has(o.text, text) || has(o.file, text)),
    )
  ) {
    return 'read'
  }
  if (observations.some((o) => o.kind === 'path' && has(o.file, text))) {
    return 'named-only'
  }
  return 'unsupported'
}

function sighting(observation: Observation): Sighting {
  return observation.kind === 'line'
    ? { file: observation.file, line: observation.line, text: observation.text }
    : { file: observation.file, line: 0, text: '' }
}

/**
 * Grades a recorded run on three axes at once.
 *
 * The prose axis is the one post 2 built and post 3 could not trust: does the
 * final answer contain the expected strings. The other two read the frames.
 *
 * `unread` is the decision axis. A fact the answer states that appears in no
 * line any tool returned was not read out of this project; it was inferred
 * from a file name, or it came out of the model. Either way the run did not
 * establish it, and the prose grader gave it the same credit as a run that
 * did.
 *
 * `provenance` is the axis post 3 asked for, and its useful value is
 * `undecidable`. When the ground truth and a copy of it arrive in the same
 * result set, the trace does not record which one the model attended to, and
 * no amount of reading it harder will. Saying so is the point. A grader that
 * cannot return "I cannot tell" will return something else instead.
 *
 * The copy rule deliberately over-counts: any line outside the source file
 * that carries the answer's tell counts, whether or not it also names the
 * file. A grader whose errors all run toward "I cannot tell" is one you can
 * act on; one that errs toward "grounded" is the thing this post exists to
 * complain about.
 */
export function grade(run: string, trace: Trace, question: Question): Grade {
  const observations = observationsOf(trace)
  const answer = finalAnswer(trace)

  const claims: Claim[] = question.facts.map((fact) => ({
    fact: fact.id,
    text: fact.text,
    inAnswer: has(answer, fact.text),
    support: supportFor(fact.text, observations),
  }))

  const lines = observations.filter((o) => o.kind === 'line')
  const { truthFile, tell } = question

  const truth =
    truthFile !== undefined && tell !== undefined
      ? lines
          .filter((o) => o.file === truthFile && has(o.text, tell))
          .map(sighting)
      : []
  const copies =
    truthFile !== undefined && tell !== undefined
      ? lines
          .filter((o) => o.file !== truthFile && has(o.text, tell))
          .map(sighting)
      : []

  let provenance: Provenance = 'ungradable'
  if (truthFile !== undefined && tell !== undefined) {
    if (truth.length > 0) {
      provenance = copies.length > 0 ? 'undecidable' : 'grounded'
    } else {
      provenance = copies.length > 0 ? 'from-copy' : 'unevidenced'
    }
  }

  return {
    run,
    toolPath: toolPath(trace),
    observations: observations.length,
    recordedOutcome: trace.outcome,
    answer: answerGrade(trace, question),
    claims,
    unread: claims
      .filter((claim) => claim.inAnswer && claim.support !== 'read')
      .map((claim) => claim.fact),
    provenance,
    truth,
    copies,
    finalAnswer: answer.replace(/\s+/g, ' ').trim(),
  }
}
