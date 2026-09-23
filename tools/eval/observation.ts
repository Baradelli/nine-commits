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
