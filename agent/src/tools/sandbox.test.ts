import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SandboxEscape,
  UnsafeRoot,
  assertWritableRoot,
  contains,
  resolveInside,
} from './sandbox.ts'
import { PROJECT_ROOT } from './fs.ts'

/*
 * The write tools are the first thing in this series that can change a file,
 * and this repository is public with five published posts in it. So the guard
 * gets the harshest test file in the project: every shape of escape that came
 * to mind, asserted to raise rather than to return a polite refusal.
 */

let root: string
let outside: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nine-sandbox-'))
  outside = mkdtempSync(join(tmpdir(), 'nine-outside-'))
  mkdirSync(join(root, 'nested'), { recursive: true })
  writeFileSync(join(root, 'inside.txt'), 'inside\n', 'utf8')
  writeFileSync(join(outside, 'secret.txt'), 'secret\n', 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('contains', () => {
  it('is not a string prefix test', () => {
    // The bug this exists to prevent: "/a/bc" starts with "/a/b".
    expect(contains(join(root, 'nested'), join(root, 'nested-other'))).toBe(false)
    expect(contains(root, root)).toBe(true)
    expect(contains(root, join(root, 'a', 'b', 'c.txt'))).toBe(true)
  })
})

describe('resolveInside', () => {
  it('accepts a path inside the sandbox and returns it absolute', () => {
    expect(resolveInside(root, 'inside.txt')).toBe(join(root, 'inside.txt'))
    expect(resolveInside(root, 'nested/new.txt')).toBe(join(root, 'nested', 'new.txt'))
    expect(resolveInside(root, './a/../b.txt')).toBe(join(root, 'b.txt'))
  })

  it('throws on a parent-directory escape', () => {
    expect(() => resolveInside(root, '..')).toThrow(SandboxEscape)
    expect(() => resolveInside(root, '../secret.txt')).toThrow(SandboxEscape)
    expect(() => resolveInside(root, '../../../../etc/passwd')).toThrow(SandboxEscape)
  })

  it('throws on a path that normalises out of bounds', () => {
    // Every segment of this one is inside the sandbox until the last two.
    expect(() => resolveInside(root, 'nested/deeper/../../../escaped.txt')).toThrow(
      SandboxEscape,
    )
    expect(() => resolveInside(root, 'a/b/c/../../../../x')).toThrow(SandboxEscape)
  })

  it('throws on an absolute path, including one that names the sandbox and then leaves it', () => {
    expect(() => resolveInside(root, join(outside, 'secret.txt'))).toThrow(SandboxEscape)
    expect(() => resolveInside(root, homedir())).toThrow(SandboxEscape)
    expect(() => resolveInside(root, resolve(root, '..'))).toThrow(SandboxEscape)
  })

  it('throws on a link that leaves the sandbox, for a file that does not exist yet', () => {
    // `junction` so this runs on Windows without developer mode; on POSIX it
    // is a plain directory symlink.
    const link = join(root, 'out')
    symlinkSync(outside, link, 'junction')

    // Lexically this path is inside the sandbox, so the first check passes it.
    // Only resolving the link catches it, which is what makes this a link test.
    expect(contains(root, join(root, 'out', 'secret.txt'))).toBe(true)
    expect(() => resolveInside(root, 'out/secret.txt')).toThrow(SandboxEscape)
    // The file does not exist, which is the case a naive realpath() misses:
    // the check has to run against the deepest ancestor that does.
    expect(() => resolveInside(root, 'out/brand-new.txt')).toThrow(SandboxEscape)

    rmSync(link, { recursive: true, force: true })
  })

  it('throws on a link whose target does not exist, which is the hole it shipped with', () => {
    // The first version walked up with `existsSync`, which FOLLOWS links. A
    // link with no target reports false, so the walk climbed past it to the
    // sandbox root, realpath(root) was trivially inside, and the link was
    // never inspected at all. Measured before the fix: `resolveInside`
    // returned an approved path straight through it.
    const link = join(root, 'dangling')
    symlinkSync(join(outside, 'no-such-directory'), link, 'junction')

    expect(existsSync(link)).toBe(false)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(() => resolveInside(root, 'dangling')).toThrow(SandboxEscape)
    expect(() => resolveInside(root, 'dangling/escaped.txt')).toThrow(SandboxEscape)

    rmSync(link, { recursive: true, force: true })
  })

  it('throws on a link that points back inside the sandbox too', () => {
    // A link that goes nowhere dangerous is still refused. Nothing in this
    // program has a legitimate reason to reach through one, and "refuse every
    // link" is one rule with no dangling-target case to get wrong.
    const link = join(root, 'inward')
    symlinkSync(join(root, 'nested'), link, 'junction')

    expect(() => resolveInside(root, 'inward/file.txt')).toThrow(SandboxEscape)

    rmSync(link, { recursive: true, force: true })
  })

  it('throws on a NUL byte and on anything that is not a string', () => {
    expect(() => resolveInside(root, 'a\0b')).toThrow(SandboxEscape)
    expect(() => resolveInside(root, 42)).toThrow(SandboxEscape)
    expect(() => resolveInside(root, undefined)).toThrow(SandboxEscape)
  })

  it('reads an empty path as the root, which is what list_files has always meant', () => {
    // Refusing it was this guard's first defect, and a pilot run paid for it.
    expect(resolveInside(root, '')).toBe(resolveInside(root, '.'))
    expect(resolveInside(root, '   ')).toBe(resolveInside(root, '.'))
  })

  it('names what was attempted without pasting an absolute path into the message', () => {
    try {
      resolveInside(root, '../secret.txt')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxEscape)
      expect((error as SandboxEscape).attempted).toBe('../secret.txt')
      expect((error as SandboxEscape).message).not.toContain(root)
    }
  })
})

