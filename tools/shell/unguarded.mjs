import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * `run_command` with the guard deleted. Seven lines of it are the tool.
 *
 * Every rule in `agent/src/tools/shell.ts` — no shell, no metacharacters, a
 * binary allow-list, a flag allow-list per binary, every operand through post
 * 6's path guard, a built environment, a sandbox for a working directory — is
 * gone. What is left is what a shell tool is when nobody has done any of that,
 * and it is seven lines because that is genuinely all it takes. The reason this
 * file exists is that the post claims a shell is *everything you can do*, and
 * a claim like that has to be shown rather than asserted.
 *
 * **Nothing in this file is a containment boundary.** It deletes the filesystem
 * it is run on, and the checks below are a speed bump in front of that, not a
 * guarantee about where "there" is. They are:
 *
 * 1. `--destroy-this-container` has to be on the command line. Without it the
 *    file is inert, which is the only property here that does not depend on
 *    guessing the environment.
 * 2. `/.dockerenv` has to exist. This is weak evidence of *Dockerness* and no
 *    evidence at all of *isolation*, which is the property that matters. It is
 *    present in a VS Code dev container and in a GitHub Actions `container:`
 *    job, both of which bind-mount a checkout of your work; it can be created
 *    by hand in WSL, where `/mnt/c` is your C: drive; and on Windows it
 *    resolves to `C:\.dockerenv`, an ordinary file any user can touch. It is
 *    also *absent* in Podman, containerd and LXC, so it is too permissive
 *    where it matters and too strict where it does not.
 * 3. None of `/workspaces`, `/__w`, `/host` or `/mnt` may hold anything. Those
 *    are where a dev container, a CI container, a `-v /:/host` and WSL put the
 *    host's files. `/mnt` exists and is empty in a stock `node:22-alpine`,
 *    which is why the test is *non-empty* rather than *exists*.
 *
 * Read together: check 1 is the guard, checks 2 and 3 are courtesy. If you are
 * inside something that mounts your machine, this file will still try.
 *
 * How it was run, exactly — no bind mount, no volume, no network:
 *
 *     docker run --rm -i --network none \
 *       -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
 *       node:22-alpine \
 *       sh -c 'cat > /work.mjs && node /work.mjs --destroy-this-container' \
 *       < tools/shell/unguarded.mjs
 *
 * `container.md` beside this file is the transcript that command produced, and
 * says how the isolation was verified before and after.
 */

/** Where a dev container, a CI container, a `-v /:/host` and WSL put host files. */
const HOST_DATA = ['/workspaces', '/__w', '/host', '/mnt']

/** True when `path` exists and is not an empty directory. */
function holdsSomething(path) {
  if (!existsSync(path)) return false
  try {
    return !statSync(path).isDirectory() || readdirSync(path).length > 0
  } catch {
    return true
  }
}

function refuse(reason) {
  console.error(`refusing to run: ${reason}`)
  process.exit(1)
}

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
  if (!process.argv.includes('--destroy-this-container')) {
    refuse(
      'this file is an unguarded shell that deletes the filesystem it runs on. ' +
        'It does nothing without --destroy-this-container on the command line.',
    )
  }

  if (!existsSync('/.dockerenv')) {
    refuse(
      'there is no /.dockerenv here, so this is probably not a Docker container. ' +
        'That check proves Dockerness and not isolation; see the comment above.',
    )
  }

  const mounted = HOST_DATA.filter(holdsSomething)
  if (mounted.length > 0) {
    refuse(
      `${mounted.join(', ')} holds files. That is where a dev container, a CI ` +
        'container and WSL put the host\'s data, and this file would destroy it.',
    )
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
  show('redirection, which is how a shell authors a file', 'echo PLANTED > /work/planted.txt && cat /work/planted.txt')
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
