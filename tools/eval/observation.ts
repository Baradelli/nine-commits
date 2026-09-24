import { z } from 'zod'
import type { Trace } from '../trace/schema.ts'

/**
 * What a tool actually put in front of the model.
 *
 * This is the whole idea of the eval in one type. A trace's `Frame` union
 * already records every decision the agent made; what it does not do is
 * distinguish the two kinds of thing a tool can hand back, and that
 * distinction is the difference between an agent that read something and an
 * agent that guessed from a name:
 *
 * - `path` — a file name from `list_files`. The model learned that a file
 *   exists. It learned nothing about what is inside it.
 * - `line` — a line of file contents from `search_files`, with the file and
 *   line number it came from. The model read something.
 *
 * A substring check over the final answer cannot tell those apart, because by
 * the time the answer is written both are just tokens the model has seen.
 */
export type Observation =
  | { frame: number; tool: string; kind: 'path'; file: string }
  | {
      frame: number
      tool: string
      kind: 'line'
      file: string
      line: number
      text: string
    }

const listing = z.object({
  ok: z.literal(true),
  files: z.array(z.string()),
})

const search = z.object({
  ok: z.literal(true),
  matches: z.array(
    z.object({ file: z.string(), line: z.number(), text: z.string() }),
  ),
})

/**
 * v6's `read_file`. A read hands the model the whole file, so it contributes
 * one `line` observation per line, with real line numbers — because that is
 * what makes a read comparable with a search match. An agent that read
 * `config/settings.json` and an agent that searched and got line 3 of it back
 * have both seen line 3, and a grader that counted only one of them would be
 * reporting a difference between the tool sets that is its own.
 */
const read = z.object({
  ok: z.literal(true),
  file: z.string(),
  lines: z.number(),
  content: z.string(),
})

/**
 * v6's `write_file`, `edit_file` and `append_file`.
 *
 * A mutation puts nothing in front of the model except the fact that it
 * happened, so it yields no observations — and it still has to be recognised.
 * The difference between "no observations because the tool returns none" and
 * "no observations because the reader stopped reading" is the whole reason
 * `UnreadableResult` exists.
 */
const mutation = z.object({
  ok: z.literal(true),
  file: z.string(),
  bytes: z.number(),
  created: z.boolean(),
})

/**
 * v7's `web_search`.
 *
 * A search result is two different things at once and this eval has cared
 * about the difference since post 4. The URL is a name: the model learned that
 * a page exists and nothing about what is in it. The snippet is text: the model
 * read a sentence, chosen by somebody else's ranking, out of that page. So a
 * result contributes one observation of each kind, and the `line` number is the
 * result's rank rather than a line in a document — there is no document yet.
 */
const webSearch = z.object({
  ok: z.literal(true),
  results: z.array(
    z.object({ title: z.string(), url: z.string(), snippet: z.string() }),
  ),
})

/**
 * v7's `fetch_page`.
 *
 * The same treatment `read_file` gets — one `line` observation per line, real
 * line numbers — and for the same reason: a run that fetched the page and a run
 * that was handed the same sentence some other way have both seen the sentence.
 *
 * The `file` of a web observation is its URL. That is a small violation of the
 * field's name and a large improvement on the alternative, which is a second
 * observation kind that every consumer of this type would have to learn about.
 * A provenance check asks "did this line come back, and where from", and a URL
 * answers that question in exactly the same shape a path does.
 */
const fetched = z.object({
  ok: z.literal(true),
  url: z.string(),
  title: z.string(),
  chars: z.number(),
  content: z.string(),
})

/**
 * v8's `run_command`.
 *
 * The same treatment `read_file` and `fetch_page` get — one `line` observation
 * per line of output — and the `file` is the command that produced it, written
 * with a `$` so it cannot be read as a path. Post 7 already put a URL in that
 * field and said why: a provenance check asks *did this text come back, and
 * where from*, and a command line answers that in the same shape a path does.
 * Standard error is a separate source, because a line the model read out of a
 * complaint is not a line it read out of a file, and a grader that merged them
 * would count `no such file or directory` as evidence about the project.
 *
 * A refused command produces `{ ok: false }` and never reaches here, which is
 * right: the model learned that the guard said no, and nothing about the files.
 */
const command = z.object({
  ok: z.literal(true),
  command: z.string(),
  stdout: z.string(),
  stderr: z.string(),
})

const refusal = z.object({ ok: z.literal(false) })

