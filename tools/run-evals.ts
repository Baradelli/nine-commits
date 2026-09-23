import { pathToFileURL } from 'node:url'
import { POSTS_DIR } from './paths.ts'
import { runSuite, type Result } from './eval/suite.ts'

/**
 * Runs the decision evals over every trace committed in this repository and
 * prints one row per run.
 *
 *   npx tsx tools/run-evals.ts           # check, exit 1 on any mismatch
 *   npx tsx tools/run-evals.ts --tsv     # the same table, as TSV, on stdout
 *
 * The two grade columns are the whole argument. `answer` is the recorder's
 * check — do the expected strings appear in the final sentence. `provenance`
 * is what the frames say about where that sentence could have come from.
 * Wherever those two columns disagree, the prose was not the evidence.
 */

export const HEADER = [
  'run',
  'tools_called',
  'observations',
  'recorded_outcome',
  'answer_grade',
  'unread_claims',
  'provenance',
  'ground_truth_sightings',
  'copy_sightings',
  'final_answer',
].join('\t')

export function toRow(result: Result): string {
  const g = result.grade
  return [
    g.run,
    g.toolPath.join(' ') || 'none',
    String(g.observations),
    g.recordedOutcome,
    g.answer,
    g.unread.join(' ') || '-',
    g.provenance,
    String(g.truth.length),
    String(g.copies.length),
    g.finalAnswer,
  ].join('\t')
}

function main(): void {
  const tsv = process.argv.includes('--tsv')
  const results = runSuite(POSTS_DIR)

  if (tsv) {
    console.log([HEADER, ...results.map(toRow)].join('\n'))
  } else {
    for (const result of results) {
      const g = result.grade
      console.log(
        `${g.run}\n` +
          `  tools        ${g.toolPath.join(' > ') || '(none called)'}\n` +
          `  observations ${g.observations}\n` +
          `  answer       ${g.answer} (recorded: ${g.recordedOutcome})\n` +
          `  unread       ${g.unread.join(', ') || '(none)'}\n` +
          `  provenance   ${g.provenance} ` +
          `(${g.truth.length} ground truth, ${g.copies.length} copies)`,
      )
      for (const mismatch of result.mismatches) {
        console.log(`  MISMATCH     ${mismatch}`)
      }
    }
  }

  const failed = results.filter((result) => result.mismatches.length > 0)
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${results.length} case(s) no longer match their recorded verdict:`,
    )
    for (const result of failed) {
      for (const mismatch of result.mismatches) {
        console.error(`  ${result.grade.run}: ${mismatch}`)
      }
    }
    process.exit(1)
  }

  if (!tsv) console.error(`\n${results.length} case(s) match.`)
}

// Only as a CLI entrypoint, never on import, so the tests can exercise the
// suite without a process.exit.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
