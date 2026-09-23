import { statSync } from 'node:fs'
import { join } from 'node:path'

/** The trace a post's cover quotes when its frontmatter declares nothing. */
export const DEFAULT_COVER_TRACE = 'trace.json'

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The trace file whose opening assistant line the cover prints.
 *
 * This used to be "whichever trace file sorts first", which made the card's
 * quoted line a function of a file name rather than of a decision. Post 03
 * already paid for it: a second trace added as an exhibit had to be named
 * `trace2-corpus-hit.json` rather than `trace-b-corpus-hit.json`, because the
 * latter sorts before `trace.json` and would have silently repointed the cover
 * at the wrong run. Post 09 ships two branches of one recorded run by design,
 * so the next post to trip it was already written.
 *
 * A post now says which trace its cover quotes, and a post that says nothing
 * gets `trace.json`. There is no fallback: a declared trace that is not on
 * disk fails the render rather than quietly resolving to some other run,
 * because a cover built from the wrong trace is not a visible failure — it is
 * a true-looking sentence attributed to a run that did not produce it.
 */
export function resolveCoverTrace(postDir: string, coverTrace: string | undefined): string {
  const name = coverTrace ?? DEFAULT_COVER_TRACE
  const path = join(postDir, name)
  if (isFile(path)) return path

  throw new Error(
    coverTrace === undefined
      ? `${postDir}: no ${DEFAULT_COVER_TRACE} to build the cover from — add one, or name the trace the cover should quote in the post's "coverTrace" frontmatter`
      : `${postDir}: "coverTrace" names ${name}, which is not a file in the post directory`,
  )
}
