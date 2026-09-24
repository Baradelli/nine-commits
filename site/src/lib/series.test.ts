import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import { PLANNED, SERIES_LENGTH } from './series.ts'

/*
 * `series.ts` against the posts' own frontmatter.
 *
 * Every brief since commit 1 has required `order`, `title` and `thesis` to
 * match byte for byte, and until this file existed the requirement was met by
 * hand. `PLANNED` has one consumer — `site/src/pages/index.astro` — which
 * renders `series.ts`'s thesis for a post that has not been published and the
 * post's own frontmatter for one that has. So a drift between them shows up
 * nowhere: the index reads one, the post reads the other, and both build. In a
 * repository whose standard is "if the prose and the table drift apart,
 * `npm test` says so", this was the last convention held together by care.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const POSTS = join(HERE, '..', 'content', 'posts')

type Frontmatter = { order?: unknown; title?: unknown; thesis?: unknown; commit?: unknown }

function publishedPosts(): { dir: string; data: Frontmatter }[] {
  return readdirSync(POSTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: entry.name,
      data: matter(readFileSync(join(POSTS, entry.name, 'index.mdx'), 'utf8')).data as Frontmatter,
    }))
    .sort((a, b) => Number(a.data.order) - Number(b.data.order))
}

describe('the planned series against the posts that exist', () => {
  it('is nine entries with consecutive orders', () => {
    expect(PLANNED).toHaveLength(SERIES_LENGTH)
    expect(PLANNED.map((post) => post.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('gives every published post the same title and thesis the index prints', () => {
    const posts = publishedPosts()
    expect(posts.length).toBeGreaterThan(0)

    for (const { dir, data } of posts) {
      const planned = PLANNED.find((entry) => entry.order === Number(data.order))
      expect(planned, `no PLANNED entry for ${dir}`).toBeDefined()
      if (planned === undefined) continue

      expect(data.title, `${dir} title`).toBe(planned.title)
      expect(data.thesis, `${dir} thesis`).toBe(planned.thesis)
      expect(data.commit, `${dir} commit tag`).toBe(planned.tag)
    }
  })

  it('has one post per order, with no order used twice', () => {
    const orders = publishedPosts().map((post) => Number(post.data.order))
    expect(new Set(orders).size).toBe(orders.length)
  })
})
