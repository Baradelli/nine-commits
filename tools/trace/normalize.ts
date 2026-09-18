import { parseTrace, type Trace } from './schema.ts'
import { redactDeep, findSecretsDeep, type RedactOptions } from './redact.ts'

export function normalize(raw: unknown, opts: RedactOptions): Trace {
  if (opts.homeDir.trim() === '') {
    throw new Error('normalize: homeDir must not be empty')
  }

  const redacted = redactDeep(raw, opts)
  const trace = parseTrace(redacted)

  // Scan the structure directly (as findSecretsDeep walks it) rather than
  // JSON.stringify(trace): JSON escaping doubles backslashes, which would
  // make a surviving Windows home path invisible to a raw-text regex scan
  // of the serialized form. findSecretsDeep also returns labels, never the
  // matched value, so this message is safe to print into public CI logs.
  const leaks = findSecretsDeep(trace, opts)
  if (leaks.length > 0) {
    throw new Error(
      `normalize: ${leaks.length} secret(s) survived redaction: ${leaks.join(', ')}`,
    )
  }

  return trace
}
