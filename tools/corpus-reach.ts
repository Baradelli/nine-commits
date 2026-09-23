import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * What a run actually read, derived from its recorded trace.
 *
 * Post 3's claim is that the answer to its question sits in this corpus in
 * several places that are not the source — a published post, the agent's own
 * usage string, the README — and that no run answered from any of them. That
 * is a claim about the contents of tool results, which `runs.tsv` does not
 * record, so it has to be read back out of the traces.
 *
 * Committed so the derivation is falsifiable even where the inputs are not.
 * The 21 raw traces behind post 3's table are about a megabyte of repeated
 * listings of this repository and are not in the tree; this file is exactly
 * how their columns were produced, and it runs against any directory of
 * traces, raw or normalized, since the frame shape is the same either way:
 *
 *   npx tsx tools/corpus-reach.ts agent/traces 'tally-\d\d'
 *
 * It writes TSV to stdout.
 *
 * One deliberate restraint. Nothing here spells out the two graded facts on
 * one line, even though matching them literally would be shorter. The whole
 * point of the table is to count places in this repository where a single
 * search match hands over the whole answer, and a tool that adds one more
 * while counting them would be absurd. This is not an exclusion: it changes
 * nothing about what the agent can read, only about what this file puts
 * there.
 */

/** Where published posts live inside the corpus the agent's tools walk. */
const POST_PREFIX = 'site/src/content/posts'

/** The file whose line 1 is the ground truth, and the symbol it exports. */
const SOURCE_OF_TRUTH = 'agent/src/config.ts'
const GROUND_TRUTH = 'MODEL_NAME'

/** Post 2's prose statement of the answer, identified by its opening words. */
const POST_ANSWER = 'The true answer is'

/**
 * The agent's own usage example, which names a path and a value in one
 * string. Matched by shape — a `TRACE_EXPECT` whose value carries both a path
 * separator and a comma — so that the doc comment's placeholder two lines
 * above it does not count, and so that this file does not restate the answer.
 */
const CLI_ANSWER = /TRACE_EXPECT="[^"]*\/[^"]*,/

/**
 * Whether a final answer points at documentation rather than at source.
 *
 * Deliberately generous: anything naming a post, an `.mdx` file, the README
 * or the decisions log counts, because the column exists to be able to come
 * back true. The answers themselves are the last column, so the judgement is
 * checkable rather than taken on trust.
 */
const NAMES_A_DOC = /\.mdx|\bposts?\b|\bblog\b|README|DECISIONS/i

type Match = { file: string; line: number; text: string }
type Frame = {
  type: string
  name?: string
  content?: string
  result?: { matches?: Match[] }
}
export type Trace = { frames: Frame[] }

export type Reach = {
  run: string
  searchCalls: number
  postFiles: string[]
  sawPostAnswer: boolean
  sawCliAnswer: boolean
  sawGroundTruth: boolean
  answerNamesADoc: boolean
  finalAnswer: string
}

export function reachOf(run: string, trace: Trace): Reach {
  const postFiles = new Set<string>()
  let searchCalls = 0
  let sawPostAnswer = false
  let sawCliAnswer = false
  let sawGroundTruth = false

  for (const frame of trace.frames) {
    if (frame.type === 'tool_call' && frame.name === 'search_files') {
      searchCalls += 1
    }
    for (const match of frame.result?.matches ?? []) {
      if (match.file.startsWith(POST_PREFIX)) {
        postFiles.add(match.file)
        if (match.text.includes(POST_ANSWER)) sawPostAnswer = true
      }
      if (match.file.endsWith('cli.ts') && CLI_ANSWER.test(match.text)) {
        sawCliAnswer = true
      }
      if (
        match.file === SOURCE_OF_TRUTH &&
        match.text.includes(GROUND_TRUTH)
      ) {
        sawGroundTruth = true
      }
    }
  }

  const finalAnswer = trace.frames
    .filter((frame) => frame.type === 'assistant')
    .map((frame) => frame.content ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    run,
    searchCalls,
    postFiles: [...postFiles].sort(),
    sawPostAnswer,
    sawCliAnswer,
    sawGroundTruth,
    answerNamesADoc: NAMES_A_DOC.test(finalAnswer),
    finalAnswer,
  }
}

export const HEADER = [
  'run',
  'search_calls',
  'post_files_matched',
  'saw_post2_answer_line',
  'saw_cli_usage_line',
  'saw_config_ts_line',
  'answer_names_a_post',
  'final_answer',
].join('\t')

export function toRow(reach: Reach): string {
  return [
    reach.run,
    String(reach.searchCalls),
    reach.postFiles.join(' ') || '-',
    String(reach.sawPostAnswer),
    String(reach.sawCliAnswer),
    String(reach.sawGroundTruth),
    String(reach.answerNamesADoc),
    reach.finalAnswer,
  ].join('\t')
}

function main(): void {
  const [dir, pattern = ''] = process.argv.slice(2)
  if (dir === undefined) {
    console.error(
      "usage: npx tsx tools/corpus-reach.ts <trace-dir> ['<name-regex>']",
    )
    process.exit(1)
  }

  const select = new RegExp(pattern)
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && select.test(name))
    .sort()

  const rows = names.map((name) =>
    toRow(
      reachOf(
        name.replace(/\.json$/, ''),
        JSON.parse(readFileSync(join(dir, name), 'utf8')) as Trace,
      ),
    ),
  )

  console.log([HEADER, ...rows].join('\n'))
}

// Only as a CLI entrypoint, never on import, so the tests can exercise
// `reachOf` without a filesystem scan or a process.exit.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
