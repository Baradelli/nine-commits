import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * The repository root, computed here rather than imported from `fs.ts` so the
 * dependency runs one way: the guard must not import the module it guards.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Raised when a path the model chose would land outside the root it is allowed
 * to touch.
 *
 * It is an exception and not a `{ ok: false }` result on purpose. A refusal is
 * a value, and a value can be ignored by the next line of code; commit 6 is the
 * first one in this series where ignoring it would modify a file. Every path
 * that reaches an `fs` call goes through `resolveInside`, and the only way out
 * of that function other than a path inside the root is a throw.
 *
 * The tool layer catches it, tells the model the call was refused, and counts
 * it. That conversion happens once, at the boundary, and it is deliberate:
 * a throw that escapes `execute` kills the run, and a killed run is a run
 * missing from the tally. A refusal the model can see is recorded; a crash is
 * an exclusion.
 */
export class SandboxEscape extends Error {
  override name = 'SandboxEscape'
  readonly attempted: string

  constructor(attempted: string, reason: string) {
    super(`refused "${attempted}": ${reason}`)
    this.attempted = attempted
  }
}

/** Raised when a root is not one this program is willing to write inside. */
export class UnsafeRoot extends Error {
  override name = 'UnsafeRoot'
}

/**
 * Is `child` inside `parent`, or `parent` itself?
 *
 * `relative()` is the check rather than a string prefix: `/a/bc` starts with
 * `/a/b` and is not inside it. The escape test is segment-aware for the same
 * reason — the old rule in `fs.ts` was `rel.startsWith('..')`, which also
 * rejects a legitimate file called `..gitkeep`. On Windows `path.win32.relative`
 * compares case-insensitively, which is what the filesystem does.
 */
export function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** The nearest ancestor of `path` that exists, so a new file can be checked before it is created. */
function deepestExisting(path: string): string {
  let current = path
  for (;;) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/**
 * The one function that turns a string the model wrote into a path this
 * program will open. Everything else in `fs.ts` goes through it.
 *
 * Three checks, because two of them are not enough:
 *
 * 1. `resolve` collapses `..`, so `a/../../etc` and `../..` and an absolute
 *    path all come out as somewhere definite, and `contains` decides whether
 *    that somewhere is inside the root. This catches the traversal that is
 *    written down.
 * 2. The same check is repeated against the **real** path of the deepest
 *    ancestor that exists. That is the traversal that is not written down: a
 *    symlink, junction or hardlinked directory inside the sandbox pointing
 *    anywhere else. Resolving the deepest existing ancestor rather than the
 *    target itself is what makes this work for a file that does not exist yet
 *    — `sandbox/link/new.txt` is refused before `new.txt` is created.
 * 3. A NUL byte is rejected outright; Node throws on it anyway, and a guard
 *    that lets its input reach an `fs` call to be validated is not a guard.
 */
export function resolveInside(root: string, candidate: unknown): string {
  if (typeof candidate !== 'string') {
    throw new SandboxEscape(String(candidate), 'not a path')
  }
  if (candidate.includes('\0')) {
    throw new SandboxEscape(candidate, 'contains a NUL byte')
  }
  // An empty string means "here". That is what `list_files` has meant since
  // v2, and it is what a model writes when it wants the whole project. The
  // first version of this guard refused it, and a pilot run showed the bill:
  // the agent spent calls re-asking for the root, and the four-tool condition
  // — which lists most — reached the step cap. A guard that refuses a
  // legitimate call is not being strict, it is joining the measurement.
  const path = candidate.trim() === '' ? '.' : candidate

  const target = resolve(root, path)
  if (!contains(root, target)) {
    throw new SandboxEscape(candidate, 'resolves outside the sandbox')
  }

  const real = realpathSync(deepestExisting(target))
  if (!contains(realpathSync(root), real)) {
    throw new SandboxEscape(candidate, 'follows a link out of the sandbox')
  }

  return target
}

/**
 * Whether a root may be written to, and it is not a matter of taste.
 *
 * Commits 1 to 5 gave the agent tools that could only read, so the worst a bad
 * run could do was produce a wrong answer. A write tool rooted at this
 * repository could overwrite a published post, and this repository is public.
 * So the rule is structural rather than procedural: the agent may write only
 * inside the operating system's temporary directory, and never inside its own
 * checkout. There is no environment variable that turns this off, because the
 * whole point is that a mistake in a prompt, a task file or a shell loop
 * cannot reach it.
 *
 * It is stricter than it needs to be on purpose. "Outside the repository"
 * would already protect the thing at risk, and it would also permit a typo
 * that pointed the agent at a home directory.
 */
export function assertWritableRoot(root: string): void {
  const real = realpathSync(root)
  if (!statSync(real).isDirectory()) {
    throw new UnsafeRoot(`writable root is not a directory`)
  }
  if (contains(realpathSync(REPO_ROOT), real)) {
    throw new UnsafeRoot(
      'refusing to write inside this repository — a write root must be a scratch directory',
    )
  }
  if (!contains(realpathSync(tmpdir()), real)) {
    throw new UnsafeRoot(
      'refusing to write outside the system temporary directory',
    )
  }
}
