export type RedactOptions = {
  /** Absolute path to the machine's home directory, e.g. "C:\\Users\\User". */
  homeDir: string
  /** Literal strings that must never be published. */
  denyList: string[]
  /**
   * Environment variables to scan for sensitive values. Defaults to
   * `process.env`. Injectable so callers can test this without mutating
   * the real environment.
   */
  env?: Record<string, string | undefined>
}

type Rule = {
  pattern: RegExp
  replacement: string
  /** Machine-readable kind, safe to surface in errors and reports — never the matched value itself. */
  label: string
}

const MIN_HOME_DIR_LENGTH = 3
const SENSITIVE_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD)/i
const MIN_ENV_VALUE_LENGTH = 8

// The literal replacement text every rule can produce. A deny-list entry
// that collides with one of these (case-insensitively, as a substring)
// would rewrite its own replacement token and wedge findSecrets into a
// permanent false leak — see F6.
const REPLACEMENT_TOKENS = [
  '~',
  '[REDACTED:api-key]',
  '[REDACTED:jwt]',
  '[REDACTED:bearer]',
  '[REDACTED:credential]',
  '[REDACTED:denied]',
  '[REDACTED:env]',
]

// Vendor-prefixed API key shapes: OpenAI, GitHub (classic + fine-grained),
// AWS, Google, Slack, npm.
const API_KEY =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Za-z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|xoxb-[A-Za-z0-9-]{20,}|npm_[A-Za-z0-9]{20,})\b/g

// A bare JSON Web Token: three dot-separated base64url segments.
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi

// A generic "<sensitive name><separator><value>" assignment, for keys that
// don't match a known vendor shape (e.g. a plain DB_PASSWORD env dump).
const CREDENTIAL_ASSIGNMENT =
  /(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*\S{8,}/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assertUsableHomeDir(homeDir: string): void {
  if (homeDir.trim().length < MIN_HOME_DIR_LENGTH) {
    throw new Error(
      `redact: homeDir must be a real absolute path (at least ${MIN_HOME_DIR_LENGTH} characters after trimming); an empty or too-short value would build a catch-all pattern that corrupts every string`,
    )
  }
}

function assertUsableDenyEntry(rawEntry: string): void {
  const trimmed = rawEntry.trim()
  if (trimmed.length === 0) {
    throw new Error('redact: denyList entries must not be blank')
  }
  const lower = trimmed.toLowerCase()
  for (const token of REPLACEMENT_TOKENS) {
    if (token.toLowerCase().includes(lower)) {
      throw new Error(
        `redact: denyList entry "${trimmed}" is too short — it collides with a redaction replacement token and would self-poison output`,
      )
    }
  }
}

/**
 * Builds the home-directory alternation across the forms the same absolute
 * path takes on this toolchain: native separators, forward slashes, and the
 * Git-Bash/MSYS drive form (e.g. "C:\Users\User" -> "/c/Users/User"). The
 * global constraints mandate Git Bash, so that third form is routine in
 * recorded tool output, not a hypothetical.
 */
function homeDirVariants(homeDir: string): string[] {
  const variants = new Set<string>([homeDir])
  if (homeDir.includes('\\')) {
    variants.add(homeDir.replace(/\\/g, '/'))
  }
  const winDrive = /^([A-Za-z]):[\\/](.*)$/.exec(homeDir)
  if (winDrive) {
    const drive = (winDrive[1] ?? '').toLowerCase()
    const rest = (winDrive[2] ?? '').replace(/\\/g, '/')
    variants.add(`/${drive}/${rest}`)
  }
  return [...variants]
}

function patterns(opts: RedactOptions): Rule[] {
  assertUsableHomeDir(opts.homeDir)

  const rules: Rule[] = [
    {
      pattern: CREDENTIAL_ASSIGNMENT,
      replacement: '[REDACTED:credential]',
      label: 'credential',
    },
    { pattern: API_KEY, replacement: '[REDACTED:api-key]', label: 'api-key' },
    { pattern: JWT, replacement: '[REDACTED:jwt]', label: 'jwt' },
    { pattern: BEARER, replacement: '[REDACTED:bearer]', label: 'bearer' },
  ]

  const homeAlternation = homeDirVariants(opts.homeDir)
    .map(escapeRegExp)
    .join('|')
  rules.push({
    pattern: new RegExp(homeAlternation, 'gi'),
    replacement: '~',
    label: 'home-path',
  })

  for (const rawEntry of opts.denyList) {
    assertUsableDenyEntry(rawEntry)
    const trimmed = rawEntry.trim()
    rules.push({
      pattern: new RegExp(escapeRegExp(trimmed), 'gi'),
      replacement: '[REDACTED:denied]',
      label: 'denied',
    })
  }

  const env = opts.env ?? process.env
  for (const [name, value] of Object.entries(env)) {
    if (
      typeof value === 'string' &&
      value.length >= MIN_ENV_VALUE_LENGTH &&
      SENSITIVE_ENV_NAME.test(name)
    ) {
      rules.push({
        pattern: new RegExp(escapeRegExp(value), 'g'),
        replacement: '[REDACTED:env]',
        label: 'env-value',
      })
    }
  }

  return rules
}

export function redactString(input: string, opts: RedactOptions): string {
  let out = input
  for (const rule of patterns(opts)) {
    out = out.replace(rule.pattern, rule.replacement)
  }
  return out
}

export function redactDeep<T>(value: T, opts: RedactOptions): T {
  if (typeof value === 'string') {
    return redactString(value, opts) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, opts)) as T
  }
  if (value !== null && typeof value === 'object') {
    // Object.create(null) (no prototype) instead of {} (Object.prototype):
    // writing out['__proto__'] into a plain {} invokes Object.prototype's
    // __proto__ setter and silently sets the object's prototype instead of
    // creating an own property, dropping that key from the result. Recorded
    // traces arrive via JSON.parse, which can produce a genuine own
    // "__proto__" property, so this is a real input shape, not a contrived one.
    const out: Record<string, unknown> = Object.create(null)
    for (const [key, val] of Object.entries(value)) {
      out[redactString(key, opts)] = redactDeep(val, opts)
    }
    return out as T
  }
  return value
}

/**
 * Returns the label of every remaining secret-shaped match — never the
 * matched value itself, so a failure message built from this can be
 * printed safely into public CI logs. An empty array means clean.
 */
export function findSecrets(input: string, opts: RedactOptions): string[] {
  const found: string[] = []
  for (const rule of patterns(opts)) {
    const matches = input.match(rule.pattern)
    if (matches) {
      for (const _ of matches) found.push(rule.label)
    }
  }
  return found
}

/**
 * Walks a value the same way redactDeep does — scanning every raw string
 * leaf and every object key — and reports remaining secret labels. Unlike
 * scanning JSON.stringify(value), this never misses a leak hidden by
 * JSON's own escaping (e.g. a Windows path's backslashes doubling).
 */
export function findSecretsDeep(value: unknown, opts: RedactOptions): string[] {
  const found: string[] = []
  const walk = (current: unknown): void => {
    if (typeof current === 'string') {
      found.push(...findSecrets(current, opts))
      return
    }
    if (Array.isArray(current)) {
      for (const item of current) walk(item)
      return
    }
    if (current !== null && typeof current === 'object') {
      for (const [key, val] of Object.entries(current)) {
        found.push(...findSecrets(key, opts))
        walk(val)
      }
    }
  }
  walk(value)
  return found
}
