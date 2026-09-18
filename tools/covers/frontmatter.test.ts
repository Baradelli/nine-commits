import { describe, it, expect } from 'vitest'
import { parseCoverFrontmatter } from './frontmatter.ts'

const valid = {
  order: 1,
  title: 'An LLM Is Not an Agent',
  thesis: 'Without a loop, it is a chatbot.',
}

describe('parseCoverFrontmatter', () => {
  it('returns the validated fields when frontmatter is well-formed', () => {
    expect(parseCoverFrontmatter(valid, 'site/src/content/posts/01-llm-not-agent')).toEqual({
      order: 1,
      title: 'An LLM Is Not an Agent',
      thesis: 'Without a loop, it is a chatbot.',
    })
  })

  it('throws naming the post directory and the missing order field', () => {
    const { order, ...rest } = valid
    expect(() => parseCoverFrontmatter(rest, 'site/src/content/posts/broken-post')).toThrow(
      /site\/src\/content\/posts\/broken-post[\s\S]*"order"/,
    )
  })

  it('throws when order is zero or negative', () => {
    expect(() => parseCoverFrontmatter({ ...valid, order: 0 }, 'posts/x')).toThrow(/"order"/)
    expect(() => parseCoverFrontmatter({ ...valid, order: -3 }, 'posts/x')).toThrow(/"order"/)
  })

  it('throws when order is not an integer', () => {
    expect(() => parseCoverFrontmatter({ ...valid, order: 1.5 }, 'posts/x')).toThrow(/"order"/)
  })

  it('throws when order is not a number at all', () => {
    expect(() => parseCoverFrontmatter({ ...valid, order: '1' }, 'posts/x')).toThrow(/"order"/)
  })

  it('throws naming the post directory and the missing title field', () => {
    const { title, ...rest } = valid
    expect(() => parseCoverFrontmatter(rest, 'site/src/content/posts/broken-post')).toThrow(
      /site\/src\/content\/posts\/broken-post[\s\S]*"title"/,
    )
  })

  it('throws when title is an empty or whitespace-only string', () => {
    expect(() => parseCoverFrontmatter({ ...valid, title: '' }, 'posts/x')).toThrow(/"title"/)
    expect(() => parseCoverFrontmatter({ ...valid, title: '   ' }, 'posts/x')).toThrow(/"title"/)
  })

  it('throws naming the post directory and the missing thesis field', () => {
    const { thesis, ...rest } = valid
    expect(() => parseCoverFrontmatter(rest, 'site/src/content/posts/broken-post')).toThrow(
      /site\/src\/content\/posts\/broken-post[\s\S]*"thesis"/,
    )
  })

  it('throws when thesis is an empty or whitespace-only string', () => {
    expect(() => parseCoverFrontmatter({ ...valid, thesis: '' }, 'posts/x')).toThrow(/"thesis"/)
    expect(() => parseCoverFrontmatter({ ...valid, thesis: '   ' }, 'posts/x')).toThrow(/"thesis"/)
  })
})
