import { describe, it, expect } from 'vitest'
import { DESCRIPTIONS, DEFAULT_STYLE, resolveStyle } from './descriptions.ts'

describe('resolveStyle', () => {
  it('defaults to the precise descriptions', () => {
    expect(resolveStyle({})).toBe(DEFAULT_STYLE)
    expect(resolveStyle({ TOOL_DESCRIPTIONS: '  ' })).toBe(DEFAULT_STYLE)
  })

  it('selects the thin descriptions when asked for them', () => {
    expect(resolveStyle({ TOOL_DESCRIPTIONS: 'thin' })).toBe('thin')
  })

  it('refuses a style it does not know, rather than falling back', () => {
    // A typo that quietly fell back would run the experiment twice with the
    // same descriptions and produce two traces that look like a result.
    expect(() => resolveStyle({ TOOL_DESCRIPTIONS: 'vague' })).toThrow(
      /TOOL_DESCRIPTIONS/,
    )
  })
})

describe('DESCRIPTIONS', () => {
  it('describes both tools in both styles', () => {
    for (const style of ['precise', 'thin'] as const) {
      expect(DESCRIPTIONS[style].list_files.length).toBeGreaterThan(0)
      expect(DESCRIPTIONS[style].search_files.length).toBeGreaterThan(0)
    }
  })

  it('keeps the thin pair honest — true, and short enough to be no help', () => {
    expect(DESCRIPTIONS.thin.list_files).toBe('Lists files.')
    expect(DESCRIPTIONS.thin.search_files).toBe('Searches files.')
  })
})
