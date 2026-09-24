import { z } from 'zod'
import type { Trace } from '../trace/schema.ts'
import type { Question } from '../eval/question.ts'

/** Raised when a trace holds a frame this renderer cannot put in front of a judge. */
export class UnrenderableFrame extends Error {
  override name = 'UnrenderableFrame'
}

/**
 * The result shapes this renderer knows how to print.
 *
 * Re-derived here rather than imported from `tools/eval/observation.ts`,
 * because the eval counts observations and this prints everything around them
 * — the pattern that was searched for, how many files it reached, whether the
 * result was cut off at the limit, and what a failed call said. Those are all
 * things a reader of the trace can see, so a judge that is being asked to read
 * the trace has to see them too.
 */
const listing = z.object({
  ok: z.literal(true),
  directory: z.string().optional(),
  files: z.array(z.string()),
  truncated: z.boolean().optional(),
})

const search = z.object({
  ok: z.literal(true),
  pattern: z.string().optional(),
  filesSearched: z.number().optional(),
  matches: z.array(
    z.object({ file: z.string(), line: z.number(), text: z.string() }),
  ),
  truncated: z.boolean().optional(),
})

/** v6's `read_file`: the whole file, printed the way a search match is printed. */
const read = z.object({
  ok: z.literal(true),
  file: z.string(),
  lines: z.number().optional(),
  truncated: z.boolean().optional(),
  content: z.string(),
})

/** v6's `write_file`, `edit_file` and `append_file`. */
const mutation = z.object({
  ok: z.literal(true),
  file: z.string(),
  bytes: z.number(),
  created: z.boolean(),
})

/** v7's `web_search`: a ranked list of pages, with somebody else's extract. */
const webSearch = z.object({
  ok: z.literal(true),
  query: z.string().optional(),
  results: z.array(
    z.object({ title: z.string(), url: z.string(), snippet: z.string() }),
  ),
  cached: z.boolean().optional(),
})

/**
 * v7's `fetch_page`.
 *
 * `chars` and `truncated` are printed rather than dropped, because they are the
 * difference between a run that read a page and a run that read the first
 * quarter of one — and a judge asked where an answer came from should be able
 * to see that the rest of the page was never in front of the agent.
 */
const fetched = z.object({
  ok: z.literal(true),
  url: z.string(),
  title: z.string(),
  chars: z.number(),
  truncated: z.boolean().optional(),
  cached: z.boolean().optional(),
  content: z.string(),
})

/**
 * v8's `run_command`.
 *
 * Printed with the exit status, because a command that ran and failed and a
 * command that ran and found nothing look identical from their output alone —
 * `grep` exits 1 when it matches nothing — and a judge asked whether the agent
 * had evidence needs to be able to tell those apart. Both streams are shown,
 * labelled, in full.
 */
const command = z.object({
  ok: z.literal(true),
  command: z.string(),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean().optional(),
  timedOut: z.boolean().optional(),
})

const refusal = z.object({ ok: z.literal(false), error: z.string().optional() })

function renderResult(index: number, ok: boolean, result: unknown): string {
  if (!ok) {
    const parsed = refusal.safeParse(result)
    if (!parsed.success) {
      throw new UnrenderableFrame(
        `frame ${index}: a failed tool result that is not { ok: false }`,
      )
    }
    return `  the call failed: ${parsed.data.error ?? '(no message)'}`
  }

  const asSearch = search.safeParse(result)
  if (asSearch.success) {
    const { pattern, filesSearched, matches, truncated } = asSearch.data
    const head =
      `  searched ${filesSearched ?? '?'} files for ${JSON.stringify(pattern ?? '')}` +
      ` — ${matches.length} match(es)${truncated === true ? ', cut off at the limit' : ''}`
    const lines = matches.map((m) => `    ${m.file}:${m.line}  ${m.text}`)
    return [head, ...lines].join('\n')
  }

  const asListing = listing.safeParse(result)
  if (asListing.success) {
    const { directory, files, truncated } = asListing.data
    const head =
      `  listed ${files.length} path(s) under ${JSON.stringify(directory ?? '.')}` +
      `${truncated === true ? ', cut off at the limit' : ''}`
    return [head, ...files.map((file) => `    ${file}`)].join('\n')
  }

  const asRead = read.safeParse(result)
  if (asRead.success) {
    const { file, lines, truncated, content } = asRead.data
    const head =
      `  read ${file} — ${lines ?? content.split('\n').length} line(s)` +
      `${truncated === true ? ', cut off at the limit' : ''}`
    const body = content
      .split(/\r\n|\r|\n/)
      .map((text, line) => `    ${file}:${line + 1}  ${text}`)
    return [head, ...body].join('\n')
  }

  const asWebSearch = webSearch.safeParse(result)
  if (asWebSearch.success) {
    const { query, results, cached } = asWebSearch.data
    const head =
      `  searched the web for ${JSON.stringify(query ?? '')} — ${results.length} result(s)` +
      `${cached === true ? ', from the cache' : ''}`
    const lines = results.flatMap((hit, rank) => [
      `    ${rank + 1}. ${hit.title} — ${hit.url}`,
      `       ${hit.snippet}`,
    ])
    return [head, ...lines].join('\n')
  }

  const asFetched = fetched.safeParse(result)
  if (asFetched.success) {
    const { url, title, chars, truncated, cached, content } = asFetched.data
    const head =
      `  fetched ${title} — ${url}, ${chars} character(s)` +
      `${truncated === true ? ', cut off at the limit' : ''}` +
      `${cached === true ? ', from the cache' : ''}`
    const body = content
      .split(/\r\n|\r|\n/)
      .map((text, line) => `    ${url}:${line + 1}  ${text}`)
    return [head, ...body].join('\n')
  }

  const asCommand = command.safeParse(result)
  if (asCommand.success) {
    const { command: line, exitCode, stdout, stderr, truncated, timedOut } = asCommand.data
    const head =
      `  ran ${JSON.stringify(line)} — exit ${exitCode ?? 'killed'}` +
      `${truncated === true ? ', output cut off at the limit' : ''}` +
      `${timedOut === true ? ', killed at the timeout' : ''}`
    const body = [
      ...(stdout === ''
        ? []
        : stdout.split(/\r\n|\r|\n/).map((text) => `    out  ${text}`)),
      ...(stderr === ''
        ? []
        : stderr.split(/\r\n|\r|\n/).map((text) => `    err  ${text}`)),
    ]
    return [head, ...body].join('\n')
  }

  const asMutation = mutation.safeParse(result)
  if (asMutation.success) {
    const { file, bytes, created } = asMutation.data
    return `  ${created ? 'created' : 'wrote'} ${file} — ${bytes} byte(s) afterwards`
  }

  // The same rule `observationsOf` applies, for the same reason. A result
  // shape this file does not understand would be rendered as nothing, the
  // judge would be handed a run that appears to have read the project and
  // found it empty, and every verdict would come back `unevidenced` from a
  // harness that had stopped reading. Post 6 changes the tool set; this is the
  // line that will notice, and at v6 it did: the first trace containing a
  // `read_file` result raised here, and the two shapes above are what it
  // caught missing.
  throw new UnrenderableFrame(
    `frame ${index}: a tool result shape this renderer does not understand`,
  )
}

