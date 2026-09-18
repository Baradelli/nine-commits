import { describe, it, expect } from 'vitest'
import {
  redactString,
  redactDeep,
  findSecrets,
  findSecretsDeep,
  type RedactOptions,
} from './redact.ts'

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

  // I5 — H3 added the index to this throw but nothing pinned it, unlike the
  // collision guard below. The entry is whitespace, so "the message does not
  // contain the entry" is only assertable with a character the message could
  // not otherwise contain: a tab can only appear here by interpolation.
  it('reports the index of a blank deny-list entry, never its content', () => {
    let caught: Error | undefined
    try {
      redactString('abc', { ...opts, denyList: ['fine', '\t \n'] })
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    const message = caught?.message ?? ''
    expect(message).toContain('index 1')
    expect(message).not.toContain('\t')
    expect(message).not.toContain('fine')
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

// H1/H2 — the redaction invariant, proved over a GENERATED corpus.
//
// The invariant: for any input x and any valid opts,
//   redactString(redactString(x, opts), opts) === redactString(x, opts)
// and consequently findSecrets(redactString(x, opts), opts) === [].
//
// Rounds 1 and 2 each broke this and each shipped green, because the test
// that was supposed to catch it was a hand-written table: every row was a
// bare, unquoted, unpunctuated secret, so the table could only ever re-check
// the handful of shapes somebody had already thought of. The failures that
// survived were quoted, bracketed and parenthesised values — shapes that are
// MORE common in a real trace than the bare form.
//
// So this corpus is not listed, it is built: every secret family crossed
// with every wrapper crossed with every surrounding context. That is 720
// cases from a few dozen lines, and it covers shapes nobody enumerated. A
// tenth rule added next year is exercised against all 72 wrapper/context
// combinations the moment its sample is added to SAMPLES.

const corpusOpts: RedactOptions = {
  homeDir: 'C:\\Users\\User',
  denyList: ['my-private-project'],
  env: { MY_APP_SECRET: 'sup3rSecretValue!' },
}

// `distinctive` is the part of the sample that must NOT survive redaction.
// Without it, a rule set that redacted nothing at all would satisfy the
// idempotence property trivially — see the second describe block below.
// `gluedStillMatches` records whether this family's rule can still match when
// the sample is concatenated directly onto another token with no separator.
// The vendor-key, JWT and bearer rules all begin with `\b`, so gluing them
// onto a preceding word character destroys the anchor and the rule matches
// nothing at all. That is a rule-coverage limit, not an overlap bug, and it
// is out of scope this round — but the adjacency corpus below must not assert
// the disappearance of material that no rule ever claimed, so those families
// are only used as the LEADING half of an adjacent pair. See the report.
type Sample = {
  family: string
  text: string
  distinctive: string
  gluedStillMatches: boolean
}

const SAMPLES: Sample[] = [
  {
    family: 'openai key',
    text: 'sk-abc123DEF456ghi789jkl',
    distinctive: 'abc123DEF456ghi789jkl',
    gluedStillMatches: false,
  },
  {
    family: 'github token',
    text: 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4',
    distinctive: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4',
    gluedStillMatches: false,
  },
  {
    family: 'jwt',
    text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    distinctive: 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    gluedStillMatches: false,
  },
  {
    family: 'bearer token',
    text: 'Bearer abcdefghij',
    distinctive: 'abcdefghij',
    gluedStillMatches: false,
  },
  {
    family: 'credential assignment',
    text: 'DB_PASSWORD=SuperSecretValue123',
    distinctive: 'SuperSecretValue123',
    gluedStillMatches: true,
  },
  {
    family: 'home path (native)',
    text: 'C:\\Users\\User\\x.ts',
    distinctive: 'C:\\Users\\User',
    gluedStillMatches: true,
  },
  {
    family: 'home path (forward slash)',
    text: 'C:/Users/User/x.ts',
    distinctive: 'C:/Users/User',
    gluedStillMatches: true,
  },
  {
    family: 'home path (MSYS)',
    text: '/c/Users/User/x.ts',
    distinctive: '/c/Users/User',
    gluedStillMatches: true,
  },
  {
    family: 'deny-list entry',
    text: 'my-private-project',
    distinctive: 'my-private-project',
    gluedStillMatches: true,
  },
  {
    family: 'env value',
    text: 'sup3rSecretValue!',
    distinctive: 'sup3rSecretValue',
    gluedStillMatches: true,
  },
]

const WRAPPERS: Array<[string, (s: string) => string]> = [
  ['bare', (s) => s],
  ['double quoted', (s) => `"${s}"`],
  ['single quoted', (s) => `'${s}'`],
  ['backticked', (s) => `\`${s}\``],
  ['parens', (s) => `(${s})`],
  ['angles', (s) => `<${s}>`],
  ['brackets', (s) => `[${s}]`],
  ['braces', (s) => `{${s}}`],
  ['leading dash', (s) => `-${s}`],
  ['trailing comma', (s) => `${s},`],
  ['trailing semicolon', (s) => `${s};`],
  ['trailing period', (s) => `${s}.`],
]

const CONTEXTS: Array<[string, (wrapped: string, other: string) => string]> = [
  ['alone', (w) => w],
  ['after "token: "', (w) => `token: ${w}`],
  ['after "api_key="', (w) => `api_key=${w}`],
  ['after "SECRET: "', (w) => `SECRET: ${w}`],
  ['mid-sentence', (w) => `the agent read ${w} while running the task`],
  ['two secrets in one string', (w, other) => `${w} and also ${other}`],
]

// [caseName, input, distinctiveSubstringThatMustNotSurvive]
const corpus: Array<[string, string, string]> = []
for (const [index, sample] of SAMPLES.entries()) {
  // The "two secrets" context pairs each sample with the next family in the
  // list, so every adjacency in the cycle gets exercised rather than one
  // fixed pair.
  const other = SAMPLES[(index + 1) % SAMPLES.length]
  for (const [wrapperName, wrap] of WRAPPERS) {
    for (const [contextName, place] of CONTEXTS) {
      corpus.push([
        `${sample.family} / ${wrapperName} / ${contextName}`,
        place(wrap(sample.text), wrap(other!.text)),
        sample.distinctive,
      ])
    }
  }
}

describe('redaction invariant over a generated corpus', () => {
  it('generates the expected number of cases', () => {
    expect(corpus).toHaveLength(
      SAMPLES.length * WRAPPERS.length * CONTEXTS.length,
    )
    expect(corpus).toHaveLength(720)
  })

  it.each(corpus)('%s — is clean and idempotent', (_name, input) => {
    const once = redactString(input, corpusOpts)
    expect(findSecrets(once, corpusOpts)).toEqual([])
    expect(redactString(once, corpusOpts)).toBe(once)
  })
})

// The assertion family that stops the invariant above from passing
// vacuously: a rule set that redacted nothing would be perfectly idempotent
// and perfectly "clean". These cases prove redaction actually happened.
describe('generated corpus: the secret itself does not survive', () => {
  it.each(corpus)(
    '%s — distinctive substring is gone',
    (_name, input, distinctive) => {
      expect(input).toContain(distinctive)
      expect(redactString(input, corpusOpts)).not.toContain(distinctive)
    },
  )
})

// ---------------------------------------------------------------------------
// I2 — the adjacency corpus: two secrets glued together with NO separator.
// ---------------------------------------------------------------------------
//
// The corpus above crosses one sample with wrappers and contexts, and where it
// puts two samples in one string it separates them with " and also ". That
// cannot produce the shape where one rule's match RUNS INTO another rule's
// match, which is the shape that breaks overlap resolution: a rule whose
// greedy tail reaches into a second secret wins the overlap on position, and
// the second secret's uncovered remainder is published while the gate reports
// clean.
//
// I2 asked for a context that concatenates two samples with no separator. This
// generalises that from one cyclic pair to ALL 100 ordered pairs, because the
// defect is a property of a *pair of rules*, and cycling through 10 of the 100
// pairs would have been the same mistake the round-2 ten-row table made: it
// covers what someone happened to line up, not the space.
//
// Assertions per case: clean and idempotent for ALL 1200; plus, for the pairs
// where it is sound, that the secret material is gone. Two exclusions, both of
// them limits of what this assertion can see rather than places the module is
// allowed to leak:
//
//   - The TRAILING distinctive is only asserted when that family's rule can
//     still match while glued (`gluedStillMatches`). A `\b`-anchored rule
//     matches nothing in that position, so no hit was produced and none was
//     discarded — there is no overlap defect there to detect.
//   - The LEADING distinctive is only asserted when the two halves do not
//     share it, i.e. not for a family glued to itself. `not.toContain` cannot
//     tell the leading copy from the trailing one, and for jwt and bearer the
//     leading match greedily swallows the boundary between the copies, leaving
//     a second copy that no longer matches anything. Measured:
//     `Bearer abcdefghijBearer abcdefghij` -> `[REDACTED:bearer] abcdefghij`.
//     That is the same anchor-consumption class as the bullet above, reached
//     from the other side; it is reported, and it is not I1 (nothing was
//     discarded, so no overlap policy can recover it).
const adjacency: Array<[string, string, string[]]> = []
for (const lead of SAMPLES) {
  for (const trail of SAMPLES) {
    for (const [wrapperName, wrap] of WRAPPERS) {
      const mustBeGone: string[] = []
      if (lead.distinctive !== trail.distinctive) {
        mustBeGone.push(lead.distinctive)
      }
      if (trail.gluedStillMatches) mustBeGone.push(trail.distinctive)
      adjacency.push([
        `${lead.family} + ${trail.family} / ${wrapperName}`,
        `${wrap(lead.text)}${wrap(trail.text)}`,
        mustBeGone,
      ])
    }
  }
}

describe('adjacent secrets with no separator', () => {
  it('generates the expected number of cases', () => {
    expect(adjacency).toHaveLength(
      SAMPLES.length * SAMPLES.length * WRAPPERS.length,
    )
    expect(adjacency).toHaveLength(1200)
  })

  it.each(adjacency)('%s — is clean and idempotent', (_name, input) => {
    const once = redactString(input, corpusOpts)
    expect(findSecrets(once, corpusOpts)).toEqual([])
    expect(redactString(once, corpusOpts)).toBe(once)
  })
})

describe('adjacent secrets: no overlap loser leaves an uncovered tail', () => {
  it.each(adjacency)('%s — every claimed secret is gone', (_name, input, mustBeGone) => {
    const out = redactString(input, corpusOpts)
    for (const fragment of mustBeGone) {
      expect(input).toContain(fragment)
      expect(out).not.toContain(fragment)
    }
  })
})

// I1 — the five shapes the fix-round-4 review measured. Each is an overlap
// where the winning hit ends INSIDE the losing hit, so the loser's uncovered
// remainder was published and no later pass could recover it: the truncated
// remainder no longer matches anything, so the fixed-point loop terminates and
// findSecrets reports clean. The first two need no caller configuration at
// all — built-in rules only.
describe('an overlapped rule never leaves its tail behind', () => {
  it.each<[string, string, string, RedactOptions]>([
    [
      'api key running into a credential assignment',
      'npm_a1b2c3d4e5f6g7h8i9j0password=hunter2hunter2',
      'hunter2hunter2',
      corpusOpts,
    ],
    [
      'jwt running into a credential assignment',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abctoken=SuperSecretValue',
      'SuperSecretValue',
      corpusOpts,
    ],
    [
      'deny-list entry running into a credential assignment',
      'my client token=SuperSecretPassword',
      'SuperSecretPassword',
      { ...corpusOpts, denyList: ['my client token'] },
    ],
    [
      'deny-list entry running into an api key',
      'xyz sk-abc123DEF456ghi789jkl',
      '123DEF456ghi789jkl',
      { ...corpusOpts, denyList: ['xyz sk-abc'] },
    ],
    [
      'env value running into a credential assignment',
      'ev-prefix token=SuperSecretPassword',
      'SuperSecretPassword',
      { ...corpusOpts, env: { MY_TOKEN: 'ev-prefix token' } },
    ],
  ])('%s', (_name, input, leaked, caseOpts) => {
    const out = redactString(input, caseOpts)
    expect(input).toContain(leaked)
    expect(out).not.toContain(leaked)
    expect(findSecrets(out, caseOpts)).toEqual([])
  })
})

// H1 — the round-2 lookahead `(?!\[REDACTED:)` made the credential rule fail
// OPEN: any value that began with the literal token prefix was skipped
// entirely, including everything after it in the same value. A security
// boundary must not fail open, so these two shapes must still be redacted.
describe('a value that looks like a replacement token is still redacted', () => {
  it.each([
    ['a spoofed token as the whole value', 'password: [REDACTED:hunter2]'],
    [
      'a spoofed token with real secret text after it',
      'secret: [REDACTED:x]andmoresecrettext',
    ],
  ])('%s', (_name, input) => {
    const out = redactString(input, corpusOpts)
    expect(out).toBe('[REDACTED:credential]')
    expect(findSecrets(out, corpusOpts)).toEqual([])
  })
})

// The seven inputs the fix-round-3 review measured as still failing. The
// generated corpus above covers six of them structurally; the seventh
// (`Bearer C:/Users/User/...`) is the one shape a cross-product of
// independent samples never builds, because there the redaction of one rule
// CREATES a match for another: the home path becomes "~", and "~" is a
// member of the bearer rule's own character class, so a clean "~/aaaaaaaaa"
// reads as a bearer token afterwards. Pinned explicitly so the row can never
// silently come back.
describe('the measured fix-round-3 failures', () => {
  it.each<[string, string, typeof corpusOpts]>([
    ['double-quoted bearer', 'TOKEN="Bearer abcdefghij"', corpusOpts],
    ['single-quoted bearer', "token: 'Bearer abcdefghij'", corpusOpts],
    ['parenthesised bearer', 'api_key: (Bearer abcdefghij)', corpusOpts],
    ['angle-bracketed bearer', 'token: <Bearer abcdefghij>', corpusOpts],
    [
      'quoted env value',
      'token: "alpha beta gamma"',
      { ...corpusOpts, env: { MY_TOKEN: 'alpha beta gamma' } },
    ],
    [
      'dash-prefixed deny-list entry',
      'secret: -myproj',
      { ...corpusOpts, denyList: ['myproj'] },
    ],
    [
      'a home path that becomes a bearer token once redacted',
      'Bearer C:/Users/User/aaaaaaaaa',
      corpusOpts,
    ],
  ])('%s', (_name, input, caseOpts) => {
    const once = redactString(input, caseOpts)
    expect(findSecrets(once, caseOpts)).toEqual([])
    expect(redactString(once, caseOpts)).toBe(once)
  })
})

// H1 — the invariant is enforced, not assumed. redactString runs its
// scan/splice pass to a fixed point; a rule whose replacement text contains
// its own trigger never reaches one. Deny-list entries are screened for that
// at the entry point, but environment values are not (an ambient variable's
// content is outside the author's control, and guarding it is on the
// deferred list). The loop must therefore fail CLOSED on divergence rather
// than hand back a string the build gate will reject with no way to fix it.
describe('a rule set that cannot converge fails closed', () => {
  const selfPoisoning = {
    ...corpusOpts,
    // The value is a substring of its own replacement token, so each pass
    // rewrites the previous pass's output and the string grows forever.
    env: { MY_TOKEN: 'REDACTED:env' },
  }

  it('throws instead of returning text the gate would reject', () => {
    let caught: Error | undefined
    try {
      redactString('log line REDACTED:env here', selfPoisoning)
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    expect(caught?.message).toContain('fixed point')
    expect(caught?.message).toContain('env-value')
  })

  it('names the rule kind, never the value, in the thrown message', () => {
    let caught: Error | undefined
    try {
      redactString('log line REDACTED:env here', selfPoisoning)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).not.toContain('MY_TOKEN')
  })

  // I3.1 — the message must not claim a cause it cannot determine. Cap
  // exhaustion means "did not settle within the cap", which a perfectly
  // convergent rule set can also produce (see the next block). Blaming the
  // rule set sends an author hunting a bug that may not exist.
  it('does not attribute cap exhaustion to a rule bug', () => {
    let caught: Error | undefined
    try {
      redactString('log line REDACTED:env here', selfPoisoning)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).not.toMatch(/match(es)? their own/)
  })

  // I3.3 — ordinary content must not be able to reach the throw. Each pass
  // peels exactly one keyword-separator prefix, so N stacked prefixes need N
  // passes with a rule set that is converging perfectly well.
  it('does not throw on deeply stacked credential keywords', () => {
    const stacked = 'token: '.repeat(9) + 'aaaaaaaa'
    expect(() => redactString(stacked, corpusOpts)).not.toThrow()
    expect(redactString(stacked, corpusOpts)).toBe('[REDACTED:credential]')
  })
})

// I3.2 — the throw happens inside redactString, one leaf at a time. Thrown
// from redactDeep over a whole trace, the author has no way to find which
// string caused it. The path must be reported, and — because object keys are
// themselves redacted content — the path elements must be redacted too, or
// the locator becomes the leak.
describe('a divergence inside redactDeep reports where it happened', () => {
  const selfPoisoning: RedactOptions = {
    ...corpusOpts,
    env: { MY_TOKEN: 'REDACTED:env' },
  }

  const catchFrom = (value: unknown): string => {
    try {
      redactDeep(value, selfPoisoning)
    } catch (err) {
      return (err as Error).message
    }
    return ''
  }

  it('reports the structural path to the offending string', () => {
    const message = catchFrom({
      frames: [{ type: 'user', content: 'log REDACTED:env here' }],
    })
    expect(message).toContain('frames[0].content')
  })

  it('redacts the path itself, so the locator is not a new leak', () => {
    const message = catchFrom({
      'C:\\Users\\User\\notes.ts': 'log REDACTED:env here',
    })
    expect(message).toContain('~\\notes.ts')
    expect(message).not.toContain('C:\\Users\\User')
  })

  it('still never prints the offending value', () => {
    const message = catchFrom({ a: { b: 'log REDACTED:env here' } })
    expect(message).toContain('a.b')
    expect(message).not.toContain('log REDACTED:env here')
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
