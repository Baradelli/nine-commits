import { TRACE_FILE } from '../paths.ts'

/** The subset of a post's frontmatter that a cover is built from. */
export type CoverFrontmatter = {
  order: number
  title: string
  thesis: string
  /** Which trace the cover quotes; `undefined` means the default, `trace.json`. */
  coverTrace?: string
}

/**
 * Validates the frontmatter fields a cover needs before any rendering
 * happens. Frontmatter comes from hand-edited YAML — a missing or malformed
 * field must fail loudly, naming the post directory and the field, rather
 * than silently coercing to `NaN` / `"undefined"` and writing a bad PNG.
 */
export function parseCoverFrontmatter(data: Record<string, unknown>, postDir: string): CoverFrontmatter {
  const order = data.order
  if (typeof order !== 'number' || !Number.isInteger(order) || order <= 0) {
    throw new Error(
      `${postDir}: invalid frontmatter — "order" must be a positive integer, got ${JSON.stringify(order)}`,
    )
  }

  const title = data.title
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error(
      `${postDir}: invalid frontmatter — "title" must be a non-empty string, got ${JSON.stringify(title)}`,
    )
  }

  const thesis = data.thesis
  if (typeof thesis !== 'string' || thesis.trim().length === 0) {
    throw new Error(
      `${postDir}: invalid frontmatter — "thesis" must be a non-empty string, got ${JSON.stringify(thesis)}`,
    )
  }

  const coverTrace = data.coverTrace
  if (coverTrace !== undefined) {
    // Validated here rather than at the point of use so that a typo fails
    // before any rendering starts, in the same voice as every other field,
    // and so the name can never address a file outside the post directory.
    if (
      typeof coverTrace !== 'string' ||
      !TRACE_FILE.test(coverTrace) ||
      coverTrace.includes('..')
    ) {
      throw new Error(
        `${postDir}: invalid frontmatter — "coverTrace" must name a trace file in this post directory, such as trace.json or trace-b.json, got ${JSON.stringify(coverTrace)}`,
      )
    }
    return { order, title, thesis, coverTrace }
  }

  return { order, title, thesis }
}
