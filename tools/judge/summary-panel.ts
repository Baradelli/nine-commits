import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { parseTrace, type Trace } from '../trace/schema.ts'
import { compactionsIn, historyBefore, type SummaryVerdict } from './summary.ts'

/**
 * The panel put to the summary judge.
 *
 * Half of it has a known answer and the judge is not told which half: the
 * prompt is identical for every case in this file. That is post 5's rule, and
 * the reason for it is that a judge run only against cases nobody can grade is
 * an oracle — every answer unfalsifiable, and the more confident it sounds the
 * better it looks.
 *
 * The known cases are built by construction out of a real run, in memory.
 * Nothing here is written to disk and no altered summary is ever shown to a
 * reader as something that happened.
 */

export const REPEATS = 9

export type SummaryCase = {
  id: string
  /** Where it came from, for the reader of the tally. */
  source: string
  history: Trace
  summary: string
  /** The answer, where there is one. `undefined` means the judge is the finding. */
  known?: SummaryVerdict
  note: string
}

export const POST = '07-context'

function load(file: string): Trace {
  return parseTrace(JSON.parse(readFileSync(join(POSTS_DIR, POST, file), 'utf8')))
}

/**
 * A summary every claim of which is copied out of the transcript.
 *
 * Known **supported**, by construction rather than by opinion: every sentence
 * is assembled from strings the transcript literally contains — the query the
 * run searched for, the URL it fetched, and one line of the page it got back.
 * If the judge calls this unsupported it has objected to a quotation.
 */
export function verbatimSummary(history: Trace): string {
  const parts: string[] = []

  for (const frame of history.frames) {
    if (frame.type !== 'tool_call') continue
    const args = frame.args as Record<string, unknown>
    if (frame.name === 'web_search' && typeof args.query === 'string') {
      parts.push(`The run searched the web for "${args.query}".`)
    }
    if (frame.name === 'fetch_page' && typeof args.url === 'string') {
      parts.push(`The run fetched ${args.url}.`)
    }
  }

  for (const frame of history.frames) {
    if (frame.type !== 'tool_result' || !frame.ok) continue
    const result = frame.result as { url?: unknown; content?: unknown }
    if (typeof result.url !== 'string' || typeof result.content !== 'string') continue
    const line = result.content
      .split(/\r\n|\r|\n/)
      .find((text) => text.trim().length > 80)
    if (line !== undefined) {
      parts.push(`${result.url} contains this sentence: ${line.trim()}`)
      break
    }
  }

  return parts.join(' ')
}

/**
 * A real summary with one number replaced by one the transcript does not have.
 *
 * Known **unsupported**: the rest of it is untouched, so the prose is
 * identically confident and identically detailed, and exactly one claim is now
 * false. That is the failure mode compaction actually has — not a summary that
 * reads badly, but a summary that reads exactly as well and says something
 * else.
 *
 * Returns `undefined` when the summary carries no number to corrupt, rather
 * than inventing one: a case whose known answer had to be manufactured is not
 * a control.
 */
export function corruptedSummary(summary: string): string | undefined {
  const match = /(?<![\d.,])(\d{2,7})(?![\d.,])/.exec(summary)
  if (match === null) return undefined
  const original = match[1] ?? ''
  // A number of the same length and shape, so the corruption is not visible as
  // a formatting break — and one digit apart, so it is not obviously absurd.
  const digits = original.split('')
  const last = Number(digits[digits.length - 1])
  digits[digits.length - 1] = String((last + 3) % 10)
  const replaced = digits.join('')
  if (replaced === original) return undefined
  return (
    summary.slice(0, match.index) +
    replaced +
    summary.slice(match.index + original.length)
  )
}

/**
 * The panel, built from the committed traces this post ships.
 *
 * `files` is an argument so the panel can be built against a scratch trace in a
 * test without reaching for the published one.
 */
export function buildSummaryPanel(files: readonly string[] = ['trace-b-on.json']): SummaryCase[] {
  const cases: SummaryCase[] = []

  for (const file of files) {
    const trace = load(file)
    const compactions = compactionsIn(trace)

    compactions.forEach((compaction, ordinal) => {
      const history = historyBefore(trace, compaction.index)
      const label = `${file.replace(/\.json$/, '')}-${ordinal + 1}`

      // ---- The open case: a summary this run actually ran on. ----
      cases.push({
        id: `real-${label}`,
        source: `${POST}/${file}, frame ${compaction.index}`,
        history,
        summary: compaction.summary,
        note: `the summary the run continued from, ${compaction.before} tokens down to ${compaction.after}`,
      })

      // ---- The control set: two cases whose answer is not in doubt. ----
      cases.push({
        id: `verbatim-${label}`,
        source: `${POST}/${file}, frame ${compaction.index}, summary rebuilt from quotations`,
        history,
        summary: verbatimSummary(history),
        known: 'supported',
        note: 'every claim copied out of the transcript, so there is nothing to object to',
      })

      const corrupted = corruptedSummary(compaction.summary)
      if (corrupted !== undefined) {
        cases.push({
          id: `corrupted-${label}`,
          source: `${POST}/${file}, frame ${compaction.index}, one number changed`,
          history,
          summary: corrupted,
          known: 'unsupported',
          note: 'the same summary with one number swapped for one the transcript does not contain',
        })
      }
    })
  }

  return cases
}

export function controlCases(panel: readonly SummaryCase[]): SummaryCase[] {
  return panel.filter((item) => item.known !== undefined)
}

export function openCases(panel: readonly SummaryCase[]): SummaryCase[] {
  return panel.filter((item) => item.known === undefined)
}