describe('assertWritableRoot', () => {
  it('accepts a scratch directory under the system temporary directory', () => {
    expect(() => assertWritableRoot(root)).not.toThrow()
  })

  it('refuses this repository, which is the whole reason it exists', () => {
    expect(() => assertWritableRoot(PROJECT_ROOT)).toThrow(UnsafeRoot)
    expect(() => assertWritableRoot(join(PROJECT_ROOT, 'agent'))).toThrow(UnsafeRoot)
  })

  it('refuses anywhere else that is not scratch space', () => {
    expect(() => assertWritableRoot(homedir())).toThrow(UnsafeRoot)
  })
})

describe.runIf(process.platform === 'win32')('the path forms only Windows has', () => {
  it('refuses a UNC path and an extended-length path', () => {
    expect(() => resolveInside(root, '\\\\server\\share\\x')).toThrow(SandboxEscape)
    expect(() => resolveInside(root, '\\\\?\\C:\\Windows\\win.ini')).toThrow(
      SandboxEscape,
    )
    // And the drive-root form, which is what a single leading backslash means.
    expect(() => resolveInside(root, '\\Windows\\win.ini')).toThrow(SandboxEscape)
  })

  it('keeps a drive-relative path inside the sandbox', () => {
    // "C:foo.txt" means "foo.txt on drive C:, relative to where I am on C:".
    // It is the one form that looks absolute and is not, and the answer has to
    // be a path in the sandbox or a refusal — never a path on C: root.
    const resolved = resolveInside(root, 'C:foo.txt')
    expect(contains(root, resolved)).toBe(true)
  })
})

describe('what assertWritableRoot does and does not promise', () => {
  it('protects this repository even when scratch space IS this repository', async () => {
    // REPO_ROOT comes from import.meta.url — this file's own place on disk —
    // so no environment variable can move it. The hostile case is TMP pointed
    // at the checkout, which makes rule 2 agree with everything and leaves
    // rule 1 holding the line on its own.
    //
    // The module is re-imported with a cache-busting query so SCRATCH_ROOT is
    // recomputed under the hostile environment. A child process would do the
    // same job and would also scatter node and tsx cache directories into this
    // repository, which is a strange thing for this commit's test file to do.
    const saved = { ...process.env }
    process.env.TMP = PROJECT_ROOT
    process.env.TEMP = PROJECT_ROOT
    process.env.TMPDIR = PROJECT_ROOT
    try {
      vi.resetModules()
      const hostile = await import('./sandbox.ts')
      expect(() => hostile.assertWritableRoot(PROJECT_ROOT)).toThrow(/inside this repository/)
      expect(() => hostile.assertWritableRoot(join(PROJECT_ROOT, 'site'))).toThrow(
        /inside this repository/,
      )
      // And the scratch rule really has moved, which is what makes the above
      // a test of rule 1 rather than of rule 2 catching it anyway.
      // Matched on the message, not the class: a re-imported module has its
      // own UnsafeRoot and `instanceof` against the first one is always false.
      expect(() => hostile.assertWritableRoot(root)).toThrow(
        /outside the system temporary directory/,
      )
    } finally {
      for (const name of ['TMP', 'TEMP', 'TMPDIR'] as const) {
        const value = saved[name]
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      vi.resetModules()
    }
  })

  it('does not promise that scratch space is unsettable, and the comment says so', () => {
    // os.tmpdir() reads TMP/TEMP/TMPDIR. Snapshotting at module load removes
    // the mid-run variant — a root that was scratch space when it was checked
    // and somewhere else when it was written to — and nothing more. A process
    // STARTED with TMP at a home directory has a writable root there, which is
    // a real limit and is written down rather than claimed away.
    const source = readFileSync(
      join(PROJECT_ROOT, 'agent', 'src', 'tools', 'sandbox.ts'),
      'utf8',
    )
    expect(source).not.toContain('There is no environment variable that turns this off')
    expect(source).toContain('TMP')
    expect(source).toContain('TMPDIR')

    // The mid-run variant is what the snapshot actually buys, and it holds.
    const before = tmpdir()
    process.env.TMP = homedir()
    process.env.TEMP = homedir()
    process.env.TMPDIR = homedir()
    try {
      expect(tmpdir()).not.toBe(before)
      expect(() => assertWritableRoot(homedir())).toThrow(UnsafeRoot)
    } finally {
      delete process.env.TMP
      delete process.env.TEMP
      delete process.env.TMPDIR
    }
  })
})
