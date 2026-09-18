import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseTrace } from './trace/schema.ts'
import { findSecretsDeep, type RedactOptions } from './trace/redact.ts'
import { defaultDenyList } from './trace/redact.config.ts'

export const POSTS_DIR = join('site', 'src', 'content', 'posts')

export type ValidationResult = {
  checked: number
  failures: string[]
}

/**
 * Re-parses every `trace.json` under `postsDir` against the shared schema
 * and scans it for secrets — catching both a malformed hand-edit and a
 * hand-edit that reintroduces something `record-trace` would have redacted.
 * Assumes `postsDir` exists; callers check that first.
 */
export function validateTraces(
  postsDir: string,
  opts: RedactOptions,
): ValidationResult {
  const failures: string[] = []
  let checked = 0

  for (const entry of readdirSync(postsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(postsDir, entry.name, 'trace.json')
    if (!existsSync(path)) continue

    checked += 1
    try {
      const trace = parseTrace(JSON.parse(readFileSync(path, 'utf8')))
      // Scan the parsed structure directly, as findSecretsDeep walks it —
      // not JSON.stringify(trace). JSON escaping doubles backslashes,
      // which would make a surviving Windows home path invisible to a
      // raw-text regex scan of the serialized form (see normalize.ts).
      const leaks = findSecretsDeep(trace, opts)
      if (leaks.length > 0) {
        failures.push(`${path}: leaks ${leaks.join(', ')}`)
      }
    } catch (error: unknown) {
      failures.push(`${path}: ${String(error)}`)
    }
  }

  return { checked, failures }
}

function main(): void {
  if (!existsSync(POSTS_DIR)) {
    console.log('no posts directory yet — nothing to validate')
    return
  }

  const opts = { homeDir: homedir(), denyList: defaultDenyList }
  const { checked, failures } = validateTraces(POSTS_DIR, opts)

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }

  console.log(`validated ${checked} trace(s)`)
}

// Only run as a CLI entrypoint, never on import (the test file imports
// `validateTraces` directly and must not trigger a real filesystem scan
// or a process.exit as a side effect of that import).
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
