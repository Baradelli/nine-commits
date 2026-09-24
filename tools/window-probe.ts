import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { MODEL_NAME } from '../agent/src/config.ts'
import { pathToFileURL } from 'node:url'

/**
 * How big is the window, actually?
 *
 * Post 7 turns on a claim about a limit, and the limit is the one number in it
 * that could not be looked up honestly: a model card is documentation, and this
 * series' rule is that a number has to come from an artifact. So it is measured
 * the only way a client can measure it — by sending a request that is too big
 * and reading what comes back.
 *
 *   npm run window -- 300000     # ~300k tokens of filler
 *
 * A request that exceeds the input limit is rejected **before inference**, with
 * `code: "context_length_exceeded"`, and is not billed. A request that fits is
 * billed in full, so bisecting downwards from a rejection is free; the first
 * acceptance is the only thing that costs anything, at the input rate of $0.25
 * per million — 0.025 cents per thousand tokens, so about seven cents for the
 * 266,684-token acceptance below. Run it downwards.
 *
 * What it produced on 2026-09-24 against `gpt-5-mini`:
 *
 *   1,200,015 chars  ->  ACCEPTED, provider counted 266,684 input tokens
 *   1,224,000 chars  ->  REJECTED, context_length_exceeded
 *
 * So the wall is between those two, and `MEASURED_MODEL_WINDOW` in
 * `agent/src/context.ts` is the lower one — the largest context this program
 * has evidence the model will take, rather than the smallest one it has
 * evidence it will not.
 */
const TOKENS_PER_LINE = 45 / 4
const LINE = 'the quick brown fox jumps over the lazy dog. '

async function main(): Promise<void> {
  const target = Number(process.argv[2] ?? 300_000)
  if (!Number.isFinite(target) || target <= 0) {
    console.error('usage: npm run window -- <approximate token count>')
    process.exit(1)
  }

  const filler = LINE.repeat(Math.ceil(target / TOKENS_PER_LINE))
  console.error(
    `[window] sending ~${target} tokens (${filler.length} characters) to ${MODEL_NAME}`,
  )

  try {
    const result = await generateText({
      model: openai(MODEL_NAME),
      prompt: `${filler}\n\nReply with the single word OK.`,
    })
    console.log('ACCEPTED')
    console.log(`characters sent:      ${filler.length}`)
    console.log(`input tokens counted: ${result.usage?.inputTokens ?? 'unknown'}`)
  } catch (error: unknown) {
    console.log('REJECTED')
    console.log(`characters sent:      ${filler.length}`)
    // The message only. A provider error object can carry request metadata,
    // and this project does not print anything it has not looked at first.
    console.log(
      `provider said:        ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
  }
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
