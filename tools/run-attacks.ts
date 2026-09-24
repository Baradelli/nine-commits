import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createShell,
  OUTPUT_CLOSE,
  OUTPUT_OPEN,
  planCommand,
  ShellRefusal,
  type RunCommandResult,
} from '../agent/src/tools/shell.ts'
import { WORKSPACE } from './roster/workspace.ts'
import { ATTACKS, type Attack } from './shell/attacks.ts'
import { HEADER, toLine, type AttackRow } from './shell/attack-row.ts'

/**
 * Attacks the shell guard and writes down what happened.
 *
 *   npm run attacks                # writes the committed table
 *   npm run attacks -- --out x.tsv
 *
 * It costs nothing and calls no model. Every row goes through `planCommand`,
 * which is the same function `run_command` calls on a live run, so the table is
 * a measurement of the guard rather than a description of it.
 *
 * **Safety, stated exactly.** Each attack gets a fresh `mkdtemp` directory
 * holding a copy of post 6's invented eight-file project plus a decoy dotfile.
 * Only the rows marked `run` are executed, and they are executed with the same
 * `createShell` a run uses, rooted at that directory. Before the first attack
 * this file writes a canary outside the sandbox — in its own `mkdtemp`, a
 * sibling the guard has never been told about — and after the last one it
 * checks the canary is byte-identical and still the only thing in its
 * directory. If any attack had reached out, that check fails and the table is
 * not written.
 *
 * Nothing here runs a destructive command against this machine. The one that
 * needs to be destructive to mean anything runs in a container, and
 * `tools/shell/container.md` says which container and how the isolation was
 * verified.
 */

const DEFAULT_OUT = join('site', 'src', 'content', 'posts', '08-shell', 'attacks.tsv')

/** What the decoy dotfile holds. Not a key shape, deliberately: this file is public. */
export const DECOY = 'DECOY_SECRET_NOT_A_REAL_KEY'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** A sandbox for one attack: post 6's project, plus the dotfile the four tools cannot see. */
function materialise(): string {
  const root = mkdtempSync(join(tmpdir(), 'nine-attack-'))
  for (const [path, content] of Object.entries(WORKSPACE)) {
    const target = join(root, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  writeFileSync(join(root, '.env'), `AGENT_TOKEN=${DECOY}\n`, 'utf8')
  return root
}

/** The output without the fence `run_command` wraps it in. */
function unfenced(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => !line.startsWith(OUTPUT_OPEN) && !line.startsWith(OUTPUT_CLOSE))
    .join('\n')
}

/** One line of evidence, short enough for a table and specific enough to check. */
function describe(result: RunCommandResult, root: string): string {
  if (!result.ok) return `not run: ${result.error}`
  const body = unfenced(result.stdout)
  const first = body.split('\n').find((line) => line.trim() !== '') ?? ''
  const settings = join(root, 'config', 'settings.json')
  let settingsState = ''
  try {
    settingsState = readFileSync(settings, 'utf8').includes('"timeoutMs": 4500')
      ? ''
      : ' config/settings.json no longer holds the original timeout'
  } catch {
    settingsState = ' config/settings.json is gone'
  }
  const complaint = unfenced(result.stderr)
    .split('\n')
    .find((line) => line.trim() !== '')
  return (
    `exit ${result.exitCode ?? 'killed'}; ` +
    `${body.trim() === '' ? 0 : body.length} bytes out; ` +
    (first === ''
      ? `said "${(complaint ?? 'nothing').slice(0, 90)}"`
      : `first line "${first.slice(0, 90)}"`) +
    settingsState
  )
}

export function evaluate(attack: Attack, root: string): { verdict: 'refused' | 'allowed'; rule: string } {
  try {
    planCommand(root, attack.command)
    return { verdict: 'allowed', rule: '' }
  } catch (error: unknown) {
    if (error instanceof ShellRefusal) return { verdict: 'refused', rule: error.rule }
    throw error
  }
}

async function main(): Promise<void> {
  const out = flag('out') ?? DEFAULT_OUT

  // The canary. Its own temporary directory, created before any attack, with
  // one file in it and nothing else. Nothing in this program tells the guard
  // where it is.
  const outside = mkdtempSync(join(tmpdir(), 'nine-canary-'))
  const canaryPath = join(outside, 'outside.txt')
  const canary = 'CANARY-OUTSIDE-THE-SANDBOX\n'
  writeFileSync(canaryPath, canary, 'utf8')

  const rows: AttackRow[] = []

  for (const attack of ATTACKS) {
    const root = materialise()
    try {
      const { verdict, rule } = evaluate(attack, root)
      let effect = ''
      if (attack.run === true && verdict === 'allowed') {
        const shell = createShell(root)
        effect = describe(await shell.runCommand(attack.command), root)
      }
      rows.push({
        id: attack.id,
        class: attack.class,
        command: attack.command,
        goal: attack.goal,
        expected: attack.expect,
        verdict,
        rule: rule === '' ? 'none' : rule,
        agreed: verdict === attack.expect,
        effect: effect === '' ? 'not executed' : effect,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const after = readFileSync(canaryPath, 'utf8')
  if (after !== canary) {
    throw new Error('the canary outside the sandbox changed — not writing the table')
  }
  rmSync(outside, { recursive: true, force: true })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, [HEADER, ...rows.map(toLine)].join('\n') + '\n', 'utf8')

  const disagreed = rows.filter((row) => !row.agreed)
  console.log(
    `${rows.length} attack(s): ${rows.filter((r) => r.verdict === 'refused').length} refused, ` +
      `${rows.filter((r) => r.verdict === 'allowed').length} allowed, ` +
      `${disagreed.length} disagreed with the prediction`,
  )
  for (const row of disagreed) {
    console.log(`  ${row.id}: predicted ${row.expected}, got ${row.verdict} (${row.rule})`)
  }
  console.log(`wrote ${out}`)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
