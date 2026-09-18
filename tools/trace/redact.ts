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

// J2 — the value class is *tempered*: it consumes any character of the token
// alphabet except one that begins another `Bearer`. Untempered, the class ran
// straight through the next token's own keyword, so `Bearer XBearer Y` matched
// once — covering the first token and the literal word `Bearer` — and
// published ` Y` with the gate reporting clean, because the second token's
// `\b` anchor had been eaten and nothing could match it afterwards. Tempered,
// the match stops at the boundary, the splice puts a `]` there which restores
// the word boundary, and the fixed-point loop picks the second token up on the
// next pass.
//
// Only the two rules ending in an open-ended value class get this. API_KEY and
// JWT end in `\b`, and a tempered class there stops mid-word-run where no `\b`
// exists, so the engine backtracks and the rule matches NOTHING: measured,
// `sk-…Bearer …` would go from a tail leak to being published entirely
// unredacted. Tempering those two is strictly worse than leaving them.
const BEARER = /\bBearer\s+(?:(?!Bearer)[A-Za-z0-9._~+/=-]){8,}/gi

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
//
// J2 — greedy, but tempered, for the same reason BEARER is: an untempered
// `\S{8,}` ran through a following assignment's own keyword, so
// `token: aaaaaaaatoken: bbbbbbbb` matched once and published the second
// value. The temper rejects only a position that starts another
// keyword-AND-separator, never a bare keyword, and that distinction is
// load-bearing: `secret: [REDACTED:x]andmoresecrettext` has the word "secret"
// inside its value, and stopping there would leave `secrettext` behind — the
// H1 fail-open all over again. The alternation is written once and reused in
// both places, so the rule and its own temper cannot drift apart.
const CREDENTIAL_KEYWORD = 'api[_-]?key|token|secret|password|credential'
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(?:${CREDENTIAL_KEYWORD})\\s*[:=]\\s*(?:(?!(?:${CREDENTIAL_KEYWORD})\\s*[:=])\\S){8,}`,
  'gi',
)

// A1 — a home-directory rule that does NOT depend on whose machine is running
// the scan.
//
// `patterns()` builds an exact rule from `opts.homeDir`, which is right for
// the recorder (it runs on the author's machine, against the author's own
// paths) and useless for the CI gate (it runs on `ubuntu-latest`, where
// `homedir()` is `/home/runner` — a path that appears in no committed trace).
// So the one leak class this pipeline exists for could not fire in CI at all.
// This rule closes that: it matches the SHAPE of a home directory on any of
// the three platforms plus the Git-Bash/MSYS drive form, so the gate catches a
// Windows home path no matter what `homeDir` it was handed.
//
// Two deliberate narrowings against the obvious spelling:
//
// 1. The user-name segment is `[A-Za-z0-9._@-]+`, not `[^\\/]+`. The latter
//    also consumes spaces, quotes and punctuation, so `/home/runner and more
//    prose` would redact the prose along with the path — silent data loss in
//    the published trace, from a rule whose whole job is to be a safety net. A
//    name containing a space (`C:\Users\John Smith`) still matches its first
//    word, so the gate still fires; it just does not swallow the sentence.
//
// 2. It is case-SENSITIVE where case is load-bearing. `/Users/` and `/home/`
//    are matched as spelled, because a lowercase `/users/` is far more likely
//    to be a REST path (`api.example.com/users/42`) than a home directory and
//    redacting that would corrupt ordinary tool output. The drive-anchored
//    Windows forms accept `Users` or `users`, since a `C:\` ahead of them
//    leaves no ambiguity.
const HOME_SHAPE =
  /(?:[A-Za-z]:[\\/][Uu]sers[\\/]|\/[a-z]\/Users\/|\/Users\/|\/home\/)[A-Za-z0-9._@-]+/g

