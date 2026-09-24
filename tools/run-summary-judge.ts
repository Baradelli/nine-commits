import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { askSummaryJudge, checkQuote } from './judge/summary.ts'
import { buildSummaryPanel, REPEATS } from './judge/summary-panel.ts'

/**
 * Puts every compaction summary in post 7's published run to a model judge,
 * nine times each, and writes one row per call.
 *
 *   npm run summary-judge
 *   npm run summary-judge -- --repeats 1        # a pilot
 *
 * Nine repeats, fixed before the first call, for post 5's reason: a model
 * judge is a coin by construction, and one call per case produces a table of
 * verdicts with no way to tell a considered answer from a roll.
 *
 * Two calls at a time. A case here puts a whole run's history in front of the
 * judge — about seventy thousand tokens for the last compaction of a long run —
 * so sequentially this is hours rather than minutes. Concurrency changes the
 * wall clock and nothing else: the cases are independent, each is one request,
 * and no call can see another's answer. Three at a time, while the hundred-run
 * experiment was also going, exhausted the account's tokens-per-minute
 * allowance and the run stopped on a `rate_limit_exceeded` — correctly, since
 * nothing here is retried. Those judgements were discarded and the panel was
 * put again from empty.
 *
 * Nothing is retried. A reply that is not a judgement stops the run.
 */
const CONCURRENCY = 2

const DEFAULT_OUT = join('agent', 'traces', 'summary-judgements.tsv')

const HEADER = [
  'case',
  'repeat',
  'known',
  'verdict',
  'correct',
  'quote_check',
  'confidence',
  'input_tokens',
  'output_tokens',
  'quote',
  'reason',
  'raw',
].join('\t')

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function cell(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  const repeats = Number(flag('repeats') ?? REPEATS)
  const out = flag('out') ?? DEFAULT_OUT
  const panel = buildSummaryPanel()

  if (panel.length === 0) {
    throw new Error(
      'no compaction frames in the published traces — there is nothing to judge',
    )
  }

  mkdirSync(dirname(out), { recursive: true })
  if (!existsSync(out)) appendFileSync(out, `${HEADER}\n`, 'utf8')

  console.error(
    `[judge] ${panel.length} case(s) x ${repeats} repeat(s) = ${panel.length * repeats} call(s)`,
  )

  const jobs = panel.flatMap((summaryCase) =>
    Array.from({ length: repeats }, (_unused, index) => ({
      summaryCase,
      repeat: index + 1,
    })),
  )

  let next = 0
  let done = 0

  async function worker(): Promise<void> {
    for (;;) {
      const job = jobs[next]
      next += 1
      if (job === undefined) return

      const { summaryCase, repeat } = job
      const call = await askSummaryJudge(summaryCase.history, summaryCase.summary)
      const quoteCheck = checkQuote(summaryCase.summary, call.judgement)
      const correct =
        summaryCase.known === undefined
          ? 'n/a'
          : call.judgement.verdict === summaryCase.known
            ? 'yes'
            : 'no'

      appendFileSync(
        out,
        [
          summaryCase.id,
          String(repeat),
          summaryCase.known ?? 'open',
          call.judgement.verdict,
          correct,
          quoteCheck,
          call.judgement.confidence.toFixed(2),
          String(call.inputTokens),
          String(call.outputTokens),
          cell(call.judgement.quote),
          cell(call.judgement.reason),
          cell(call.raw),
        ].join('\t') + '\n',
        'utf8',
      )

      done += 1
      console.error(
        `  [${done}/${jobs.length}] ${summaryCase.id} #${repeat} — ${call.judgement.verdict} ` +
          `(${correct}, quote ${quoteCheck}, confidence ${call.judgement.confidence})`,
      )
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()),
  )

  console.error(`[judge] wrote ${out}`)
}

/*
 * Only run when this file is the process entry point.
 *
 * A module that does its work at import time does that work for anything that
 * imports it for a constant. `tools/context/tally.test.ts` imports two out of
 * `run-context.ts`, and without this guard that made `npm test` start a
 * hundred billed runs on any machine with a key in the environment. Every
 * entry point in the repository carries the guard now, and
 * `tools/entrypoints.test.ts` goes red if one of them loses it.
 */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
