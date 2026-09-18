import { parseTrace, type Trace } from './schema.ts'
import { redactDeep, findSecrets, type RedactOptions } from './redact.ts'

export function normalize(raw: unknown, opts: RedactOptions): Trace {
  if (opts.homeDir.trim() === '') {
    throw new Error('normalize: homeDir must not be empty')
  }

  const redacted = redactDeep(raw, opts)
  const trace = parseTrace(redacted)

  const leaks = findSecrets(JSON.stringify(trace), opts)
  if (leaks.length > 0) {
    throw new Error(
      `normalize: ${leaks.length} secret(s) survived redaction: ${leaks.join(', ')}`,
    )
  }

  return trace
}