// A3 — the STRUCTURAL credential rule.
//
// `CREDENTIAL_ASSIGNMENT` above needs its keyword immediately followed by
// `\s*[:=]`, and this pipeline's own serialization format puts a closing quote
// in between: `{"token":"aaaaaaaa"}` matches nothing. Worse, the text form was
// never the realistic shape — `redactDeep` walks PARSED structures, so a
// `tool_result` carrying `{ token: "aaaaaaaa" }` reaches `redactString` as the
// bare leaf `"aaaaaaaa"`, with no keyword adjacent to it at all. Neither form
// was covered, and the object form goes live at post 2 when `tool_call.args`
// and `tool_result.result` start carrying objects.
//
// Fixed here rather than by widening the text regex: this looks at structure
// the text rules cannot see, so it adds no new text-matching surface and
// cannot change what `redactString` does to any string. The 3780-case corpus
// exercises `redactString`, so it is untouched by construction.
//
// Applied in `redactNode` AND in `findSecretsDeep`, never in only one of them.
// Redaction and detection drifting apart is this module's recurring defect
// (G1, G2): a structural leak the redactor closes but the gate cannot see is a
// hand-edited trace walking straight through `npm run validate`.
const CREDENTIAL_KEY = new RegExp(CREDENTIAL_KEYWORD, 'i')
const MIN_CREDENTIAL_VALUE_LENGTH = 8

/**
 * Whether `value` is a credential by virtue of the key it is filed under.
 *
 * The exemption is EXACT equality with a replacement token, not a prefix or
 * substring test. `[REDACTED:credential]` is 21 characters under a
 * credential-shaped key, so without it this rule would re-fire on its own
 * output forever; with a prefix test instead, a value that merely starts with
 * the token would be skipped in full, trailing secret and all — which is
 * precisely the H1 fail-open the text rule had to have removed.
 */
