import { readFileSync } from 'node:fs'

/**
 * Reads a `.env` file into a plain record. Returns `{}` when the file is
 * absent or unreadable.
 *
 * A2 — why this exists at all. Spec §4.2 mandates redacting environment
 * variable values, and `redact.patterns()` implements that against
 * `process.env`. But this project's only real secret, `OPENAI_API_KEY`, lives
 * in `agent/.env` and is loaded only by the agent's own `tsx --env-file=.env`.
 * `npm run record` runs from the repository root with no `--env-file`, so the
 * variable is undefined there and the env rule contributed nothing — the
 * backstop for a credential the vendor regexes do not recognise (an org id, a
 * proxy token, an Azure key embedded in an SDK auth error) was never
 * populated. The recorder loads the file through here and passes the merged
 * environment explicitly.
 *
 * `process.loadEnvFile` would do most of this, but it mutates the ambient
 * `process.env` of whatever is running — which is the wrong shape for a
 * redaction input that `redact.ts` deliberately takes as an injectable
 * option, and it throws rather than tolerating an absent file.
 *
 * Nothing in here logs, and callers must not either: every value this returns
 * is, by construction, a candidate secret.
 */
export function readEnvFile(path: string): Record<string, string> {
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    return {}
  }

  const env: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator <= 0) continue

    const name = line.slice(0, separator).replace(/^export\s+/, '').trim()
    if (name === '') continue

    env[name] = unquote(line.slice(separator + 1).trim())
  }
  return env
}

/**
 * Merges env-file entries into an ambient environment for redaction.
 *
 * `{ ...process.env, ...fileEnv }` would be wrong here: `redact.patterns()`
 * builds one rule per NAME, so a name present in both with different values
 * loses one of them — and a stale `OPENAI_API_KEY` exported in the author's
 * shell is exactly as much of a secret as the current one in `agent/.env`.
 * A conflicting file value is therefore filed under a distinct name instead
 * of overwriting, so both get a rule. The name never reaches output; it only
 * decides whether the value is treated as sensitive.
 */
export function mergeEnv(
  base: Record<string, string | undefined>,
  fileEnv: Record<string, string>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...base }
  for (const [name, value] of Object.entries(fileEnv)) {
    const existing = merged[name]
    if (existing === undefined || existing === value) {
      merged[name] = value
    } else {
      merged[`${name} (env file)`] = value
    }
  }
  return merged
}

/**
 * Strips one matching pair of surrounding quotes. Whitespace inside a quoted
 * value is part of the value — a secret's padding is still the secret — so
 * only the line's own surrounding whitespace is trimmed, by the caller,
 * before this runs.
 */
function unquote(value: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  return quoted ? (quoted[2] ?? '') : value
}
