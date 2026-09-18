import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTraces } from './validate-traces.ts'

// A Windows home-directory path with single backslashes — the exact shape
// that JSON.stringify(trace) would double-escape into `C:\\Users\\User`,
// which a single-backslash home-path regex then fails to match. This is
// the leak that would slip through record-trace's redaction *and* through
// a hand-edit bypassing it entirely, which is the one case validate-traces
// exists to catch.
//
// Deliberately fictitious and distinct from this machine's real home
// directory: the fixture trace.json files live under `os.tmpdir()`, which
// on Windows is itself nested under the real home directory, so using the
// real home dir here would make the failure message's own file path
// collide with the "leaked value" the last test asserts is absent.
const HOME_DIR = 'D:\\Users\\someone-else'
const LEAKED_PATH = `${HOME_DIR}\\secret.ts`
const opts = { homeDir: HOME_DIR, denyList: [] }

function writeTrace(postsDir: string, slug: string, trace: unknown): void {
  const dir = join(postsDir, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'trace.json'), JSON.stringify(trace, null, 2), 'utf8')
}

function writeRaw(postsDir: string, slug: string, raw: string): void {
  const dir = join(postsDir, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'trace.json'), raw, 'utf8')
}

const cleanTrace = {
  id: 'clean',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'a harmless task',
  outcome: 'partial' as const,
  tokens: [0, 1],
  frames: [
    { type: 'user' as const, content: 'hi' },
    { type: 'assistant' as const, content: 'hello' },
  ],
}

const leakingTrace = {
  id: 'leaking',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: `note: ${LEAKED_PATH}`,
  outcome: 'partial' as const,
  tokens: [0, 1],
  frames: [
    { type: 'user' as const, content: 'hi' },
    { type: 'assistant' as const, content: `see ${LEAKED_PATH}` },
  ],
}

describe('validateTraces', () => {
  let postsDir: string

  beforeEach(() => {
    postsDir = mkdtempSync(join(tmpdir(), 'nc-validate-'))
  })

  afterEach(() => {
    rmSync(postsDir, { recursive: true, force: true })
  })

  it('exits (would exit) non-zero for a structurally invalid trace', () => {
    writeRaw(postsDir, 'bad', JSON.stringify({ id: 'x' }))

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('bad')
  })

  it('exits (would exit) non-zero for a trace that leaks a home path', () => {
    writeTrace(postsDir, 'leaking', leakingTrace)

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('home-path')
  })

  it('exits (would exit) 0 for a clean tree of valid, non-leaking traces', () => {
    writeTrace(postsDir, 'clean', cleanTrace)

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(0)
  })

  it('never prints the leaked value itself, only the label and the path', () => {
    writeTrace(postsDir, 'leaking', leakingTrace)

    const result = validateTraces(postsDir, opts)
    const message = result.failures.join('\n')

    expect(message).toContain('home-path')
    expect(message).not.toContain(LEAKED_PATH)
    expect(message).not.toContain(HOME_DIR)
  })
})
