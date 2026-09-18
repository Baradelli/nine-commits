import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseTrace } from './trace/schema.ts'
import { findSecretsDeep, type RedactOptions } from './trace/redact.ts'
import { defaultDenyList } from './trace/redact.config.ts'
import { POSTS_DIR, TRACE_FILE } from './paths.ts'

export { POSTS_DIR }

export type ValidationResult = {
  checked: number
  failures: string[]
}

/**
 * A1 — which home directory the gate should scan for.
 *
 * `homedir()` is right on the author's machine and wrong everywhere else: on
 * `ubuntu-latest` it is `/home/runner`, a path that appears in no committed
 * trace, so the exact-`homeDir` rule was built out of nothing. The generic
 * `home-shape` rule in `redact.ts` covers the general case; this override
 * lets CI additionally be told the author's real home directory, which is the
 * only form that catches a home path whose user-name segment the generic
 * class deliberately narrows away.
 *
 * A blank value falls back rather than being passed through: an empty
 * `homeDir` builds a catch-all pattern, and while `redact` rejects that
 * outright, failing the build on a CI misconfiguration nobody can see is
 * worse than falling back to the behaviour that was already there.
 */
export function resolveHomeDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.REDACT_HOME_DIR?.trim()
  return override !== undefined && override.length > 0 ? override : homedir()
}

/**
 * Re-parses every `trace*.json` under `postsDir` against the shared schema
 * and scans it for secrets — catching both a malformed hand-edit and a
 * hand-edit that reintroduces something `record-trace` would have redacted.
 * Assumes `postsDir` exists; callers check that first.
 *
 * A7 — it also fails when the tree says a trace should be there and it is
 * not. Before, a post with no trace was silently skipped and zero traces
 * still exited 0, so a green run here could not be told apart from a gate
 * that was not scanning anything at all.
 */
export function validateTraces(
  postsDir: string,
  opts: RedactOptions,
): ValidationResult {
  const failures: string[] = []
  let checked = 0
  let postDirs = 0

  for (const entry of readdirSync(postsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    postDirs += 1

    const postDir = join(postsDir, entry.name)
    const traceNames = readdirSync(postDir, { withFileTypes: true })
      .filter((file) => file.isFile() && TRACE_FILE.test(file.name))
      .map((file) => file.name)
      .sort()

    if (traceNames.length === 0 && existsSync(join(postDir, 'index.mdx'))) {
      failures.push(
        `${postDir}: has an index.mdx but no trace file (expected trace.json or trace-*.json)`,
      )
    }

    for (const name of traceNames) {
      const path = join(postDir, name)
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
  }

  // A7 — an empty collection is a legitimate state (there are no posts yet,
  // and phase 1 ships without one). Post directories that exist while not one
  // trace file was found is the shape of a gate that has stopped looking
  // where the traces are, and it must not print a green line.
  //
  // Only raised when nothing else already explains the zero: the per-post
  // "index.mdx but no trace" failure is the actionable one, and repeating the
  // same fact in aggregate would make a one-post repository report two
  // failures for one problem.
  if (postDirs > 0 && checked === 0 && failures.length === 0) {
    const plural = postDirs === 1 ? 'y' : 'ies'
    failures.push(
      `${postsDir}: ${postDirs} post director${plural} but 0 trace files found — the gate is not scanning anything`,
    )
  }

  return { checked, failures }
}

function main(): void {
  if (!existsSync(POSTS_DIR)) {
    console.log('no posts directory yet — nothing to validate')
    return
  }

  const opts = { homeDir: resolveHomeDir(), denyList: defaultDenyList }
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
