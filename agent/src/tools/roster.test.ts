import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROSTERS, DEFAULT_ROSTER, resolveRoster, type Roster } from './roster.ts'
import { buildTools, rosterWrites } from './index.ts'
import { DESCRIPTIONS } from './descriptions.ts'
import { PROJECT_ROOT } from './fs.ts'
import { UnsafeRoot } from './sandbox.ts'

describe('resolveRoster', () => {
  it('defaults to the four', () => {
    expect(resolveRoster({})).toBe(DEFAULT_ROSTER)
    expect(DEFAULT_ROSTER).toBe('four')
    expect(resolveRoster({ AGENT_TOOLS: '  ' })).toBe('four')
  })

  it('selects a five-tool roster when asked for one', () => {
    expect(resolveRoster({ AGENT_TOOLS: 'five-append' })).toBe('five-append')
    expect(resolveRoster({ AGENT_TOOLS: 'five-search' })).toBe('five-search')
  })

  it('refuses a roster it does not know, rather than falling back to four', () => {
    // A typo that quietly fell back would run both conditions of the
    // experiment with the same tool set and produce a table that looks like a
    // result. This is post 2's rule about TOOL_DESCRIPTIONS, one variable on.
    expect(() => resolveRoster({ AGENT_TOOLS: 'five' })).toThrow(/AGENT_TOOLS/)
  })
})

describe('ROSTERS', () => {
  it('is the thesis: list, read, write, edit', () => {
    expect(ROSTERS.four).toEqual([
      'list_files',
      'read_file',
      'write_file',
      'edit_file',
    ])
  })

  it('changes exactly one thing between conditions — one more tool, at the end', () => {
    for (const five of ['five-append', 'five-search'] as const) {
      expect(ROSTERS[five].slice(0, 4)).toEqual(ROSTERS.four)
      expect(ROSTERS[five]).toHaveLength(5)
    }
  })

  it('describes every tool in every roster, in both styles', () => {
    for (const roster of Object.keys(ROSTERS) as Roster[]) {
      for (const name of ROSTERS[roster]) {
        expect(DESCRIPTIONS.precise[name].length).toBeGreaterThan(0)
        expect(DESCRIPTIONS.thin[name].length).toBeGreaterThan(0)
      }
    }
  })
})

describe('buildTools', () => {
  it('hands the model exactly the roster it was given', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'nine-roster-'))
    try {
      expect(Object.keys(buildTools({ root: scratch, roster: 'four' }))).toEqual([
        ...ROSTERS.four,
      ])
      expect(
        Object.keys(buildTools({ root: scratch, roster: 'five-append' })),
      ).toEqual([...ROSTERS['five-append']])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('refuses to build a writing roster against this repository', () => {
    // The whole safety argument in one assertion: there is no argument to
    // buildTools that returns a write tool pointed at the checkout.
    expect(() => buildTools({ roster: 'four' })).toThrow(UnsafeRoot)
    expect(() => buildTools({ root: PROJECT_ROOT, roster: 'five-append' })).toThrow(
      UnsafeRoot,
    )
  })

  it('knows which rosters write', () => {
    expect(rosterWrites('four')).toBe(true)
    expect(rosterWrites('five-append')).toBe(true)
    expect(rosterWrites('five-search')).toBe(true)
  })
})