/**
 * Raised when a trace holds a tool result this eval cannot read.
 *
 * Post 1 shipped a leak gate that had never seen a real trace and would have
 * reported success over a leak, because a gate that finds nothing and a gate
 * that is not looking print the same line. The same defect is available here
 * and it is worse: a tool whose result shape this file does not recognise
 * would contribute zero observations, every claim in the answer would grade
 * `unsupported`, and the suite would look like it was working hardest exactly
 * when it had stopped reading. So an unrecognised result is an error, not an
 * empty list.
 *
 * At v6 it fired. The first trace with a `read_file` result in it raised here
 * rather than grading as a run that observed nothing, which is what post 4
 * said this line was for.
 */
export class UnreadableResult extends Error {
  override name = 'UnreadableResult'
}

/**
 * Every observation in a trace, in the order the model received them.
 *
 * Results are paired back to their calls by `id` rather than by position, so
 * the tool that produced an observation is the tool the model actually asked
 * for — and a result with no call is a malformed trace rather than something
 * to skip quietly.
 */
export function observationsOf(trace: Trace): Observation[] {
  const toolById = new Map<string, string>()
  const out: Observation[] = []

  trace.frames.forEach((frame, index) => {
    if (frame.type === 'tool_call') {
      toolById.set(frame.id, frame.name)
      return
    }
    if (frame.type !== 'tool_result') return

    const tool = toolById.get(frame.id)
    if (tool === undefined) {
      throw new UnreadableResult(
        `frame ${index}: tool_result "${frame.id}" has no matching tool_call`,
      )
    }

    if (!frame.ok) {
      if (!refusal.safeParse(frame.result).success) {
        throw new UnreadableResult(
          `frame ${index}: ${tool} failed but did not return { ok: false }`,
        )
      }
      return
    }

    const asSearch = search.safeParse(frame.result)
    if (asSearch.success) {
      for (const match of asSearch.data.matches) {
        out.push({
          frame: index,
          tool,
          kind: 'line',
          file: match.file,
          line: match.line,
          text: match.text,
        })
      }
      return
    }

    const asListing = listing.safeParse(frame.result)
    if (asListing.success) {
      for (const file of asListing.data.files) {
        out.push({ frame: index, tool, kind: 'path', file })
      }
      return
    }

    const asRead = read.safeParse(frame.result)
    if (asRead.success) {
      asRead.data.content.split(/\r\n|\r|\n/).forEach((text, line) => {
        out.push({
          frame: index,
          tool,
          kind: 'line',
          file: asRead.data.file,
          line: line + 1,
          text,
        })
      })
      return
    }

    const asWebSearch = webSearch.safeParse(frame.result)
    if (asWebSearch.success) {
      asWebSearch.data.results.forEach((hit, rank) => {
        out.push({ frame: index, tool, kind: 'path', file: hit.url })
        out.push({
          frame: index,
          tool,
          kind: 'line',
          file: hit.url,
          line: rank + 1,
          text: hit.snippet,
        })
      })
      return
    }

    const asFetched = fetched.safeParse(frame.result)
    if (asFetched.success) {
      asFetched.data.content.split(/\r\n|\r|\n/).forEach((text, line) => {
        out.push({
          frame: index,
          tool,
          kind: 'line',
          file: asFetched.data.url,
          line: line + 1,
          text,
        })
      })
      return
    }

    const asCommand = command.safeParse(frame.result)
    if (asCommand.success) {
      for (const [stream, text] of [
        ['', asCommand.data.stdout],
        [' [stderr]', asCommand.data.stderr],
      ] as const) {
        if (text === '') continue
        text.split(/\r\n|\r|\n/).forEach((line, offset) => {
          out.push({
            frame: index,
            tool,
            kind: 'line',
            file: `$ ${asCommand.data.command}${stream}`,
            line: offset + 1,
            text: line,
          })
        })
      }
      return
    }

    // Recognised, and contributes nothing: a write tells the model that a file
    // changed, not what any file says.
    if (mutation.safeParse(frame.result).success) return

    throw new UnreadableResult(
      `frame ${index}: ${tool} returned a result shape this eval does not understand`,
    )
  })

  return out
}

/** The tools the agent called, in order. The decision, stripped of its prose. */
export function toolPath(trace: Trace): string[] {
  return trace.frames
    .filter((frame) => frame.type === 'tool_call')
    .map((frame) => frame.name)
}

/** The last thing the model actually said — the only part a prose grader reads. */
export function finalAnswer(trace: Trace): string {
  for (let i = trace.frames.length - 1; i >= 0; i -= 1) {
    const frame = trace.frames[i]
    if (frame?.type === 'assistant' && frame.content.trim() !== '') {
      return frame.content
    }
  }
  return ''
}

/** Whether any tool call in the run came back failed. */
export function anyToolFailed(trace: Trace): boolean {
  return trace.frames.some(
    (frame) => frame.type === 'tool_result' && !frame.ok,
  )
}
