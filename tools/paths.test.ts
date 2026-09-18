import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { POSTS_DIR, TRACE_FILE, postTracePath } from './paths.ts'

describe('TRACE_FILE', () => {
  it.each(['trace.json', 'trace-a.json', 'trace-b.json', 'trace_2.json'])(
    'accepts %s',
    (name) => {
      expect(TRACE_FILE.test(name)).toBe(true)
    },
  )

  it.each([
    'traces.md',
    'trace.json.bak',
    'index.mdx',
    'cover.png',
    'atrace.json',
    'trace/../x.json',
  ])('rejects %s', (name) => {
    expect(TRACE_FILE.test(name)).toBe(false)
  })
})

// A9 — `record-trace.ts` interpolated an unvalidated slug straight into a
// write path. It is a local tool, so this is not an exposure, but a slug
// carrying `..` writes outside the content collection entirely and the guard
// costs nothing.
describe('postTracePath', () => {
  it('builds the default path for a slug', () => {
    expect(postTracePath('why-this-is-not-an-agent')).toBe(
      join(POSTS_DIR, 'why-this-is-not-an-agent', 'trace.json'),
    )
  })

  // A5 — the recorder hardcoded `trace.json`, so producing the second trace
  // of a compare-style post required hand-writing the file, which is exactly
  // the scenario the leak gate exists for.
  it('accepts an alternate trace file name', () => {
    expect(postTracePath('compare-post', 'trace-b.json')).toBe(
      join(POSTS_DIR, 'compare-post', 'trace-b.json'),
    )
  })

  it.each([
    ['parent traversal', '..'],
    ['embedded traversal', 'a/../../b'],
    ['posix separator', 'a/b'],
    ['windows separator', 'a\\b'],
    ['absolute posix path', '/etc'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('rejects a slug with %s', (_label, slug) => {
    expect(() => postTracePath(slug)).toThrow(/slug/)
  })

  it.each([
    ['a non-trace name', 'index.mdx'],
    ['a traversal', '../trace.json'],
    ['a separator', 'sub/trace.json'],
  ])('rejects %s as an output file name', (_label, name) => {
    expect(() => postTracePath('ok-slug', name)).toThrow(/trace/)
  })
})
