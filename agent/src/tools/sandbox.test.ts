import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
