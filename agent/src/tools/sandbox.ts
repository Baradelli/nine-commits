import { lstatSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * The repository root, computed here rather than imported from `fs.ts` so the
 * dependency runs one way: the guard must not import the module it guards.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Scratch space, captured once when this module loads.
 *
 * `os.tmpdir()` reads `TMP`, `TEMP` and `TMPDIR` on every call, so it is not a
 * constant and it is not a property of the machine — it is whatever the
 * environment says. Snapshotting it removes the one variant of that which is
 * this module's fault: a root that was scratch space when it was checked and
 * somewhere else by the time it was written to. It does not make the rule
 * unsettable. A process started with `TMP` pointing at a home directory has a
 * writable root in the home directory, and `assertWritableRoot` says so in its
 * own comment rather than claiming otherwise.
 */
const SCRATCH_ROOT = realpathSync(tmpdir())

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

/**
 * The nearest ancestor of `path` that is really there, so a file that does not
 * exist yet can be checked before it is created.
 *
 * `lstatSync`, not `existsSync`, and the difference is a hole this guard
 * shipped with. `existsSync` **follows** links, so a link whose target does not
 * exist reports `false` — and the walk then climbs straight past the link to
 * an ancestor that is inside the root, `realpath` of which is trivially inside
 * the root, and the link is never inspected at all. A dangling link was a hole
 * in exactly the case this function exists for.
 *
 * `lstatSync` does not follow, so a dangling link counts as present and the
 * walk stops on it. What to do about it is `resolveInside`'s business.
 */
function deepestPresent(path: string): string {
  let current = path
  for (;;) {
    try {
      lstatSync(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return current
      current = parent
    }
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
 * 2. The deepest ancestor that is really there is found with `lstat`, and if
 *    that entry is itself a link — symlink, junction, any reparse point — the
 *    path is refused outright, without asking where the link goes. A link
 *    whose target does not exist cannot be resolved to ask, and this guard
 *    shipped a hole for exactly that case; refusing every link is one rule
 *    instead of two, and no legitimate call in this program goes through one.
 * 3. The same containment check is then repeated against the **real** path of
 *    that ancestor, which catches a link further up: `sandbox/link/sub/new.txt`
 *    where `sub` is an ordinary directory reached through a link. Resolving an
 *    ancestor rather than the target is what makes any of this work for a file
 *    that does not exist yet.
 * 4. A NUL byte is rejected outright; Node throws on it anyway, and a guard
 *    that lets its input reach an `fs` call to be validated is not a guard.
 *
 * It fails closed. Anything `lstat` or `realpath` raises on becomes a refusal,
 * not an exception escaping the guard into the caller's error handling.
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

  const anchor = deepestPresent(target)

  let real: string
  let realRoot: string
  try {
    if (lstatSync(anchor).isSymbolicLink()) {
      throw new SandboxEscape(candidate, 'passes through a link')
    }
    real = realpathSync(anchor)
    // Inside the try, and it was outside it once. A sandbox that has been
    // deleted makes this raise `ENOENT`, and an `ENOENT` leaving this function
    // is two failures at once: the caller gets an exception the design
    // promises it will never get, and the message carries the absolute path
    // that every other error string in this module is written to avoid.
    realRoot = realpathSync(root)
  } catch (error: unknown) {
    // Fail closed. A link this process cannot resolve, a path it cannot stat,
    // a permission error, a root that is no longer there — none of them are
    // evidence that the path is inside the sandbox, and treating "could not
    // check" as "checked" is how a guard becomes decoration.
    if (error instanceof SandboxEscape) throw error
    throw new SandboxEscape(candidate, 'could not be checked')
  }

  if (!contains(realRoot, real)) {
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
 * So there are two rules, and they are worth exactly as much as their weakest
 * input:
 *
 * 1. **Never inside this checkout.** `REPO_ROOT` comes from `import.meta.url`
 *    — this file's own location on disk — so no environment variable, prompt,
 *    task file or shell loop can move it. This is the rule that protects the
 *    thing actually at risk, and it has no switch.
 * 2. **Only inside scratch space**, which is stricter but *not* unsettable.
 *    `SCRATCH_ROOT` is `os.tmpdir()`, and `os.tmpdir()` is whatever `TMP`,
 *    `TEMP` or `TMPDIR` said when this module loaded. A process started with
 *    `TMP` pointing at a home directory has a writable root in the home
 *    directory. Snapshotting removes the mid-run variant — a root that was
 *    scratch space when it was checked and somewhere else when it was written
 *    to — and nothing more.
 *
 * Rule 2 exists because "outside the repository" would permit a typo pointing
 * at a home directory. An environment already pointing `TMP` at a home
 * directory defeats it, which is a real limit and is the reason rule 1 is not
 * expressed in terms of it.
 */
export function assertWritableRoot(root: string): void {
  // The likeliest way to get this wrong is not a malicious root, it is a typo
  // in `AGENT_ROOT`. Unwrapped, `realpathSync` answered that with a raw
  // `ENOENT` carrying the absolute path — a stack trace out of `buildTools`,
  // from the one function whose whole job is to give clear answers about
  // roots. A root that cannot be resolved is not a safe root, so it is refused
  // like any other, in this function's own vocabulary and without echoing the
  // path back.
  let real: string
  try {
    real = realpathSync(root)
  } catch {
    throw new UnsafeRoot(
      'the write root does not exist, or cannot be resolved — it must be an ' +
        'existing directory under the system temporary directory',
    )
  }

  if (!statSync(real).isDirectory()) {
    throw new UnsafeRoot(`writable root is not a directory`)
  }
  if (contains(realpathSync(REPO_ROOT), real)) {
    throw new UnsafeRoot(
      'refusing to write inside this repository — a write root must be a scratch directory',
    )
  }
  if (!contains(SCRATCH_ROOT, real)) {
    throw new UnsafeRoot(
      'refusing to write outside the system temporary directory',
    )
  }
}
