import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseTrace } from './trace/schema.ts'
import { findSecrets } from './trace/redact.ts'
import { defaultDenyList } from './trace/redact.config.ts'

const POSTS_DIR = join('site', 'src', 'content', 'posts')

function main(): void {
  if (!existsSync(POSTS_DIR)) {
    console.log('no posts directory yet — nothing to validate')
    return
  }

  const opts = { homeDir: homedir(), denyList: defaultDenyList }
  const failures: string[] = []
  let checked = 0

  for (const entry of readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(POSTS_DIR, entry.name, 'trace.json')
    if (!existsSync(path)) continue

    checked += 1
    try {
      const trace = parseTrace(JSON.parse(readFileSync(path, 'utf8')))
      const leaks = findSecrets(JSON.stringify(trace), opts)
      if (leaks.length > 0) {
        failures.push(`${path}: leaks ${leaks.join(', ')}`)
      }
    } catch (error: unknown) {
      failures.push(`${path}: ${String(error)}`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }

  console.log(`validated ${checked} trace(s)`)
}

main()
