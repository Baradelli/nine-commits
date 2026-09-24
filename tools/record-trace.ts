import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalize } from './trace/normalize.ts'
import { defaultDenyList } from './trace/redact.config.ts'
import { readEnvFile, mergeEnv } from './trace/env-file.ts'
import { postTracePath } from './paths.ts'

// A2 — the agent's credentials live here and are loaded only by the agent's
// own `tsx --env-file=.env`. This process runs from the repository root, so
// without reading the file itself the env rule never sees the one real secret
// this project has.
const AGENT_ENV_FILE = join('agent', '.env')

function main(): void {
  const [rawPath, slug, outputName] = process.argv.slice(2)

  if (!rawPath || !slug) {
    console.error(
      'usage: npm run record -- <raw-trace.json> <post-slug> [output-name.json]',
    )
    process.exit(1)
  }

  // A9 — rejects a slug carrying `..` or a path separator before anything is
  // written. A5 — accepts `trace-a.json` / `trace-b.json`, so a compare-style
  // post's second trace does not have to be hand-written past the gate.
  const out = postTracePath(slug, outputName)

  const raw: unknown = JSON.parse(readFileSync(resolve(rawPath), 'utf8'))

  const trace = normalize(raw, {
    homeDir: homedir(),
    denyList: defaultDenyList,
    // Nothing loaded here is ever printed. Every value is a candidate secret,
    // and this is the rule set that exists to keep them out of the published
    // trace, not a place to report what was found.
    env: mergeEnv(process.env, readEnvFile(resolve(AGENT_ENV_FILE))),
  })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')

  console.log(`wrote ${out} (${trace.frames.length} frames, ${trace.outcome})`)
}

/*
 * Only run when this file is the process entry point.
 *
 * A module that does its work at import time does that work for anything that
 * imports it for a constant. `tools/context/tally.test.ts` imports two out of
 * `run-context.ts`, and without this guard that made `npm test` start a
 * hundred billed runs on any machine with a key in the environment. Every
 * entry point in the repository carries the guard now, and
 * `tools/entrypoints.test.ts` goes red if one of them loses it.
 */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
