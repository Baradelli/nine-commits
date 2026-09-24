import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The most expensive defect this repository has shipped, and the cheapest one
 * to re-introduce.
 *
 * `tools/run-context.ts` called `main()` at module scope. `tally.test.ts`
 * imports two constants out of it, so `npm test` on a machine with
 * `OPENAI_API_KEY` in the environment started the hundred-run experiment: about
 * $2.26 of billed calls and a few dozen requests to somebody else's
 * encyclopaedia, from a command whose whole promise is that it is free to run.
 * It looked safe only because the machine it was written on had no key
 * exported, where it failed fast into a gitignored file.
 *
 * `run-judge.ts` already had the right shape. This test makes it the rule: any
 * file in this repository that defines a `main` and calls it at the top level
 * has to ask whether it is the process entry point first. Deleting the guard
 * from any one of them turns this red.
 *
 * It reads source rather than importing anything, deliberately. A test that
 * proved the guard by importing the module would be a test that spends money
 * when the guard is gone, which is the thing being defended against.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The exact predicate. Anything else is not this guard. */
const GUARD = 'import.meta.url === pathToFileURL(process.argv[1]).href'

/** A call to `main()` in column zero: the module doing its work on import. */
const UNGUARDED = /^main\(/m

/** Every hand-written source file that could be a command. */
function sources(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(path)
      } else if (
        // v8 adds `.mjs`. `tools/shell/unguarded.mjs` is a command — it is
        // `run_command` with every rule deleted, for the container
        // demonstration — and a test that only looked at `.ts` would have left
        // the most dangerous file in this repository as the one file it did not
        // check. Which extension a command happens to be written in is not a
        // property this test should have an opinion about.
        (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) &&
        !entry.name.endsWith('.test.ts')
      ) {
        found.push(path)
      }
    }
  }
  walk(join(ROOT, 'tools'))
  walk(join(ROOT, 'agent', 'src'))
  return found
}

const entryPoints = sources()
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  .filter(({ source }) => /^(export )?(async )?function main\(/m.test(source))
  .map(({ path, source }) => [path.slice(ROOT.length + 1).split(sep).join('/'), source] as const)

describe('every command guards its own entry point', () => {
  it('found the commands, so a rename cannot empty this test', () => {
    const names = entryPoints.map(([name]) => name)
    expect(names).toContain('tools/run-context.ts')
    expect(names).toContain('tools/run-judge.ts')
    expect(names).toContain('agent/src/cli.ts')
    expect(names).toContain('tools/run-shell.ts')
    expect(names).toContain('tools/shell/unguarded.mjs')
    expect(names.length).toBeGreaterThanOrEqual(11)
  })

  it.each(entryPoints)('%s never calls main() on import', (name, source) => {
    expect(UNGUARDED.test(source), `${name} calls main() at module scope`).toBe(false)
  })

  it.each(entryPoints)('%s checks process.argv[1] before running', (name, source) => {
    expect(source, `${name} is missing the entry-point guard`).toContain(GUARD)
  })
})
