export type RedactOptions = {
  /** Absolute path to the machine's home directory, e.g. "C:\\Users\\User". */
  homeDir: string
  /** Literal strings that must never be published. */
  denyList: string[]
}

const API_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patterns(opts: RedactOptions): Array<[RegExp, string]> {
  const rules: Array<[RegExp, string]> = [
    [API_KEY, '[REDACTED:api-key]'],
    [BEARER, '[REDACTED:bearer]'],
    [new RegExp(escapeRegExp(opts.homeDir), 'gi'), '~'],
  ]
  for (const denied of opts.denyList) {
    if (denied.length > 0) {
      rules.push([new RegExp(escapeRegExp(denied), 'gi'), '[REDACTED:denied]'])
    }
  }
  return rules
}

export function redactString(input: string, opts: RedactOptions): string {
  let out = input
  for (const [pattern, replacement] of patterns(opts)) {
    out = out.replace(pattern, replacement)
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
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[redactString(key, opts)] = redactDeep(val, opts)
    }
    return out as T
  }
  return value
}

/** Returns every remaining secret-shaped substring. An empty array means clean. */
export function findSecrets(input: string, opts: RedactOptions): string[] {
  const found: string[] = []
  for (const [pattern] of patterns(opts)) {
    const matches = input.match(pattern)
    if (matches) found.push(...matches)
  }
  return found
}
