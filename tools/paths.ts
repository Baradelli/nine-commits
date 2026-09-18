import { join } from 'node:path'

/**
 * The post content collection root, relative to the repository root.
 *
 * A9 — this was defined independently in `validate-traces.ts` and
 * `make-covers.ts`. Two tools that must agree on where posts live, each with
 * its own copy of the answer, is a divergence waiting for whoever moves the
 * collection: the cover generator would keep working against the old path
 * while the leak gate silently found nothing to check.
 */
export const POSTS_DIR = join('site', 'src', 'content', 'posts')

/**
 * What counts as a trace file inside a post directory.
 *
 * A5 — spec §3.4 allows a post to carry several traces (`trace-a.json`,
 * `trace-b.json`) for the compare-style demos. Shared between the recorder
 * (which writes them) and the validator (which gates them) precisely so the
 * two cannot drift: a name the recorder will happily write but the validator
 * does not recognise is a trace that reaches the public site unscanned.
 *
 * Anchored at both ends, so `traces.md`, `trace.json.bak` and `atrace.json`
 * are not traces.
 */
export const TRACE_FILE = /^trace[A-Za-z0-9._-]*\.json$/

// A9 — `record-trace.ts` interpolated an unvalidated slug straight into a
// write path. It is a local tool, so a traversal here is not an exposure; the
// guard is free and a slug is user input either way.
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Builds the path a recorded trace is written to, rejecting anything that
 * would land outside the post's own directory.
 */
export function postTracePath(slug: string, fileName = 'trace.json'): string {
  if (!SAFE_SLUG.test(slug) || slug.includes('..')) {
    throw new Error(
      'record: slug must be a simple directory name (letters, digits, dot, dash, underscore) with no path separators',
    )
  }
  if (!TRACE_FILE.test(fileName) || fileName.includes('..')) {
    throw new Error(
      'record: output name must be a trace file name such as trace.json or trace-b.json',
    )
  }
  return join(POSTS_DIR, slug, fileName)
}
