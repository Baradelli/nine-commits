import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { parseTrace } from '../trace/schema.ts'
import { grade, type Grade, type Provenance, type AnswerGrade } from './grade.ts'
import {
  BINARY_QUESTION,
  FILE_COUNT_QUESTION,
  MODEL_NAME_QUESTION,
  type Question,
} from './question.ts'

/**
 * One committed trace, the question it was answering, and what this eval says
 * about it.
 *
 * The expectations are a golden record, not a target. They were written down
 * as predictions, from reading the traces, before the grader was run over
 * them; all seven matched on the first run and none has been adjusted since.
 * That ordering is stated because the opposite ordering — run it, then write
 * down whatever it said — makes a suite that cannot disagree with anything,
 * and one of these rows disagrees with the grade a published post shipped.
 *
 * The eighth row arrived with post 5, and it keeps that ordering in an
 * unusual way: post 4 printed its expectation, in prose, before the run
 * existed. It said publishing would put a copy of that question's answer into
 * the corpus, and that "the next run to ask that question gets a copy back
 * alongside the source and an `undecidable` with it". That run is in the tree
 * now, and so is the verdict.
 *
 * What they buy is a gate. A trace that changes, a grader that changes, or a
 * question whose corpus moves underneath it makes one of these rows stop
 * matching, and `npm test` says which. That is the only thing an offline eval
 * over recorded runs can gate: not whether the agent is good, but whether the
 * story told about a specific recorded run is still true of the file in the
 * tree.
 */
export type Case = {
  post: string
  file: string
  question: Question
  expect: {
    answer: AnswerGrade
    provenance: Provenance
    /** Facts the answer states that no tool result carries. */
    unread: string[]
  }
  /** Why this row is here, in one line. */
  note: string
}

export const CASES: readonly Case[] = [
  {
    post: '01-not-an-agent',
    file: 'trace.json',
    question: FILE_COUNT_QUESTION,
    expect: { answer: 'ungraded', provenance: 'ungradable', unread: [] },
    note: 'no tools existed, so there is nothing to grade but the absence',
  },
  {
    post: '02-hands',
    file: 'trace-a-precise.json',
    question: MODEL_NAME_QUESTION,
    expect: { answer: 'partial', provenance: 'unevidenced', unread: ['file'] },
    note: 'recorded partial; the one fact it was credited with came from a file name',
  },
  {
    post: '02-hands',
    file: 'trace-b-thin.json',
    question: MODEL_NAME_QUESTION,
    expect: { answer: 'failure', provenance: 'unevidenced', unread: [] },
    note: 'searched once, matched nothing, claimed nothing',
  },
  {
    post: '03-the-loop',
    file: 'trace.json',
    question: MODEL_NAME_QUESTION,
    expect: { answer: 'success', provenance: 'undecidable', unread: [] },
    note: "the loop's demonstration run; the answer key is the third match in its own results",
  },
  {
    post: '03-the-loop',
    file: 'trace2-corpus-hit.json',
    question: MODEL_NAME_QUESTION,
    expect: { answer: 'success', provenance: 'undecidable', unread: [] },
    note: 'the documented corpus hit; same verdict, and the same final answer, as the run above',
  },
  {
    post: '04-does-it-work',
    file: 'trace-a-model-name.json',
    question: MODEL_NAME_QUESTION,
    expect: { answer: 'success', provenance: 'undecidable', unread: [] },
    note: 'the same question at v4, and the same undecidable verdict a commit later',
  },
  {
    post: '04-does-it-work',
    file: 'trace-b-binary.json',
    question: BINARY_QUESTION,
    expect: { answer: 'success', provenance: 'grounded', unread: [] },
    note: 'a question the corpus answers in one place, so the trace can say where the answer came from',
  },
  {
    post: '05-moving-target',
    file: 'trace-retired-control.json',
    question: BINARY_QUESTION,
    expect: { answer: 'success', provenance: 'undecidable', unread: [] },
    note: "the same question again, after publishing put post 4's own answer into the corpus",
  },
]

export type Result = {
  case: Case
  grade: Grade
  mismatches: string[]
}

export function loadTrace(postsDir: string, testCase: Case) {
  const path = join(postsDir, testCase.post, testCase.file)
  return parseTrace(JSON.parse(readFileSync(path, 'utf8')))
}

export function checkCase(postsDir: string, testCase: Case): Result {
  const name = `${testCase.post}/${testCase.file}`
  const result = grade(name, loadTrace(postsDir, testCase), testCase.question)
  const mismatches: string[] = []

  if (result.answer !== testCase.expect.answer) {
    mismatches.push(
      `answer: expected ${testCase.expect.answer}, got ${result.answer}`,
    )
  }
  if (result.provenance !== testCase.expect.provenance) {
    mismatches.push(
      `provenance: expected ${testCase.expect.provenance}, got ${result.provenance}`,
    )
  }
  const unread = [...result.unread].sort().join(',')
  const expectedUnread = [...testCase.expect.unread].sort().join(',')
  if (unread !== expectedUnread) {
    mismatches.push(
      `unread: expected [${expectedUnread}], got [${unread}]`,
    )
  }

  return { case: testCase, grade: result, mismatches }
}

export function runSuite(postsDir: string = POSTS_DIR): Result[] {
  return CASES.map((testCase) => checkCase(postsDir, testCase))
}
