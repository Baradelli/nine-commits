import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { normalize } from './trace/normalize.ts'
import { defaultDenyList } from './trace/redact.config.ts'

function main(): void {
  const [rawPath, slug] = process.argv.slice(2)

  if (!rawPath || !slug) {
    console.error('usage: npm run record -- <raw-trace.json> <post-slug>')
    process.exit(1)
  }

  const raw: unknown = JSON.parse(readFileSync(resolve(rawPath), 'utf8'))

  const trace = normalize(raw, {
    homeDir: homedir(),
    denyList: defaultDenyList,
  })

  const out = join('site', 'src', 'content', 'posts', slug, 'trace.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')

  console.log(`wrote ${out} (${trace.frames.length} frames, ${trace.outcome})`)
}

main()
