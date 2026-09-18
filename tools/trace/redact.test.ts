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
// J1 — round 4 also carried a `gluedStillMatches` flag here, saying whether
// this family's rule survives being glued onto another token. It is gone: a
// per-family boolean cannot be right, because the answer depends on the
// wrapper (which decides whether a word character precedes the sample) as much
// as on the family, and a flag that silently switches assertions off is how 48
// cases came to assert nothing at all. KNOWN_SURVIVALS carries the truth now,
// per case, measured.
type Sample = {
  family: string
  text: string
  distinctive: string
}

const SAMPLES: Sample[] = [
  {
    family: 'openai key',
    text: 'sk-abc123DEF456ghi789jkl',
    distinctive: 'abc123DEF456ghi789jkl',
  },
  {
    family: 'github token',
    text: 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4',
    distinctive: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4',
  },
  {
    family: 'jwt',
    text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    distinctive: 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  },
  {
    family: 'bearer token',
    text: 'Bearer abcdefghij',
    distinctive: 'abcdefghij',
  },
  {
    family: 'credential assignment',
    text: 'DB_PASSWORD=SuperSecretValue123',
    distinctive: 'SuperSecretValue123',
  },
  {
    family: 'home path (native)',
    text: 'C:\\Users\\User\\x.ts',
    distinctive: 'C:\\Users\\User',
  },
  {
    family: 'home path (forward slash)',
    text: 'C:/Users/User/x.ts',
    distinctive: 'C:/Users/User',
  },
  {
    family: 'home path (MSYS)',
    text: '/c/Users/User/x.ts',
    distinctive: '/c/Users/User',
  },
  {
    family: 'deny-list entry',
    text: 'my-private-project',
    distinctive: 'my-private-project',
  },
  {
    family: 'env value',
    text: 'sup3rSecretValue!',
    distinctive: 'sup3rSecretValue',
  },
  // J3 — API_KEY alternates seven vendor shapes and the corpus only ever
  // sampled two of them (`sk-`, `ghp_`). The other five were production regex
  // with no generated coverage at all. Test-only: no rule changes here.
  {
    family: 'aws access key',
    text: 'AKIAIOSFODNN7EXAMPLE',
    distinctive: 'IOSFODNN7EXAMPLE',
  },
  {
    family: 'npm token',
    text: 'npm_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8',
    distinctive: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8',
  },
  {
    family: 'slack bot token',
    text: 'xoxb-12345678901-2345678901234-AbCdEfGhIjKlMnOpQrStUvWx',
    distinctive: 'AbCdEfGhIjKlMnOpQrStUvWx',
  },
  {
    family: 'google api key',
    text: 'AIzaSyD-ExampleKeyMaterial0123456789xyz',
    distinctive: 'ExampleKeyMaterial0123456789xyz',
  },
  {
    family: 'github fine-grained pat',
    text: 'github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
    distinctive: '11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
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
    // 15 families x 12 wrappers x 6 contexts. Pinned as a literal as well as
    // a product so that a generator that silently stops generating is caught.
    expect(corpus).toHaveLength(1080)
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
// J1 — every case asserts something, and every fragment that survives is
// enumerated. Round 4 skipped assertions per FAMILY (`gluedStillMatches`) and
// skipped the leading fragment whenever the two halves shared it. Where those
// two skips intersected, `mustBeGone` came out empty and the `for` loop over
// it ran zero assertions: 48 cases passed by asserting nothing, and the count
// grew by 12 for every future family flagged unmatched-when-glued. Worse, the
// per-family flag was applied to all 12 wrappers when its justification — the
// `\b` is destroyed, so the rule produces no hit — only holds for the wrappers
// that leave a word character immediately before the trailing sample.
//
// The flag is gone. Every case now asserts every fragment, and a fragment is
// allowed to survive only if it is named in KNOWN_SURVIVALS below. That list
// is asserted EXACT in both directions: an unlisted survival fails the build,
// and a listed entry that no longer survives fails too, so the list shrinks as
// leaks are closed and cannot rot into a stale allow-list.
type Fragment = { owner: 'lead' | 'trail' | 'both'; text: string }

// The exact set of fragments that survive redaction today, keyed
// `<lead> + <trail> / <wrapper> :: <lead|trail|both>`. Every entry is a real
// leak: material published while findSecrets reports clean. They are recorded
// rather than fixed because closing them needs the trailing `\b` anchors
// dropped and every rule tempered against every other rule's prefix — a
// rule-set redesign, not a last-round change. Reasons are grouped above the
// blocks below.
//
// This list is the round's product. It is asserted exact, so it is a ratchet:
// it can only shrink, and it cannot rot.
const KNOWN_SURVIVALS = new Map<string, string>([
  // lead rule ends in \b and the trailing token supplies a word character, so it matches nothing and both halves ship (16)
  ['aws access key + openai key / bare :: lead', 'lead'],
  ['aws access key + github token / bare :: lead', 'lead'],
  ['aws access key + jwt / bare :: lead', 'lead'],
  ['aws access key + bearer token / bare :: lead', 'lead'],
  ['aws access key + credential assignment / bare :: lead', 'lead'],
  ['aws access key + npm token / bare :: lead', 'lead'],
  ['aws access key + slack bot token / bare :: lead', 'lead'],
  ['aws access key + google api key / bare :: lead', 'lead'],
  ['aws access key + github fine-grained pat / bare :: lead', 'lead'],
  ['npm token + github token / bare :: lead', 'lead'],
  ['npm token + credential assignment / bare :: lead', 'lead'],
  ['npm token + github fine-grained pat / bare :: lead', 'lead'],
  ['slack bot token + github token / bare :: lead', 'lead'],
  ['slack bot token + credential assignment / bare :: lead', 'lead'],
  ['slack bot token + npm token / bare :: lead', 'lead'],
  ['slack bot token + github fine-grained pat / bare :: lead', 'lead'],
  // self-pair: the leading match swallows the boundary between the copies (4)
  ['jwt + jwt / bare :: both', 'both'],
  ['jwt + jwt / leading dash :: both', 'both'],
  ['aws access key + aws access key / bare :: both', 'both'],
  ['npm token + npm token / bare :: both', 'both'],
  // leading match's greedy class eats the trailing rule's \b anchor (63)
  ['openai key + jwt / bare :: trail', 'trail'],
  ['openai key + bearer token / bare :: trail', 'trail'],
  ['github token + openai key / bare :: trail', 'trail'],
  ['github token + jwt / bare :: trail', 'trail'],
  ['github token + bearer token / bare :: trail', 'trail'],
  ['github token + slack bot token / bare :: trail', 'trail'],
  ['github token + google api key / bare :: trail', 'trail'],
  ['jwt + bearer token / bare :: trail', 'trail'],
  ['credential assignment + bearer token / bare :: trail', 'trail'],
  ['home path (native) + openai key / bare :: trail', 'trail'],
  ['home path (native) + github token / bare :: trail', 'trail'],
  ['home path (native) + jwt / bare :: trail', 'trail'],
  ['home path (native) + bearer token / bare :: trail', 'trail'],
  ['home path (native) + aws access key / bare :: trail', 'trail'],
  ['home path (native) + npm token / bare :: trail', 'trail'],
  ['home path (native) + slack bot token / bare :: trail', 'trail'],
  ['home path (native) + google api key / bare :: trail', 'trail'],
  ['home path (native) + github fine-grained pat / bare :: trail', 'trail'],
  ['home path (forward slash) + openai key / bare :: trail', 'trail'],
  ['home path (forward slash) + github token / bare :: trail', 'trail'],
  ['home path (forward slash) + jwt / bare :: trail', 'trail'],
  ['home path (forward slash) + bearer token / bare :: trail', 'trail'],
  ['home path (forward slash) + aws access key / bare :: trail', 'trail'],
  ['home path (forward slash) + npm token / bare :: trail', 'trail'],
  ['home path (forward slash) + slack bot token / bare :: trail', 'trail'],
  ['home path (forward slash) + google api key / bare :: trail', 'trail'],
  ['home path (forward slash) + github fine-grained pat / bare :: trail', 'trail'],
  ['home path (MSYS) + openai key / bare :: trail', 'trail'],
  ['home path (MSYS) + github token / bare :: trail', 'trail'],
  ['home path (MSYS) + jwt / bare :: trail', 'trail'],
  ['home path (MSYS) + bearer token / bare :: trail', 'trail'],
  ['home path (MSYS) + aws access key / bare :: trail', 'trail'],
  ['home path (MSYS) + npm token / bare :: trail', 'trail'],
  ['home path (MSYS) + slack bot token / bare :: trail', 'trail'],
  ['home path (MSYS) + google api key / bare :: trail', 'trail'],
  ['home path (MSYS) + github fine-grained pat / bare :: trail', 'trail'],
  ['aws access key + openai key / bare :: trail', 'trail'],
  ['aws access key + github token / bare :: trail', 'trail'],
  ['aws access key + jwt / bare :: trail', 'trail'],
  ['aws access key + bearer token / bare :: trail', 'trail'],
  ['aws access key + npm token / bare :: trail', 'trail'],
  ['aws access key + slack bot token / bare :: trail', 'trail'],
  ['aws access key + google api key / bare :: trail', 'trail'],
  ['aws access key + github fine-grained pat / bare :: trail', 'trail'],
  ['npm token + openai key / bare :: trail', 'trail'],
  ['npm token + github token / bare :: trail', 'trail'],
  ['npm token + jwt / bare :: trail', 'trail'],
  ['npm token + bearer token / bare :: trail', 'trail'],
  ['npm token + slack bot token / bare :: trail', 'trail'],
  ['npm token + google api key / bare :: trail', 'trail'],
  ['npm token + github fine-grained pat / bare :: trail', 'trail'],
  ['slack bot token + github token / bare :: trail', 'trail'],
  ['slack bot token + jwt / bare :: trail', 'trail'],
  ['slack bot token + bearer token / bare :: trail', 'trail'],
  ['slack bot token + npm token / bare :: trail', 'trail'],
  ['slack bot token + github fine-grained pat / bare :: trail', 'trail'],
  ['google api key + jwt / bare :: trail', 'trail'],
  ['google api key + bearer token / bare :: trail', 'trail'],
  ['github fine-grained pat + openai key / bare :: trail', 'trail'],
  ['github fine-grained pat + jwt / bare :: trail', 'trail'],
  ['github fine-grained pat + bearer token / bare :: trail', 'trail'],
  ['github fine-grained pat + slack bot token / bare :: trail', 'trail'],
  ['github fine-grained pat + google api key / bare :: trail', 'trail'],
])

const adjacency: Array<[string, string, Fragment[]]> = []
for (const lead of SAMPLES) {
  for (const trail of SAMPLES) {
    for (const [wrapperName, wrap] of WRAPPERS) {
      // A self-pair's two halves share one distinctive, and `includes` cannot
      // tell the copies apart, so they collapse to a single 'both' fragment
      // rather than being dropped.
      const fragments: Fragment[] =
        lead.distinctive === trail.distinctive
          ? [{ owner: 'both', text: lead.distinctive }]
          : [
              { owner: 'lead', text: lead.distinctive },
              { owner: 'trail', text: trail.distinctive },
            ]
      adjacency.push([
        `${lead.family} + ${trail.family} / ${wrapperName}`,
        `${wrap(lead.text)}${wrap(trail.text)}`,
        fragments,
      ])
    }
  }
}

const survivalKey = (caseName: string, fragment: Fragment): string =>
  `${caseName} :: ${fragment.owner}`

describe('adjacent secrets with no separator', () => {
  it('generates the expected number of cases', () => {
    expect(adjacency).toHaveLength(
      SAMPLES.length * SAMPLES.length * WRAPPERS.length,
    )
    // 15 families x 15 families x 12 wrappers.
    expect(adjacency).toHaveLength(2700)
  })

  it('records a reason for every known survival', () => {
    // J1 — a bare list of keys would rot into folklore. Every entry carries a
    // reason, and the reason has to be one of the three measured mechanisms.
    expect(KNOWN_SURVIVALS.size).toBe(83)
    for (const reason of KNOWN_SURVIVALS.values()) {
      expect(['lead', 'trail', 'both']).toContain(reason)
    }
  })

  it.each(adjacency)('%s — is clean and idempotent', (_name, input) => {
    const once = redactString(input, corpusOpts)
    expect(findSecrets(once, corpusOpts)).toEqual([])
    expect(redactString(once, corpusOpts)).toBe(once)
  })
})

describe('adjacent secrets: every surviving fragment is enumerated', () => {
  it.each(adjacency)('%s', (name, input, fragments) => {
    // J1 — the vacuity hole cannot reopen: every case carries at least one
    // fragment, and every fragment is asserted.
    expect(fragments.length).toBeGreaterThan(0)
    const out = redactString(input, corpusOpts)
    for (const fragment of fragments) {
      expect(input).toContain(fragment.text)
      const key = survivalKey(name, fragment)
      expect({ key, survives: out.includes(fragment.text) }).toEqual({
        key,
        survives: KNOWN_SURVIVALS.has(key),
      })
    }
  })

  it('has no baseline entry that names a case the corpus does not generate', () => {
    const generated = new Set(
      adjacency.flatMap(([name, , fragments]) =>
        fragments.map((fragment) => survivalKey(name, fragment)),
      ),
    )
    const orphans = [...KNOWN_SURVIVALS.keys()].filter(
      (key) => !generated.has(key),
    )
    expect(orphans).toEqual([])
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

// A8.2 — deny-list entries were screened for collision with this module's own
// replacement tokens; environment values were not, though both become rules
// the same way and both can poison the fixed-point loop the same way. The
// asymmetry was an inconsistency, not an exposure — the loop fails closed —
// but the failure it produced named a rule kind and a pass count, which is
// nothing an author can act on. Both now fail at the entry point with a
// message that says which variable to fix.
describe('an environment value that would poison the rule set is rejected up front', () => {
  // A substring of its own replacement token: each pass would rewrite the
  // previous pass's output and the string would grow without bound.
  const selfPoisoning = { ...corpusOpts, env: { MY_TOKEN: 'REDACTED:env' } }

  it('throws before scanning anything', () => {
    expect(() => redactString('an ordinary clean line', selfPoisoning)).toThrow(
      /collide with a redaction token/,
    )
  })

  // The deny-list guard reports an index because an entry has no name. An
  // environment variable does, and the NAME is not the secret — the value is.
  // Naming it is the whole difference between an actionable error and the
  // unactionable one this replaces.
  it('names the variable so the author knows what to fix', () => {
    expect(() => redactString('x', selfPoisoning)).toThrow(/MY_TOKEN/)
  })

  it('never puts the value in the message', () => {
    let caught: Error | undefined
    try {
      redactString('x', selfPoisoning)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).not.toContain('REDACTED:env')
  })

  // Confined to values that would actually have become rules. A guard that
  // ran over every ambient variable could fail a CI build over something that
  // was never going to be scanned for in the first place.
  it.each([
    ['a non-sensitive name', { HOME: 'REDACTED:env' }],
    ['a value below the rule threshold', { MY_TOKEN: 'ACTED:e' }],
  ])('ignores %s', (_label, env) => {
    expect(() =>
      redactString('an ordinary clean line', { ...corpusOpts, env }),
    ).not.toThrow()
  })
})

// H1 — the invariant is enforced, not assumed. redactString runs its
// scan/splice pass to a fixed point, and it must fail CLOSED when it cannot
// reach one rather than hand back a string the build gate would reject with
// no way for the author to fix it.
//
// A8.2 — the vehicle here used to be a self-poisoning environment value.
// Guarding those at the entry point (above) took that route away, so this
// uses cap exhaustion instead: each pass peels exactly one keyword-separator
// prefix, so more stacked prefixes than MAX_REDACTION_PASSES reaches the
// throw with a rule set that is converging perfectly well. That is the case
// the message is deliberately worded for.
describe('a scan that cannot settle within the cap fails closed', () => {
  const beyondTheCap = `${'token: '.repeat(80)}aaaaaaaa`

  it('throws instead of returning text the gate would reject', () => {
    let caught: Error | undefined
    try {
      redactString(beyondTheCap, corpusOpts)
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    expect(caught?.message).toContain('fixed point')
    expect(caught?.message).toContain('credential')
  })

  it('names the rule kind, never the value, in the thrown message', () => {
    let caught: Error | undefined
    try {
      redactString(beyondTheCap, corpusOpts)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).not.toContain('aaaaaaaa')
  })

  // I3.1 — the message must not claim a cause it cannot determine. Cap
  // exhaustion means "did not settle within the cap", which is exactly what
  // this input produces with no rule bug anywhere. Blaming the rule set
  // sends an author hunting a bug that does not exist.
  it('does not attribute cap exhaustion to a rule bug', () => {
    let caught: Error | undefined
    try {
      redactString(beyondTheCap, corpusOpts)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).not.toMatch(/match(es)? their own/)
  })

  // I3.3 — ordinary content must not be able to reach the throw. Measured:
  // the cap clears 64 stacked prefixes and no corpus case needs more than two
  // passes, so the headroom is real.
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
  // A8.2 — same substitution as the block above: the self-poisoning env value
  // is now rejected at the entry point, so the string that cannot settle is
  // one with more stacked keyword prefixes than the pass cap. None of the
  // keys below is credential-shaped, so the structural rule does not short
  // out the leaf before `redactString` sees it.
  const beyondTheCap = `${'token: '.repeat(80)}aaaaaaaa`

  const catchFrom = (value: unknown): string => {
    try {
      redactDeep(value, corpusOpts)
    } catch (err) {
      return (err as Error).message
    }
    return ''
  }

  it('reports the structural path to the offending string', () => {
    const message = catchFrom({
      frames: [{ type: 'user', content: beyondTheCap }],
    })
    expect(message).toContain('frames[0].content')
  })

  it('redacts the path itself, so the locator is not a new leak', () => {
    const message = catchFrom({ 'C:\\Users\\User\\notes.ts': beyondTheCap })
    expect(message).toContain('~\\notes.ts')
    expect(message).not.toContain('C:\\Users\\User')
  })

  it('still never prints the offending value', () => {
    const message = catchFrom({ a: { b: beyondTheCap } })
    expect(message).toContain('a.b')
    expect(message).not.toContain(beyondTheCap)
  })

  it('keeps the original error reachable as `cause`', () => {
    let caught: Error | undefined
    try {
      redactDeep({ a: beyondTheCap }, corpusOpts)
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.cause).toBeInstanceOf(Error)
    expect((caught?.cause as Error).message).toContain('fixed point')
  })
})

// A3 — the structural credential rule, which replaces the round-5 KNOWN
// LIMITATION block that used to sit here.
//
// That block pinned `{"token":"aaaaaaaa"}` as published-untouched-and-gate-
// clean. The gap it described was narrower than the real one: `redactDeep`
// walks PARSED structures, so a `tool_result` carrying `{ token: "aaaaaaaa" }`
// as an object reaches `redactString` as the bare leaf `"aaaaaaaa"`, with no
// keyword anywhere near it. Neither the text form nor the object form was
// covered, and the object form is the one that goes live at post 2 when
// `tool_call.args` and `tool_result.result` start carrying objects.
//
// The fix is structural rather than a wider text regex: when an object KEY is
// credential-shaped and its value is a string of 8 or more characters, the
// value goes. That adds no new text-matching surface at all — nothing that
// `redactString` used to leave alone is matched differently now — so it
// cannot regress the 3780-case corpus, which is what made widening the regex
// the riskier of the two options.
describe('a credential-shaped object key redacts its own value', () => {
  it.each([
    ['token', { token: 'aaaaaaaa' }],
    ['api_key', { api_key: 'SuperSecretValue123' }],
    ['apiKey', { apiKey: 'SuperSecretValue123' }],
    ['API-KEY', { 'API-KEY': 'SuperSecretValue123' }],
    ['password', { password: 'hunter2hunter2' }],
    ['secret', { secret: 'hunter2hunter2' }],
    ['credential', { credential: 'hunter2hunter2' }],
    ['access_token', { access_token: 'hunter2hunter2' }],
    ['Authorization-Token', { 'Authorization-Token': 'hunter2hunter2' }],
  ])('%s', (key, input) => {
    expect(redactDeep(input, corpusOpts)).toEqual({
      [key]: '[REDACTED:credential]',
    })
  })

  it('reaches a credential nested inside a recorded tool_result', () => {
    const trace = {
      frames: [
        {
          type: 'tool_result',
          id: 'call_1',
          ok: true,
          result: { headers: { Authorization: 'x' }, token: 'aaaaaaaa' },
        },
      ],
    }

    const out = redactDeep(trace, corpusOpts) as typeof trace
    expect(out.frames[0]?.result.token).toBe('[REDACTED:credential]')
  })

  // Detection and redaction must not drift apart — that is the defect this
  // module has been bitten by twice. A structural leak the redactor closes
  // but the gate cannot see is a hand-edited trace walking straight through
  // `npm run validate`.
  it('is reported by findSecretsDeep, not only fixed by redactDeep', () => {
    expect(findSecretsDeep({ token: 'aaaaaaaa' }, corpusOpts)).toEqual([
      'credential',
    ])
  })

  it('leaves nothing for findSecretsDeep once redactDeep has run', () => {
    const input = { args: { api_key: 'SuperSecretValue123' } }
    const once = redactDeep(input, corpusOpts)
    expect(findSecretsDeep(once, corpusOpts)).toEqual([])
    expect(redactDeep(once, corpusOpts)).toEqual(once)
  })

  // Short values are left alone, for the same reason the text rule requires
  // 8 characters: `{"token":"abc"}` is a placeholder, not a credential, and
  // redacting it would gut ordinary tool output.
  it.each([
    ['a short value', { token: 'abc' }],
    ['an empty value', { token: '' }],
  ])('leaves %s alone', (_label, input) => {
    expect(redactDeep(input, corpusOpts)).toEqual(input)
    expect(findSecretsDeep(input, corpusOpts)).toEqual([])
  })

  // The trace schema's own `tokens` field contains the substring "token".
  // It holds numbers, so the string-only condition keeps it safe — pinned
  // here because it is the one place this rule brushes against the format.
  it("does not touch the schema's own numeric tokens array", () => {
    const input = { tokens: [0, 1, 2], frames: [] }
    expect(redactDeep(input, corpusOpts)).toEqual(input)
  })

  it('recurses into a non-string value rather than stringifying it', () => {
    const input = { credentials: { user: 'alice', password: 'hunter2hunter2' } }
    expect(redactDeep(input, corpusOpts)).toEqual({
      credentials: { user: 'alice', password: '[REDACTED:credential]' },
    })
  })

  // The replacement is itself 21 characters under a credential-shaped key,
  // so an exact-equality exemption is what keeps the fixed point. Exact, not
  // a prefix test: a value that merely STARTS with the token is still a
  // secret with a disguise on, and skipping it is the H1 fail-open again.
  it('still redacts a value that only starts with a replacement token', () => {
    expect(
      redactDeep({ token: '[REDACTED:credential]andmoresecrettext' }, corpusOpts),
    ).toEqual({ token: '[REDACTED:credential]' })
  })
})

// What is LEFT of the round-5 KNOWN LIMITATION, now that the structural form
// is closed: a JSON document that arrives as a string LEAF rather than as
// parsed structure. `redactString` is pure text, and the text rule still
// needs its keyword immediately followed by `\s*[:=]`, which a closing quote
// breaks.
//
// Kept pinned, and kept honest about what it covers: the realistic shape the
// old block argued for — a `tool_result` carrying a JSON body — is a parsed
// object in this pipeline and is now handled. What remains is a JSON string
// embedded in a string, which a tool that returns raw stdout can still
// produce. Closing it means widening the text regex, which is the option the
// final review deliberately did not take.
describe('KNOWN LIMITATION — a quoted JSON key defeats the *text* credential rule', () => {
  it.each([
    ['a JSON object', '{"token":"aaaaaaaa"}', 'aaaaaaaa'],
    ['a JSON body with whitespace', '{ "api_key": "SuperSecretValue123" }', 'SuperSecretValue123'],
    ["single-quoted key", "{'password':'hunter2hunter2'}", 'hunter2hunter2'],
  ])('%s is published untouched as a bare string', (_name, input, secret) => {
    const out = redactString(input, corpusOpts)
    expect(out).toBe(input)
    expect(out).toContain(secret)
    // And the gate agrees it is clean, which is what makes it a leak rather
    // than a build failure.
    expect(findSecrets(out, corpusOpts)).toEqual([])
  })

  // The same three documents, parsed — which is how a recorded trace
  // actually carries them — are now closed on both sides.
  it.each([
    ['a JSON object', { token: 'aaaaaaaa' }],
    ['a JSON body with whitespace', { api_key: 'SuperSecretValue123' }],
    ['a single-quoted key', { password: 'hunter2hunter2' }],
  ])('%s is NOT published once parsed', (_name, parsed) => {
    expect(findSecretsDeep(parsed, corpusOpts)).toEqual(['credential'])
    expect(findSecretsDeep(redactDeep(parsed, corpusOpts), corpusOpts)).toEqual(
      [],
    )
  })
})

// A1 — the leak gate must not depend on WHOSE machine is running it.
//
// Every committed trace is redacted locally, against this author's Windows
// home directory. The CI gate re-scans those same traces on `ubuntu-latest`,
// where `homedir()` is `/home/runner` — so the exact-`homeDir` rule is built
// from a path that appears nowhere in the repository, and the `home-path`
// class, the single leak class this whole pipeline was justified by, could
// not fire in CI at all. Measured before the fix:
//
//   local gate ({homeDir:'C:\Users\User'}) on "read C:\Users\User\...\.env" -> ["home-path"]
//   CI gate    ({homeDir:'/home/runner'})  on the same string               -> []
//
// These cases pin the CI orientation specifically: a POSIX `homeDir` still
// catching a Windows home path. Every pre-existing test passed `homeDir`
// explicitly AND matching, which is exactly why none of them saw this.
describe('the home-shape rule does not depend on who is running the scan', () => {
  const ciOpts: RedactOptions = {
    homeDir: '/home/runner',
    denyList: [],
    env: {},
  }

  it.each([
    ['Windows native', 'read C:\\Users\\User\\projects\\nine-commits\\.env'],
    ['Windows forward-slash', 'read C:/Users/User/projects/nine-commits/.env'],
    ['Git-Bash (MSYS) drive form', 'read /c/Users/User/projects/x/.env'],
    ['another POSIX home', 'read /home/someone-else/projects/x/.env'],
    ['a macOS home', 'read /Users/someone-else/projects/x/.env'],
  ])('%s is caught when homeDir is a POSIX path', (_label, input) => {
    expect(findSecrets(input, ciOpts)).toEqual(['home-shape'])
    expect(redactString(input, ciOpts)).not.toContain('sers')
  })

  it('catches a Windows home path nested in a trace structure', () => {
    const trace = { frames: [{ content: 'wrote C:\\Users\\User\\out.json' }] }
    expect(findSecretsDeep(trace, ciOpts)).toEqual(['home-shape'])
  })

  // The two rules must stay legible apart in output: the exact-`homeDir`
  // rule keeps its own label, so a report still says whether the match was
  // THIS machine's home directory or merely home-shaped.
  it('keeps the exact-homeDir label when both rules cover the same span', () => {
    expect(findSecrets('read C:\\Users\\User\\x.ts', opts)).toEqual([
      'home-path',
    ])
  })

  // The generic class must not eat surrounding prose. A `[^\\/]+` user-name
  // segment (the literal form the finding proposed) also consumes spaces and
  // quotes, so `/home/runner and more text` would redact the whole sentence.
  it.each([
    ['prose after a POSIX home', '/home/runner and more text', '~ and more text'],
    ['prose after a macOS home', '/Users/someone and more text', '~ and more text'],
    ['a quoted Windows home', '"C:\\Users\\User\\x.ts"', '"~\\x.ts"'],
  ])('%s keeps everything that is not the path', (_label, input, expected) => {
    expect(redactString(input, ciOpts)).toBe(expected)
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
