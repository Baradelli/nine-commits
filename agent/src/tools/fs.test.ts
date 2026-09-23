import { describe, it, expect } from 'vitest'
import { listFiles, searchFiles, PROJECT_ROOT } from './fs.ts'

describe('listFiles', () => {
  it('finds this file, by a path relative to the project root', () => {
    const result = listFiles('agent')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files).toContain('agent/src/tools/fs.test.ts')
  })

  it('uses forward slashes whatever platform it ran on', () => {
    const result = listFiles('agent')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files.some((file) => file.includes('\\'))).toBe(false)
  })

  it('never lists a dotfile, which is where the one real secret lives', () => {
    const result = listFiles('.')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files).not.toContain('agent/.env')
    expect(result.files.some((file) => file.split('/').some((s) => s.startsWith('.')))).toBe(false)
  })

  it('never lists a dependency or a build artefact', () => {
    const result = listFiles('.')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const skipped = ['node_modules', 'dist', 'test-results', 'playwright-report']
    expect(
      result.files.filter((file) =>
        file.split('/').some((segment) => skipped.includes(segment)),
      ),
    ).toEqual([])
  })

  it('refuses to climb out of the project', () => {
    // v6 moved this check into `sandbox.ts`, so the wording is the guard's.
    expect(listFiles('../..')).toEqual({
      ok: false,
      error: 'refused "../..": resolves outside the sandbox',
    })
  })

  it('refuses an absolute path', () => {
    const result = listFiles(PROJECT_ROOT.slice(0, 3))
    expect(result.ok).toBe(false)
  })

  it('reports truncation rather than silently cutting the list', () => {
    const result = listFiles('.', 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})

describe('searchFiles', () => {
  it('returns the file, the line number and the line for every match', () => {
    const result = searchFiles('MAX_STEPS = ')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const hit = result.matches.find((m) => m.file === 'agent/src/run.ts')
    expect(hit).toBeDefined()
    expect(hit?.text).toContain('MAX_STEPS')
    expect(hit?.line).toBeGreaterThan(0)
  })

  it('never reads a dotfile', () => {
    // A real key is `sk-` followed by a long string; this pattern would match
    // the assignment line in `agent/.env` if that file were ever searchable.
    const result = searchFiles('OPENAI_API_KEY=')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches.map((m) => m.file)).not.toContain('agent/.env')
  })

  it('explains an invalid regular expression instead of throwing', () => {
    const result = searchFiles('([')
    expect(result).toEqual({
      ok: false,
      error: '"([" is not a valid regular expression',
    })
  })

  it('stops at the limit and says so', () => {
    const result = searchFiles('e', 3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })
})
