import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * `run_command` with the guard deleted. Nine lines of it are the tool.
 *
 * Every rule in `agent/src/tools/shell.ts` — no shell, no metacharacters, a
 * binary allow-list, a flag allow-list per binary, every operand through post
 * 6's path guard, a built environment, a sandbox for a working directory — is
 * gone. What is left is what a shell tool is when nobody has done any of that,
 * and it is nine lines because that is genuinely all it takes. The reason this
 * file exists is that the post claims a shell is *everything you can do*, and
 * a claim like that has to be shown rather than asserted.
 *
 * **The only guard in this file is the one that stops it running anywhere but
 * inside a container.** That is not a safety feature of the tool; it is a
 * refusal to leave a loaded gun in a public repository. The check is
 * `/.dockerenv`, which every Docker container has and no host does, and it is
 * the first thing that happens.
 *
 * How it was run, exactly — no bind mount, no volume, no network:
 *
 *     docker run --rm -i --network none \
 *       -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
 *       node:22-alpine \
 *       sh -c 'cat > /work.mjs && node /work.mjs' \
 *       < tools/shell/unguarded.mjs
 *
 * `container.md` beside this file is the transcript that command produced, and
 * says how the isolation was verified before and after.
 */

/** The eight files post 6's agent works in, so the thing being destroyed is a project. */
const WORKSPACE = {
  'README.md': '# parcel-relay\n\nA small service.\n',
  'package.json': '{ "name": "parcel-relay", "version": "0.4.1" }\n',
  'config/settings.json': '{\n  "region": "eu-west-2",\n  "timeoutMs": 4500\n}\n',
  'src/server.ts': 'const PORT = 8137\n',
  'src/dispatch.ts': 'export function dispatch() {}\n',
  'src/queue.ts': 'export type Job = { kind: string }\n',
  'docs/CHANGELOG.md': '# Changelog\n\n## 0.4.1\n',
  'notes/todo.md': '# Todo\n\n- [ ] decide on a retry policy\n',
}

/** The tool. This is the whole of it. */
function runCommand(command) {
  try {
    return execSync(command, { cwd: '/work', encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    return `exit ${error.status ?? '?'}\n${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

function show(what, command) {
  console.log(`\n$ ${command}`)
  console.log(`# ${what}`)
  const out = runCommand(command).trimEnd()
  console.log(
    out
      .split('\n')
      .slice(0, 12)
      .map((line) => `  ${line}`)
      .join('\n'),
  )
}

function main() {
  if (!existsSync('/.dockerenv')) {
    console.error(
      'refusing to run: this file is an unguarded shell and it only runs inside a ' +
        'container. There is no /.dockerenv here.',
    )
    process.exit(1)
  }

  mkdirSync('/work', { recursive: true })
  for (const [path, content] of Object.entries(WORKSPACE)) {
    const full = `/work/${path}`
    mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }

  console.log('=== where this is running ===')
  show('the machine', 'uname -a')
  show('who the agent is', 'id')
  show('the project it was given', 'ls -la /work')

  console.log('\n=== things the guarded tool refuses ===')
  show('two commands in one string', 'ls /work; echo CHAINED')
  show('a pipe into a shell', 'echo "echo PIPED-INTO-A-SHELL" | sh')
  show('command substitution', 'echo "I am $(whoami) on $(hostname)"')
  show('redirection, which is how a read-only shell writes files', 'echo PLANTED > /work/planted.txt && cat /work/planted.txt')
  show('an interpreter', 'node -e "console.log(\'ARBITRARY CODE, exit code\', 0)"')
  show('the environment the process was started with', 'env | grep -i -E "key|token|secret"')
  show('a path outside the working directory', 'cat /etc/shadow')
  show('the whole filesystem, from one call', 'ls /')

  console.log('\n=== the part that is not a demonstration of a guard ===')
  show('delete the project', 'rm -rf /work')
  show('and it is gone', 'ls -la /work')
  show('delete the machine', 'rm -rf --no-preserve-root /')
  show('what is left', 'ls /')
  show('and the interpreter it was run with', 'node --version')

  console.log('\n=== the container is over ===')
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
