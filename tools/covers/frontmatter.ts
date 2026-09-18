/** The subset of a post's frontmatter that a cover is built from. */
export type CoverFrontmatter = {
  order: number
  title: string
  thesis: string
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

  return { order, title, thesis }
}
