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
// rewrites its own replacement token, which grows without bound instead of
// settling — the one way a caller can stop redactString's fixed-point loop
// from converging. Rejected up front, at the entry point, rather than left
// to the loop's divergence guard (see F6).
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
//
// Deliberately carries NO negative lookahead for this module's own
// replacement tokens. Round 2 added `(?!\[REDACTED:)` here to stop the rule
// re-matching text the module had already emitted; that made the rule fail
// OPEN, because a real value that merely *starts* with the literal text
// "[REDACTED:" was then skipped in full, trailing secret and all
// ("secret: [REDACTED:x]andmoresecrettext" came out untouched). Idempotence
// is now an invariant of the driver below, not a property each rule has to
// encode about every other rule's output, so this rule can go back to being
// as greedy as a security boundary wants it to be.
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

function assertUsableDenyEntry(rawEntry: string, index: number): void {
  const trimmed = rawEntry.trim()
  if (trimmed.length === 0) {
    // H3 — consistent with the collision guard below: name the index, never
    // the value. (A blank entry has no value to leak, but a caller fixing a
    // 40-entry deny list needs to be told *which* entry, and the two guards
    // reporting the problem differently is the kind of inconsistency that
    // invites someone to "helpfully" interpolate the entry here later.)
    throw new Error(
      `redact: denyList entry at index ${index} must not be blank`,
    )
  }
  const lower = trimmed.toLowerCase()
  for (const token of REPLACEMENT_TOKENS) {
    if (token.toLowerCase().includes(lower)) {
      // G3 — a deny-list entry is, by definition, a literal string that
      // must never be published. This guard runs inside normalize(), which
      // runs in GitHub Actions on a public repository, so printing the
      // entry itself here would be the redaction module publishing the
      // exact secret it exists to protect. Name the problem, never the
      // value: index and length are enough to find and fix the entry.
      throw new Error(
        `redact: denyList entry at index ${index} (length ${trimmed.length}) is too short; it could collide with a redaction token`,
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

  for (const [index, rawEntry] of opts.denyList.entries()) {
    assertUsableDenyEntry(rawEntry, index)
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

/** One rule's match, located in the string it was found in. */
type Hit = {
  start: number
  end: number
  label: string
  replacement: string
  /** Index of the rule in the rule table; the tie-break for equal matches. */
  priority: number
}

/**
 * The single place that decides "what, in this exact string, is a secret".
 *
 * Every rule is matched against `input` independently — so no rule ever sees
 * another rule's replacement text within a pass — and the matches are then
 * merged into one left-to-right, non-overlapping list. Overlaps resolve
 * leftmost first, then longest, then by rule order.
 *
 * Both exported entry points are built on this, which is what keeps
 * detection and redaction from drifting apart: `findSecrets` reports the
 * labels of these hits, `redactString` splices over the very same spans. A
 * string has no hits if and only if `findSecrets` returns [] for it.
 */
function scanOnce(input: string, rules: Rule[]): Hit[] {
  const hits: Hit[] = []
  for (const [priority, rule] of rules.entries()) {
    // Every rule pattern is global; module-level literals are shared across
    // calls, so never trust an inherited lastIndex.
    rule.pattern.lastIndex = 0
    for (const match of input.matchAll(rule.pattern)) {
      const text = match[0]
      // A zero-length match would splice nothing and spin the fixed-point
      // loop below forever. The input guards make one impossible today;
      // this keeps that true for a rule nobody has written yet.
      if (match.index === undefined || text.length === 0) continue
      hits.push({
        start: match.index,
        end: match.index + text.length,
        label: rule.label,
        replacement: rule.replacement,
        priority,
      })
    }
    rule.pattern.lastIndex = 0
  }

  hits.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      a.priority - b.priority,
  )

  const chosen: Hit[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start < cursor) continue
    chosen.push(hit)
    cursor = hit.end
  }
  return chosen
}

function applyHits(input: string, hits: Hit[]): string {
  let out = ''
  let cursor = 0
  for (const hit of hits) {
    out += input.slice(cursor, hit.start) + hit.replacement
    cursor = hit.end
  }
  return out + input.slice(cursor)
}

/**
 * How many redaction passes may run before the module declares the rule set
 * divergent. Real chains are short — the longest one the corpus produces is
 * home-path -> bearer -> credential, three passes plus the confirming scan.
 */
const MAX_REDACTION_PASSES = 8

/**
 * Redacts to a *fixed point*: the returned string is one that `scanOnce`
 * finds nothing in, which is the same thing as saying
 * `findSecrets(redactString(x, opts), opts)` is `[]` and
 * `redactString(redactString(x, opts), opts) === redactString(x, opts)`.
 *
 * That invariant is established here, by running the scan/splice pass until
 * it reports nothing, rather than by asking each rule to recognise and avoid
 * each other rule's replacement text. Two rounds of the latter approach each
 * shipped a rule set that could still match its own output (a bare
 * `[REDACTED:bearer]` is 17 non-space characters, so it satisfies the
 * credential rule's `\S{8,}`; `~` is a member of the bearer rule's character
 * class), because that approach needs every rule to know about every other
 * rule's token — a pairwise obligation that grows with the rule set and that
 * nothing enforces. Here the postcondition is checked directly, so a tenth
 * rule cannot quietly break it: either the loop reaches a fixed point, or
 * this throws.
 *
 * It throws rather than returning a string the gate would reject, because
 * the alternative is a build that fails in `normalize` with no way for the
 * author to fix it by editing the trace. A rule set that cannot converge is
 * a bug in the rule set, and the message says so — in labels, never values.
 */
export function redactString(input: string, opts: RedactOptions): string {
  const rules = patterns(opts)
  let out = input
  for (let pass = 0; pass < MAX_REDACTION_PASSES; pass++) {
    const hits = scanOnce(out, rules)
    if (hits.length === 0) return out
    out = applyHits(out, hits)
  }

  const residual = scanOnce(out, rules)
  if (residual.length > 0) {
    const kinds = [...new Set(residual.map((hit) => hit.label))].sort()
    throw new Error(
      `redact: rule set did not reach a fixed point after ${MAX_REDACTION_PASSES} passes; these kinds still match their own redacted output: ${kinds.join(', ')}`,
    )
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
  // Same scan redactString splices over, so the gate and the redactor can
  // never disagree about what counts as a secret. Labels come out in
  // left-to-right order of the text, not in rule order.
  return scanOnce(input, patterns(opts)).map((hit) => hit.label)
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