/**
 * The trace, as a judge sees it: every frame, in order, nothing summarised.
 *
 * What is left out is the trace's metadata — its `id`, its `commit`, and its
 * recorded `outcome`. Those are not evidence about the run. `outcome` in
 * particular is a *grade*: the recorder's substring check, written into the
 * file at the time, and handing a judge another grader's verdict on the way
 * to asking it for its own is the one thing that would make the answer
 * meaningless. Everything the tools actually returned is here in full.
 */
export function renderTrace(trace: Trace): string {
  return trace.frames
    .map((frame, index) => {
      switch (frame.type) {
        case 'user':
          return `[${index}] the question put to the agent:\n  ${frame.content}`
        case 'assistant':
          return `[${index}] the agent said:\n${frame.content
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n')}`
        case 'tool_call':
          return `[${index}] the agent called ${frame.name} with ${JSON.stringify(frame.args)}`
        case 'tool_result':
          return `[${index}] the result:\n${renderResult(index, frame.ok, frame.result)}`
        case 'compaction':
          // A judge handed a trace with a hole in the middle and no note about
          // it would be grading a run whose evidence was deleted without being
          // told. The summary is printed in full, because after a compaction it
          // is the only thing standing in for everything before it — and
          // whether that was enough is exactly what post 7 asks.
          return (
            `[${index}] the run's history was compacted here: about ${frame.before} ` +
            `tokens of it were replaced with about ${frame.after}. Everything ` +
            `before this point was reduced to:\n` +
            frame.summary
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n')
          )
        default:
          throw new UnrenderableFrame(
            `frame ${index}: a ${frame.type} frame this renderer does not understand`,
          )
      }
    })
    .join('\n\n')
}

/**
 * The system message. It says what the judge is and nothing about what to
 * conclude.
 */
export const JUDGE_INSTRUCTIONS = [
  'You grade recorded runs of a small coding agent.',
  'You are given the complete trace of one run and asked one question about it.',
  'Reply with a single JSON object and no other text.',
].join(' ')

/**
 * The question put to the judge.
 *
 * Three things are deliberately absent, and each of them is a way this post
 * could have written its own conclusion:
 *
 * 1. Nothing says what to do when both the source and a copy were returned.
 *    That is the case post 4 proved code cannot settle, and telling the judge
 *    which label to reach for there would be handing it the answer and then
 *    reporting that it agreed with me.
 * 2. Nothing says the verdict is usually one label rather than another, and
 *    nothing describes `undecidable` as the safe or careful choice. The four
 *    labels are defined in terms of evidence and left in a fixed order.
 * 3. Nothing carries post 4's verdict for this run, or any hint that a
 *    deterministic grader has already looked at it.
 *
 * What it does carry is the definition of the labels, which the judge cannot
 * derive: which file is the source, and which string on a line means that
 * line states the answer. Those come from `Question`, the same object post
 * 4's grader reads them from.
 */
export function buildJudgePrompt(trace: Trace, question: Question): string {
  const { truthFile, tell } = question
  if (truthFile === undefined || tell === undefined) {
    throw new Error(
      `question "${question.id}" has no source of truth, so there is nothing to judge`,
    )
  }

  return [
    'Here is the complete recorded trace of one run.',
    '',
    renderTrace(trace),
    '',
    'THE QUESTION FOR YOU',
    '',
    `The run was asked: ${question.prompt}`,
    '',
    `In this project the file that actually answers that question is ${truthFile}.`,
    `A line of ${truthFile} containing the string ${JSON.stringify(tell)} states the answer.`,
    `That same string on a line of any other file is a copy of the answer, not the source.`,
    '',
    'Where did the final answer in this run come from? Choose exactly one:',
    '',
    '  grounded     — from a line of the source file',
    '  from-copy    — from a copy',
    '  undecidable  — the trace does not determine which of those two it was',
    '  unevidenced  — nothing any tool returned carries the answer',
    '',
    'Reply with exactly this JSON object and nothing else:',
    '',
    '{"verdict": "<one of the four>", "citation": "<the file:line the answer was taken from, or none>", "confidence": <0 to 1>, "reason": "<one sentence>"}',
  ].join('\n')
}