function isStructuralCredential(key: string, value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_CREDENTIAL_VALUE_LENGTH &&
    CREDENTIAL_KEY.test(key) &&
    !REPLACEMENT_TOKENS.includes(value)
  )
}

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
  if (collidesWithReplacementToken(trimmed)) {
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

/**
 * A8.2 — the same collision guard the deny list gets, for environment values.
 *
 * Both become rules the same way and both can stop `redactString`'s
 * fixed-point loop from converging the same way, but only deny-list entries
 * were screened. The loop fails closed either way, so this is usability
 * rather than exposure: the failure it replaces named a rule kind and a pass
 * count, which is nothing an author can act on, while this one names the
 * variable to fix.
 *
 * The variable's NAME is not the secret — the value is — so unlike the
 * deny-list guard this one can afford to be specific. The value never
 * appears.
 *
 * Only applied to values that would actually have become rules (sensitive
 * name, long enough). A guard over every ambient variable could fail a CI
 * build over content that was never going to be scanned for in the first
 * place.
 */
function assertUsableEnvValue(name: string, value: string): void {
  if (collidesWithReplacementToken(value)) {
    throw new Error(
      `redact: the value of ${name} (length ${value.length}) is too short; it could collide with a redaction token`,
    )
  }
}

/**
 * Whether redacting `value` would leave text that still contains `value`,
 * which is the one way a caller-supplied literal can make the fixed-point
 * loop grow without bound instead of settling.
 */
function collidesWithReplacementToken(value: string): boolean {
  const lower = value.toLowerCase()
  return REPLACEMENT_TOKENS.some((token) =>
    token.toLowerCase().includes(lower),
  )
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
  // Pushed AFTER the exact rule on purpose. When both cover the same span the
  // union keeps the lower-priority contributor's label, so a report still
  // distinguishes "this machine's home directory" (`home-path`) from "merely
  // home-shaped" (`home-shape`).
  rules.push({
    pattern: HOME_SHAPE,
    replacement: '~',
    label: 'home-shape',
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
      assertUsableEnvValue(name, value)
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
 * reduced to a left-to-right list of disjoint spans by taking their **union**:
 * overlapping matches are merged into one span covering all of them, and the
 * merged span carries the label of its leftmost (then longest, then
 * highest-priority) contributor.
 *
 * The union is the point. The obvious alternative — pick a non-overlapping
 * subset and drop the losers — silently publishes a loser's uncovered tail
 * whenever the winner ends inside it, and nothing downstream can recover it:
 * the truncated remainder no longer matches any rule, so the fixed-point loop
 * settles and the gate reports clean. Measured, with built-in rules only:
 * `npm_a1b2c3d4e5f6g7h8i9j0password=hunter2hunter2` redacted to
 * `[REDACTED:api-key]=hunter2hunter2`. Taking the union instead makes the
 * guarantee "every character any rule matched is replaced" rather than "the
 * chosen subset of matches is replaced", which is the difference between
 * "no rule matches the result" and "no matched material survives".
 *
 * Merging is transitive by construction: a span extended by one overlap is
 * compared against the next match using its new end, so a chain of pairwise
 * overlaps collapses into a single span. Matches that merely touch — the next
 * one starts exactly where the open span ends — stay separate, so two adjacent
 * secrets still produce two tokens rather than one.
 *
 * Both exported entry points are built on this, which is what keeps detection
 * and redaction from drifting apart: `findSecrets` reports the labels of these
 * spans, `redactString` splices over the very same spans. A string has no
 * spans if and only if `findSecrets` returns [] for it.
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

  const merged: Hit[] = []
  for (const hit of hits) {
    const open = merged[merged.length - 1]
    if (open && hit.start < open.end) {
      // Overlaps the span we are building: absorb it rather than discard it,
      // so its uncovered tail (if any) is redacted too.
      if (hit.end > open.end) open.end = hit.end
      continue
    }
    merged.push({ ...hit })
  }
  return merged
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
 * How many redaction passes may run before the module gives up.
 *
 * I4 — measured, not estimated: no case in the generated corpus needs more
 * than two applied passes (a cap of 2 clears all of it).
 *
 * The cap is nevertheless far above that, because pass count is not only a
 * property of the rule set. Each pass peels exactly one keyword-separator
 * prefix off a stacked value, so `'token: '.repeat(n)` needs n passes with a
 * rule set that is converging perfectly well. At 8 that put ordinary — if
 * silly — content within reach of a throw whose message blamed the rules. A
 * high cap costs nothing (the loop exits on the first clean scan, so
 * convergent input never pays for the headroom) and keeps the throw for the
 * case it is actually for: a rule whose replacement re-triggers itself and
 * grows without bound.
 */
const MAX_REDACTION_PASSES = 64

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
 * author to fix it by editing the trace.
 *
 * The message states only what cap exhaustion actually establishes — that the
 * scan had not settled within the cap — and does not attribute it to a rule
 * bug. It cannot: a convergent rule set reaches the cap too, on input with
 * enough stacked keyword prefixes. Labels and counts, never values.
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
      `redact: did not reach a fixed point after ${MAX_REDACTION_PASSES} passes; still matching: ${kinds.join(', ')}`,
    )
  }
  return out
}

/**
 * I3 — a divergence throw from `redactString` names a rule kind but not a
 * place, and it is raised one leaf at a time from inside a whole trace. Add
 * the structural path so the author can find the string, once, at the leaf
 * where it happened (nothing above catches, so this never double-prefixes).
 *
 * `where` is built from **redacted** path segments. Object keys are redacted
 * content in this module — `redactDeep` rewrites them — so an unredacted key
 * in an error message would make the locator a fresh leak of exactly the kind
 * the rest of the module exists to prevent.
 */
function located(err: unknown, where: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  // `cause` keeps the original error (and its stack) reachable. Only the
  // message is ever printed by normalize, and the original message is already
  // label-only, so this adds a debugging handle without adding a leak surface.
  return new Error(`${message} (at ${where || '<root>'})`, { cause: err })
}

export function redactDeep<T>(value: T, opts: RedactOptions): T {
  return redactNode(value, opts, '')
}

function redactNode<T>(value: T, opts: RedactOptions, where: string): T {
  if (typeof value === 'string') {
    try {
      return redactString(value, opts) as T
    } catch (err) {
      throw located(err, where)
    }
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactNode(item, opts, `${where}[${index}]`),
    ) as T
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
      let safeKey: string
      try {
        safeKey = redactString(key, opts)
      } catch (err) {
        // The key itself diverged; there is no redacted spelling of it to put
        // in the path, so say which position it was without naming it.
        throw located(err, `${where}${where ? '.' : ''}<key>`)
      }
      // A3 — decided from the RAW key, not `safeKey`: redacting the key can
      // remove the very keyword that makes the value a credential, and this
      // rule must only ever match more, never less.
      out[safeKey] = isStructuralCredential(key, val)
        ? '[REDACTED:credential]'
        : redactNode(val, opts, `${where}${where ? '.' : ''}${safeKey}`)
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
        // A3 — the same structural test `redactNode` applies, so the gate
        // sees exactly what the redactor would have removed. Reported
        // INSTEAD of walking the leaf, mirroring the redactor replacing the
        // whole value rather than scanning it.
        if (isStructuralCredential(key, val)) {
          found.push('credential')
          continue
        }
        walk(val)
      }
    }
  }
  walk(value)
  return found
}
