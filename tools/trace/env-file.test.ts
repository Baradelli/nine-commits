import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnvFile, mergeEnv } from './env-file.ts'
import { redactString } from './redact.ts'

// A2 — spec §4.2 mandates redacting environment variable values, and
// `patterns()` implements it against `process.env`. But this project's only
// real secret, `OPENAI_API_KEY`, lives in `agent/.env` and is loaded ONLY by
// the agent's own `tsx --env-file=.env`. `npm run record` runs from the repo
// root with no `--env-file`, so `process.env.OPENAI_API_KEY` is undefined
// there and the env rule — the backstop for a credential the vendor regexes
// do not recognise (an org id, a proxy token, an Azure key) — contributed
// nothing at all.
describe('readEnvFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nc-envfile-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (contents: string): string => {
    const path = join(dir, '.env')
    writeFileSync(path, contents, 'utf8')
    return path
  }

  it('reads a plain KEY=VALUE file', () => {
    expect(readEnvFile(write('OPENAI_API_KEY=sk-not-a-real-key\n'))).toEqual({
      OPENAI_API_KEY: 'sk-not-a-real-key',
    })
  })

  // The recorder must not die because the author has not created the file.
  it('returns nothing when the file does not exist', () => {
    expect(readEnvFile(join(dir, 'absent.env'))).toEqual({})
  })

  it('skips blank lines and comments', () => {
    const path = write('# a comment\n\nA=1\n   # indented comment\nB=2\n')
    expect(readEnvFile(path)).toEqual({ A: '1', B: '2' })
  })

  it('strips a leading `export`', () => {
    expect(readEnvFile(write('export TOKEN=abcdefgh\n'))).toEqual({
      TOKEN: 'abcdefgh',
    })
  })

  it('strips matching surrounding quotes but keeps inner ones', () => {
    const path = write(`A="quoted value"\nB='single'\nC=say "hi"\n`)
    expect(readEnvFile(path)).toEqual({
      A: 'quoted value',
      B: 'single',
      C: 'say "hi"',
    })
  })

  // A value is a secret: whitespace inside it is part of it. Only the
  // line's surrounding whitespace is dropped.
  it('keeps whitespace inside a quoted value', () => {
    expect(readEnvFile(write('A="  padded  "\n'))).toEqual({ A: '  padded  ' })
  })

  it('keeps an `=` inside the value', () => {
    expect(readEnvFile(write('A=a=b=c\n'))).toEqual({ A: 'a=b=c' })
  })

  it('tolerates CRLF line endings', () => {
    expect(readEnvFile(write('A=1\r\nB=2\r\n'))).toEqual({ A: '1', B: '2' })
  })

  it('ignores a line with no `=` at all', () => {
    expect(readEnvFile(write('nonsense\nA=1\n'))).toEqual({ A: '1' })
  })
})

describe('mergeEnv', () => {
  it('adds names the ambient environment does not have', () => {
    expect(mergeEnv({ PATH: '/usr/bin' }, { API_TOKEN: 'abcdefgh' })).toEqual({
      PATH: '/usr/bin',
      API_TOKEN: 'abcdefgh',
    })
  })

  it('collapses a name whose value is already identical', () => {
    expect(mergeEnv({ A_TOKEN: 'same' }, { A_TOKEN: 'same' })).toEqual({
      A_TOKEN: 'same',
    })
  })

  // `redact.patterns()` builds one rule per NAME. Overwriting would leave a
  // stale exported credential with no rule at all.
  it('keeps BOTH values when the same name holds two different secrets', () => {
    const merged = mergeEnv(
      { OPENAI_API_KEY: 'sk-stale-shell-value' },
      { OPENAI_API_KEY: 'sk-current-file-value' },
    )

    const out = redactString(
      'auth failed for sk-stale-shell-value and sk-current-file-value',
      { homeDir: 'C:\\Users\\User', denyList: [], env: merged },
    )

    expect(out).not.toContain('sk-stale-shell-value')
    expect(out).not.toContain('sk-current-file-value')
  })
})
