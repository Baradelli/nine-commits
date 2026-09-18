import { describe, it, expect } from 'vitest'
import { redactString, redactDeep, findSecrets, findSecretsDeep } from './redact.ts'

// G4 — pinned to {} rather than left to default to process.env, so this
// suite is hermetic: a contributor's or CI runner's ambient environment
// can no longer silently change which of these tests pass. The two F7
// tests below override this with their own explicit fake env.
const opts = {
  homeDir: 'C:\\Users\\User',
  denyList: ['my-private-project'],
  env: {},
}

describe('redactString', () => {
  it('replaces every occurrence of the Windows home directory', () => {
    const out = redactString('C:\\Users\\User\\Documents\\a.ts', opts)
    expect(out).toBe('~\\Documents\\a.ts')
  })

  it('replaces every occurrence of the POSIX home directory', () => {
    const out = redactString('/home/user/projects/a.ts', {
      ...opts,
      homeDir: '/home/user',
    })
    expect(out).toBe('~/projects/a.ts')
  })

  it('redacts an OpenAI-style key', () => {
    expect(redactString('key is sk-abc123DEF456ghi789jkl', opts)).toBe(
      'key is [REDACTED:api-key]',
    )
  })

  it('redacts a bearer token', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi', opts)).toBe(
      'Authorization: [REDACTED:bearer]',
    )
  })

  it('redacts a deny-list entry', () => {
    expect(redactString('see my-private-project/x', opts)).toBe(
      'see [REDACTED:denied]/x',
    )
  })

  it('leaves innocent text untouched', () => {
    expect(redactString('read src/run.ts', opts)).toBe('read src/run.ts')
  })

  // F2 — the home directory must be recognized in every form this toolchain
  // actually produces, not only the native backslash form.
  it('redacts the forward-slash form of a Windows home directory', () => {
    expect(redactString('C:/Users/User/x.ts', opts)).toBe('~/x.ts')
  })

  it('redacts the Git-Bash (MSYS) drive form of a Windows home directory', () => {
    expect(redactString('/c/Users/User/x.ts', opts)).toBe('~/x.ts')
  })

  // F5 — vendor-specific key shapes, bare JWTs, and generic assignment forms.
  it('redacts a GitHub personal access token', () => {
    const gh = 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4'
    expect(redactString(`fetched with ${gh}`, opts)).toBe(
      'fetched with [REDACTED:api-key]',
    )
  })

  it('redacts a bare JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redactString(`session is ${jwt}`, opts)).toBe(
      'session is [REDACTED:jwt]',
    )
  })

  it('redacts a generic key/token/secret/password/credential assignment', () => {
    expect(redactString('DB_PASSWORD=SuperSecretValue123', opts)).toBe(
      'DB_[REDACTED:credential]',
    )
  })

  // F7 — environment variable values whose names look sensitive.
  it('redacts the value of a sensitive-named environment variable', () => {
    const withEnv = { ...opts, env: { MY_APP_SECRET: 'sup3rSecretValue!' } }
    expect(redactString('leaked: sup3rSecretValue!', withEnv)).toBe(
      'leaked: [REDACTED:env]',
    )
  })

  it('does not redact short or innocuously-named environment values', () => {
    const withEnv = {
      ...opts,
      env: { NUMBER_OF_PROCESSORS: '8', GREETING: 'hello there friend' },
    }
    expect(
      redactString('processors: 8, say hello there friend', withEnv),
    ).toBe('processors: 8, say hello there friend')
  })

  // F6 — degenerate inputs must be rejected at every entry point, not just
  // inside normalize().
  it('rejects a blank or implausibly short homeDir', () => {
    expect(() => redactString('abc', { ...opts, homeDir: '' })).toThrow(
      /homeDir/,
    )
    expect(() => redactString('abc', { ...opts, homeDir: 'C:' })).toThrow(
      /homeDir/,
    )
  })

  it('rejects a blank deny-list entry', () => {
    expect(() =>
      redactString('abc', { ...opts, denyList: [' '] }),
    ).toThrow(/denyList/)
  })

  it('rejects a deny-list entry that collides with a replacement token', () => {
    // Measured: an unguarded 'red' rewrites '[REDACTED:denied]' into
    // '[[REDACTED:denied]ACTED:denied]' and self-poisons findSecrets forever.
    expect(() =>
      redactString('abc', { ...opts, denyList: ['red'] }),
    ).toThrow(/denyList/)
  })

  // G3 — F3 and F6 both required that a guard name the *problem*, never the
  // *value*. The collision guard was the one holdout: it interpolated the
  // deny-list entry itself into a message that runs inside normalize, which
  // runs in GitHub Actions on a public repository.
  it('reports the index and length of a colliding deny-list entry, never its content', () => {
    let caught: Error | undefined
    try {
      redactString('abc', { ...opts, denyList: ['bear'] })
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    const message = caught?.message ?? ''
    expect(message).toContain('index 0')
    expect(message).toContain('length 4')
    expect(message.toLowerCase()).not.toContain('bear')
  })
})

