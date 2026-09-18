import { describe, it, expect } from 'vitest'
import { redactString, redactDeep, findSecrets, findSecretsDeep } from './redact.ts'

const opts = {
  homeDir: 'C:\\Users\\User',
  denyList: ['my-private-project'],
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
