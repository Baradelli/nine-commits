import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTraces, resolveHomeDir } from './validate-traces.ts'

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

function writeFile(
  postsDir: string,
  slug: string,
  name: string,
  contents: string,
): void {
  const dir = join(postsDir, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), contents, 'utf8')
}

function writeNamed(
  postsDir: string,
  slug: string,
  name: string,
  trace: unknown,
): void {
  writeFile(postsDir, slug, name, JSON.stringify(trace, null, 2))
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

// A1, second half. The generic `home-shape` rule makes the gate work on any
// machine, but the author may still want the EXACT home directory scanned for
// in CI — it is the only form that catches a home path whose user-name segment
// the generic class narrows away. `homedir()` on the runner is `/home/runner`
// and is never the right answer for a repository redacted on Windows.
describe('resolveHomeDir', () => {
  it('prefers REDACT_HOME_DIR when CI sets it', () => {
    expect(resolveHomeDir({ REDACT_HOME_DIR: 'C:\\Users\\User' })).toBe(
      'C:\\Users\\User',
    )
  })

  it('trims it, so a value piped in with a trailing newline still works', () => {
    expect(resolveHomeDir({ REDACT_HOME_DIR: ' C:\\Users\\User \n' })).toBe(
      'C:\\Users\\User',
    )
  })

  it("falls back to this machine's home directory when it is unset", () => {
    expect(resolveHomeDir({})).toBe(homedir())
  })

  it('falls back when it is set but blank, rather than building a catch-all', () => {
    expect(resolveHomeDir({ REDACT_HOME_DIR: '   ' })).toBe(homedir())
  })
})

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

// A5 — spec §3.4: "Some posts carry several traces (`trace-a.json`,
// `trace-b.json`) for the compare-style demos". The gate built ONE path per
// post directory and skipped everything else, so a second trace would reach
// the public site never schema-checked and never leak-scanned — and, because
// the recorder hardcoded its output filename, hand-writing that second file
// was the only way to produce it. Exactly the scenario the gate exists for.
describe('validateTraces checks every trace file in a post, not just trace.json', () => {
  let postsDir: string

  beforeEach(() => {
    postsDir = mkdtempSync(join(tmpdir(), 'nc-validate-multi-'))
  })

  afterEach(() => {
    rmSync(postsDir, { recursive: true, force: true })
  })

  it('checks trace-a.json and trace-b.json alongside trace.json', () => {
    writeNamed(postsDir, 'compare', 'trace.json', cleanTrace)
    writeNamed(postsDir, 'compare', 'trace-a.json', cleanTrace)
    writeNamed(postsDir, 'compare', 'trace-b.json', cleanTrace)

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(3)
    expect(result.failures).toHaveLength(0)
  })

  it('catches a leak in a trace that is not named trace.json', () => {
    writeNamed(postsDir, 'compare', 'trace-b.json', leakingTrace)

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('trace-b.json')
    expect(result.failures[0]).toContain('home-path')
  })

  it('ignores files that merely start with "trace"', () => {
    writeNamed(postsDir, 'p', 'trace.json', cleanTrace)
    writeFile(postsDir, 'p', 'traces.md', '# notes')
    writeFile(postsDir, 'p', 'trace.json.bak', 'not json at all')

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(0)
  })
})

// A7 — the branch's stated invariant is that every gate fails loudly rather
// than degrading silently, and this was the one place it did not hold. A
// missing posts directory exited 0; a post directory with no trace was
// silently skipped; zero traces printed "validated 0 trace(s)" and exited 0.
// A green check here meant nothing, so it could not tell a working gate from
// no gate at all.
describe('validateTraces fails loudly rather than degrading silently', () => {
  let postsDir: string

  beforeEach(() => {
    postsDir = mkdtempSync(join(tmpdir(), 'nc-validate-loud-'))
  })

  afterEach(() => {
    rmSync(postsDir, { recursive: true, force: true })
  })

  it('fails when a post has an index.mdx but no trace file', () => {
    mkdirSync(join(postsDir, 'orphan'), { recursive: true })
    writeFile(postsDir, 'orphan', 'index.mdx', '---\ntitle: x\n---\n')

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('orphan')
    expect(result.failures[0]).toContain('no trace')
  })

  it('fails when post directories exist but not one trace was checked', () => {
    mkdirSync(join(postsDir, 'empty-post'), { recursive: true })

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(0)
    expect(result.failures.join('\n')).toContain('0 trace')
  })

  it('stays silent-and-clean when the posts directory is empty', () => {
    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(0)
    expect(result.failures).toHaveLength(0)
  })

  it('does not fail a post that has both an index.mdx and a trace', () => {
    writeNamed(postsDir, 'good', 'trace.json', cleanTrace)
    writeFile(postsDir, 'good', 'index.mdx', '---\ntitle: x\n---\n')

    const result = validateTraces(postsDir, opts)

    expect(result.checked).toBe(1)
    expect(result.failures).toHaveLength(0)
  })
})