// G1/G2 — the rule set must be idempotent: once redactString has cleaned a
// string, findSecrets scanning that same string must report nothing. Round
// 1 broke this without a test catching it: CREDENTIAL_ASSIGNMENT runs first
// during redaction and never sees the tokens later rules emit, but
// findSecrets applies every rule — including CREDENTIAL_ASSIGNMENT — to the
// already-redacted output. A 17+ character, space-free replacement token
// right after "token:"/"secret:"/etc. then satisfies CREDENTIAL_ASSIGNMENT's
// own \S{8,}, manufacturing a phantom leak out of clean text. This corpus
// covers every rule family plus the three measured triggers.
describe('idempotence: findSecrets(redactString(x)) is always []', () => {
  const cases: Array<[string, string, typeof opts]> = [
    ['an OpenAI-style key', 'sk-abc123DEF456ghi789jkl', opts],
    ['a GitHub token', 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4', opts],
    [
      'a bare JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      opts,
    ],
    // G1 trigger 1 — measured: redacts to "auth token: [REDACTED:bearer]",
    // then findSecrets on that output reported ['credential'].
    ['a bearer token', 'auth token: Bearer abcdefghij', opts],
    ['a credential assignment', 'DB_PASSWORD=SuperSecretValue123', opts],
    ['a native Windows home path', 'C:\\Users\\User\\x.ts', opts],
    ['a forward-slash home path', 'C:/Users/User/x.ts', opts],
    ['a Git-Bash (MSYS) home path', '/c/Users/User/x.ts', opts],
    // G1 trigger 2 — measured: redacts to "project secret: [REDACTED:denied]",
    // then findSecrets on that output reported ['credential'].
    [
      'a deny-list entry',
      'project secret: my-proj',
      { ...opts, denyList: ['my-proj'] },
    ],
    // G1 trigger 3 — measured: redacts to "token: [REDACTED:env]", then
    // findSecrets on that output reported ['credential'].
    [
      'an environment value',
      'token: alpha beta gamma',
      { ...opts, env: { MY_TOKEN: 'alpha beta gamma' } },
    ],
  ]

  it.each(cases)('is clean after redacting %s', (_name, input, caseOpts) => {
    expect(findSecrets(redactString(input, caseOpts), caseOpts)).toEqual([])
  })
})

// G2 — the home-directory variants added for F2 were only ever tested for
// redaction, never for detection, so redaction and detection could drift
// apart unnoticed (which is exactly what happened to the other rules in
// G1). These assert findSecrets/findSecretsDeep recognize all three forms
// on RAW, unredacted input.
describe('findSecrets recognizes every home-directory variant', () => {
  it.each([
    ['native', 'note: C:\\Users\\User\\x.ts'],
    ['forward-slash', 'note: C:/Users/User/x.ts'],
    ['Git-Bash (MSYS)', 'note: /c/Users/User/x.ts'],
  ])('%s form', (_label, input) => {
    expect(findSecrets(input, opts)).toEqual(['home-path'])
  })
})

describe('findSecretsDeep recognizes every home-directory variant', () => {
  it.each([
    ['native', 'C:\\Users\\User\\x.ts'],
    ['forward-slash', 'C:/Users/User/x.ts'],
    ['Git-Bash (MSYS)', '/c/Users/User/x.ts'],
  ])('%s form', (_label, path) => {
    expect(findSecretsDeep({ note: path }, opts)).toEqual(['home-path'])
  })
})

describe('redactDeep', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      a: 'sk-abc123DEF456ghi789jkl',
      b: [{ c: 'C:\\Users\\User\\x.ts' }],
      n: 42,
    }
    expect(redactDeep(input, opts)).toEqual({
      a: '[REDACTED:api-key]',
      b: [{ c: '~\\x.ts' }],
      n: 42,
    })
  })

  it('redacts object keys as well as values', () => {
    const input = { 'C:\\Users\\User\\x.ts': 'ok' }
    expect(redactDeep(input, opts)).toEqual({ '~\\x.ts': 'ok' })
  })

  it('does not silently drop a __proto__-named key', () => {
    // Object literal syntax can't create a genuine own "__proto__" property
    // (it sets the prototype instead), but JSON.parse can — and recorded
    // traces arrive as JSON. Measured: with a plain {} accumulator, writing
    // out['__proto__'] = value sets the new object's prototype instead of
    // creating an own property, so the key vanishes from the result.
    const input = JSON.parse('{"__proto__": "ok", "other": "fine"}') as Record<
      string,
      unknown
    >
    const out = redactDeep(input, opts) as Record<string, unknown>
    expect(Object.keys(out)).toContain('__proto__')
    expect(out['__proto__']).toBe('ok')
  })
})

describe('findSecrets', () => {
  it('returns nothing for clean text', () => {
    expect(findSecrets('read src/run.ts', opts)).toEqual([])
  })

  it('reports what is still leaking', () => {
    expect(findSecrets('sk-abc123DEF456ghi789jkl', opts)).toHaveLength(1)
  })

  it('reports nothing after redaction', () => {
    const dirty = 'C:\\Users\\User\\x sk-abc123DEF456ghi789jkl'
    expect(findSecrets(redactString(dirty, opts), opts)).toEqual([])
  })

  it('never returns the matched value itself, only a label', () => {
    // F3 — the failure path must not print secrets into public CI logs.
    const leaks = findSecrets('sk-abc123DEF456ghi789jkl', opts)
    expect(leaks).toEqual(['api-key'])
    expect(leaks.join(' ')).not.toContain('abc123DEF456ghi789jkl')
  })
})

describe('findSecretsDeep', () => {
  // F1 — the deep scan must see raw strings, not a JSON-escaped rendering
  // where a Windows path's backslashes have been doubled.
  it('catches a leak nested inside an object even though JSON.stringify would double its backslashes', () => {
    const value = { note: 'C:\\Users\\User\\secret.ts' }
    expect(findSecretsDeep(value, opts)).toEqual(['home-path'])
    expect(JSON.stringify(value)).not.toContain('C:\\Users\\User')
    // Sanity: the raw string form is exactly what a naive JSON.stringify scan would miss.
    expect(value.note.includes('C:\\Users\\User')).toBe(true)
  })

  it('returns nothing once redactDeep has cleaned the value', () => {
    const value = { note: 'C:\\Users\\User\\secret.ts' }
    const cleaned = redactDeep(value, opts)
    expect(findSecretsDeep(cleaned, opts)).toEqual([])
  })
})
