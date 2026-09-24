import { MODEL_NAME } from '../../agent/src/config.ts'

/**
 * A fact the final answer has to carry, in the same form `TRACE_EXPECT` takes
 * — so the prose grade this eval computes is the recorder's grade, not a
 * kinder one invented here.
 */
export type Fact = { id: string; text: string }

/**
 * A graded question.
 *
 * `facts` is what the recorder checks for in the answer. `truthFile` and
 * `tell` are what this eval adds: the one file that actually answers the
 * question, and the string whose presence on a line means that line states
 * the answer. A `tell` inside `truthFile` is the ground truth. The same
 * `tell` anywhere else is a copy of it.
 *
 * A question with no `truthFile` can still be graded on its decisions — did
 * the agent act, did it read what it claimed — but not on provenance, and the
 * report says `ungradable` rather than guessing.
 */
export type Question = {
  id: string
  prompt: string
  facts: readonly Fact[]
  truthFile?: string
  tell?: string
}

/**
 * The same restraint `tools/corpus-reach.ts` adopted, for the same reason.
 *
 * Post 3 measured how many lines in this repository hand over the whole
 * answer in one match, and refused to add another while counting them. This
 * file grades runs against that same corpus, so it does not spell the pair
 * out either: the value is imported from the source of truth rather than
 * restated, and no single line here carries both the path and the value.
 *
 * It is not an exclusion. Nothing about what the agent can read changes; only
 * what this file puts there.
 */
const MODEL_NAME_FILE = 'agent/src/config.ts'

/** Posts 2, 3 and this one all ask this, character for character. */
export const MODEL_NAME_QUESTION: Question = {
  id: 'model-name',
  prompt:
    'Which file in this project sets the model name the agent uses, and what is it set to?',
  facts: [
    { id: 'file', text: MODEL_NAME_FILE },
    { id: 'value', text: MODEL_NAME },
  ],
  truthFile: MODEL_NAME_FILE,
  tell: MODEL_NAME,
}

const BINARY_FILE = 'agent/src/tools/fs.ts'

/**
 * A question this repository answers in exactly one place.
 *
 * The model-name question cannot be graded on provenance in this corpus,
 * because the answer is restated in the agent's own usage string, the README,
 * the plan document and two published posts. This one is the control: at the
 * commit these runs were recorded against, `avif` appears on one line of one
 * file in everything the agent's tools can see. If a run answers with it, the
 * trace says where it came from.
 *
 * Publishing this post puts the extension list into the corpus and retires
 * the control. That is the same trap post 2 and post 3 walked into, and it is
 * disclosed rather than avoided: the run is recorded against a commit that
 * predates the post describing it, and the post is how you check that.
 */
export const BINARY_QUESTION: Question = {
  id: 'binary-extensions',
  prompt:
    'Which file in this project decides that a file is binary and should not be searched, and which file extensions does it list?',
  facts: [
    { id: 'file', text: BINARY_FILE },
    { id: 'value', text: 'avif' },
  ],
  truthFile: BINARY_FILE,
  tell: 'avif',
}

/**
 * Post 1's question, which has no file for an answer.
 *
 * The count of TypeScript files in this project is a number that changes with
 * the checkout — post 1 published two of them and said so. There is no line
 * to point at, so there are no facts to check and no ground truth to trace,
 * and this eval says that rather than inventing one. What is left is the
 * decision axis, and on that axis post 1's run is the whole series in one
 * row: it called nothing, so it observed nothing, so nothing it said was
 * supported by anything.
 */
export const FILE_COUNT_QUESTION: Question = {
  id: 'file-count',
  prompt:
    'Count how many TypeScript files are in this project and tell me the number.',
  facts: [],
}

/**
 * The task the two runs published with post 6 were given.
 *
 * The first question in this series whose corpus is not this repository. The
 * agent at v6 can write, so it may not have the checkout under it; it works in
 * a copy of a small invented project instead, and that copy states each graded
 * value in exactly one file. The contamination posts 2, 3, 4 and 5 all paid
 * for is simply absent here, and it is absent because of a safety rule rather
 * than because anybody solved it.
 *
 * `tell` is `maxBatch`, which is the thing the run was asked to put there. So
 * provenance reads slightly differently on a task that writes: the ground
 * truth is not a line the run had to find, it is a line the run had to create,
 * and a `grounded` verdict means the run observed the state it claims to have
 * produced rather than asserting it.
 */
export const ADD_SETTING_QUESTION: Question = {
  id: 'add-setting',
  prompt: 'Add a maxBatch setting of 250 to this project\u2019s settings.',
  facts: [
    { id: 'file', text: 'config/settings.json' },
    { id: 'value', text: '250' },
  ],
  truthFile: 'config/settings.json',
  tell: 'maxBatch',
}

/**
 * The task the two runs published with post 7 were given.
 *
 * The first question in this series whose corpus is not on this machine at all.
 * The agent searches the English Wikipedia and reads what it finds, so a
 * `truthFile` here is a URL rather than a path — which the observation reader
 * already handles, because a provenance check asks "did this line come back,
 * and where from", and a URL answers that in exactly the shape a path does.
 *
 * `facts` is deliberately thin, and it is the same string the recorder was
 * given. The product of this task is a **file**, and post 6 is the reason: the
 * sentence grade and the file grade disagreed four times in a hundred and
 * fifty, and the file was right every time. So the prose axis here is checking
 * that the run said where it put its answer, and the real grade lives in
 * `tools/context/task.ts`, against the note.
 *
 * `tell` is `1,112,064`, which is on one line of one of the three pages and
 * nowhere else in anything the agent could see. That makes provenance
 * decidable for this question in a way it never was for the model-name
 * question — and post 7 has a paragraph about what it decides, because a
 * compacted run's trace still contains the page the run was made to forget.
 */
export const RESEARCH_QUESTION: Question = {
  id: 'research',
  prompt:
    'Use the web tools to answer three questions and write the answers to notes/research.md, each with the URL it came from.',
  facts: [{ id: 'note', text: 'notes/research.md' }],
  truthFile: 'https://en.wikipedia.org/wiki/UTF-8',
  tell: '1,112,064',
}
