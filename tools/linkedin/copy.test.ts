import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'

/*
 * The one artifact in this repository with no gate on it.
 *
 * Nine posts, nine LinkedIn copies, and every figure in the posts is
 * recomputed from a committed file by a test named after the post. The copies
 * were checked by hand and by eye, and a cold audit of the published series
 * found six of the nine diverging from their post — two of them restating the
 * exact sentence the index had already been corrected to stop saying. That is
 * not a writing problem. It is the same defect this series keeps naming: a
 * claim living somewhere nothing reads it.
 *
 * So this file reads them. It cannot check whether a sentence means what the
 * post means — that is a judgement, and post 4 is the reason not to fake one
 * with a substring rule. What it can check is the narrow, mechanical half:
 *
 * - **Every figure in the copy is a figure the post publishes.** A number in
 *   the shipping copy that is nowhere on the page is a number no reader can
 *   check and no test can defend, whatever its provenance. This is how the
 *   `86 bytes` in post 4's copy was found: true, verified, and stated only
 *   where nothing was looking.
 * - **The character count in the header is the character count of the body.**
 * - **No em dash, no curly quote, no invisible character** — the fingerprint
 *   check the humanizer scores, asserted rather than remembered, because it is
 *   the one part of that score this repository can compute on its own.
 *
 * What it deliberately does not check is the humanizer score itself. That
 * comes from a script outside this repository, and a test that shelled out to
 * it would be a test that passes or fails depending on what is installed. The
 * score in each header is recomputed by hand when the copy changes, and saying
 * so here is better than pretending a green test covers it.
 */

const POSTS = readdirSync(POSTS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

/** The comment block at the top, and everything under it. */
function split(text: string): { header: string; body: string } {
  const match = /^<!--([\s\S]*?)-->\s*/.exec(text)
  return {
    header: match?.[1] ?? '',
    body: text.slice(match?.[0].length ?? 0).trim(),
  }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety',
]

/**
 * How these posts spell a whole number in prose.
 *
 * The posts write small numbers as words and large ones as digits, so a figure
 * that is in the copy as `17` is in the post as `seventeen`. Only the range
 * the posts actually spell out is covered; above it they use digits and the
 * digit match below finds them.
 */
function inWords(value: number): string[] {
  if (!Number.isInteger(value) || value < 0 || value > 100) return []
  if (value === 100) return ['a hundred', 'one hundred']
  if (value < 20) return [ONES[value] ?? '']
  const tens = TENS[Math.floor(value / 10)] ?? ''
  const unit = value % 10
  return unit === 0 ? [tens] : [`${tens}-${ONES[unit] ?? ''}`]
}

/**
 * Every number the copy asserts.
 *
 * `Commit 5 of 9` is the series' own sign-off and says nothing about the post,
 * so the last line is not read. A figure glued to a word — `gpt-5-mini`,
 * `v8-shell` — is a name and not a measurement.
 */
function figures(body: string): string[] {
  const lines = body.split('\n')
  const last = lines.findIndex((line) => /^(Commit \d+ of 9|Series done)\b/.test(line))
  const text = (last === -1 ? lines : lines.slice(0, last)).join('\n')
  return [...text.matchAll(/(?<![\w.-])(\d[\d,]*(?:\.\d+)?)(?![\w-])/g)].map(
    (match) => match[1] ?? '',
  )
}

function publishes(post: string, figure: string): boolean {
  const bare = figure.replace(/,/g, '')
  const stripped = post.replace(/,/g, '')
  if (stripped.includes(bare)) return true
  const asNumber = Number(bare)
  return inWords(asNumber).some((word) => post.toLowerCase().includes(word))
}

describe.each(POSTS)('%s: the LinkedIn copy against the post', (post) => {
  const dir = join(POSTS_DIR, post)
  const { header, body } = split(readFileSync(join(dir, 'linkedin.md'), 'utf8'))
  const page = readFileSync(join(dir, 'index.mdx'), 'utf8')

  it('states no figure the post does not publish', () => {
    const missing = figures(body).filter((figure) => !publishes(page, figure))
    expect(missing).toEqual([])
  })

  it('counts its own characters correctly, if it counts them', () => {
    // Not every header carries the count. The ones that do have to be right:
    // a number in a committed file that nobody recomputed is this series'
    // recurring defect, and this one costs nothing to recompute.
    const claimed = /(\d[\d,]*) characters/.exec(header)?.[1]
    if (claimed === undefined) return
    expect(Number(claimed.replace(/,/g, ''))).toBe(body.length)
  })

  it('carries none of the typography a detector keys on', () => {
    expect(body).not.toMatch(/[—–]/) // em and en dash
    expect(body).not.toMatch(/[‘’“”]/) // curly quotes
    expect(body).not.toMatch(/[…]/) // ellipsis
    expect(body).not.toMatch(/[ ​‌‍﻿]/) // hard and invisible spaces
  })
})
