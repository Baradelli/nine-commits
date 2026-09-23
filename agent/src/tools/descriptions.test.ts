import { describe, it, expect } from 'vitest'
import {
  DESCRIPTIONS,
  DEFAULT_STYLE,
  resolveStyle,
  type ToolName,
} from './descriptions.ts'

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
  it('describes every tool in both styles', () => {
    for (const style of ['precise', 'thin'] as const) {
      for (const name of Object.keys(DESCRIPTIONS.precise) as ToolName[]) {
        expect(DESCRIPTIONS[style][name].length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the thin set honest — true, and short enough to be no help', () => {
    expect(DESCRIPTIONS.thin.list_files).toBe('Lists files.')
    expect(DESCRIPTIONS.thin.search_files).toBe('Searches files.')
    expect(DESCRIPTIONS.thin.read_file).toBe('Reads a file.')
  })

  it('does not describe the fifth tool worse than the four it is added to', () => {
    // The comparison this commit runs is only about the roster. A fifth tool
    // with a thinner description than its neighbours would be measuring post
    // 2's variable again, and calling the result this post's.
    const four = ['list_files', 'read_file', 'write_file', 'edit_file'] as const
    const shortest = Math.min(...four.map((n) => DESCRIPTIONS.precise[n].length))
    expect(DESCRIPTIONS.precise.append_file.length).toBeGreaterThanOrEqual(
      Math.round(shortest * 0.8),
    )
    // Every precise description says what its tool cannot do.
    for (const name of [...four, 'append_file'] as const) {
      expect(DESCRIPTIONS.precise[name]).toMatch(/cannot/)
    }
  })
})
