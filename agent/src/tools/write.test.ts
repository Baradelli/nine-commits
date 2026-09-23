import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFs, PROJECT_ROOT } from './fs.ts'
import { SandboxEscape, UnsafeRoot } from './sandbox.ts'

/*
 * The write tools, against a real directory. Nothing here is mocked: the point
 * of the guard is what it does to a filesystem, and a fake filesystem would
 * agree with whatever the guard believed about itself.
 */

let root: string
let outside: string
let escapes: SandboxEscape[]

function fs() {
  return createFs(root, { writable: true, onEscape: (e) => escapes.push(e) })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nine-write-'))
  outside = mkdtempSync(join(tmpdir(), 'nine-elsewhere-'))
  escapes = []
  writeFileSync(join(root, 'settings.json'), '{\n  "timeout": 4500\n}\n', 'utf8')
  writeFileSync(join(root, 'notes.md'), '# Notes\n\nfirst\n', 'utf8')
  writeFileSync(join(outside, 'precious.txt'), 'do not touch\n', 'utf8')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('the root itself', () => {
  it('will not build write tools for this repository', () => {
    expect(() => createFs(PROJECT_ROOT, { writable: true })).toThrow(UnsafeRoot)
    expect(() => createFs(join(PROJECT_ROOT, 'site'), { writable: true })).toThrow(
      UnsafeRoot,
    )
  })

  it('builds read-only tools for this repository, which is what commits 2 to 5 had', () => {
    const repo = createFs(PROJECT_ROOT)
    expect(repo.writable).toBe(false)
    expect(repo.listFiles('agent').ok).toBe(true)
  })

  it('refuses to run a write tool that was never built', () => {
    const repo = createFs(PROJECT_ROOT)
    expect(() => repo.writeFile('scratch.txt', 'x')).toThrow(/read-only/)
    expect(() => repo.editFile('a', 'b', 'c')).toThrow(/read-only/)
    expect(() => repo.appendFile('a', 'b')).toThrow(/read-only/)
  })
})

describe('read_file', () => {
  it('returns the bytes on disk, untrimmed, so an edit can be built from them', () => {
    const result = fs().readFile('settings.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content).toBe('{\n  "timeout": 4500\n}\n')
    expect(result.lines).toBe(4)
    expect(result.truncated).toBe(false)
  })

  it('explains a missing file instead of throwing', () => {
    const result = fs().readFile('nope.txt')
    expect(result).toEqual({ ok: false, error: 'could not read "nope.txt"' })
  })
})

describe('write_file', () => {
  it('creates a file, and says it created it', () => {
    expect(fs().writeFile('out/new.txt', 'hello\n')).toEqual({
      ok: true,
      file: 'out/new.txt',
      bytes: 6,
      created: true,
    })
    expect(readFileSync(join(root, 'out', 'new.txt'), 'utf8')).toBe('hello\n')
  })

  it('replaces an existing file entirely, and says it did not create it', () => {
    const result = fs().writeFile('notes.md', 'gone\n')
    expect(result.ok && result.created).toBe(false)
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('gone\n')
  })
})

describe('edit_file', () => {
  it('replaces exactly one span and leaves the rest of the file alone', () => {
    expect(fs().editFile('settings.json', '4500', '9000').ok).toBe(true)
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(
      '{\n  "timeout": 9000\n}\n',
    )
  })

  it('refuses text that is not there, rather than appending it', () => {
    const before = readFileSync(join(root, 'settings.json'), 'utf8')
    const result = fs().editFile('settings.json', '1234', '9000')
    expect(result.ok).toBe(false)
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(before)
  })

  it('refuses text that appears twice, rather than picking one', () => {
    writeFileSync(join(root, 'twice.txt'), 'a\na\n', 'utf8')
    const result = fs().editFile('twice.txt', 'a', 'b')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/more than once/)
    expect(readFileSync(join(root, 'twice.txt'), 'utf8')).toBe('a\na\n')
  })

  it('refuses an empty old_text, which would otherwise mean "insert at the top"', () => {
    expect(fs().editFile('notes.md', '', 'x').ok).toBe(false)
  })
})

describe('append_file', () => {
  it('adds to the end', () => {
    expect(fs().appendFile('notes.md', 'second\n').ok).toBe(true)
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe(
      '# Notes\n\nfirst\nsecond\n',
    )
  })

  it('inserts the newline the caller forgot', () => {
    writeFileSync(join(root, 'nonl.md'), 'last line', 'utf8')
    expect(fs().appendFile('nonl.md', 'next\n').ok).toBe(true)
    expect(readFileSync(join(root, 'nonl.md'), 'utf8')).toBe('last line\nnext\n')
  })

  it('creates the file when it is not there', () => {
    const result = fs().appendFile('brand/new.md', 'x\n')
    expect(result.ok && result.created).toBe(true)
  })
})

describe('a sandbox that disappears under the tools', () => {
  it('turns every tool into a refusal, and records each one', () => {
    const tools = fs()
    rmSync(root, { recursive: true, force: true })

    const calls: Array<[string, () => { ok: boolean }]> = [
      ['list_files', () => tools.listFiles('.') as { ok: boolean }],
      ['read_file', () => tools.readFile('settings.json') as { ok: boolean }],
      ['write_file', () => tools.writeFile('a.txt', 'x') as { ok: boolean }],
      ['edit_file', () => tools.editFile('a.txt', 'a', 'b') as { ok: boolean }],
      ['append_file', () => tools.appendFile('a.txt', 'x') as { ok: boolean }],
    ]

    for (const [name, call] of calls) {
      // Not a throw. A throw here leaves `execute`, kills the run, and takes a
      // row out of the tally, which is the one thing this design refuses.
      expect(call().ok, name).toBe(false)
    }
    expect(escapes).toHaveLength(calls.length)
  })
})

describe('what search_files is protected by, which is not the guard', () => {
  it('skips a link rather than resolving it, so it never reaches outside', () => {
    // `search_files` takes a pattern and no path, so it never calls
    // `resolveInside` at all. What keeps it inside is `walk`, which asks a
    // Dirent whether it is a directory or a file — both false for a link — so
    // a planted junction is skipped and its contents are never opened.
    writeFileSync(join(outside, 'needle.txt'), 'NEEDLE-9137-OUTSIDE\n', 'utf8')
    symlinkSync(outside, join(root, 'escape'), 'junction')

    const result = fs().searchFiles('NEEDLE-9137')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches).toEqual([])

    // And the same rule keeps it out of a listing.
    const listed = fs().listFiles('.')
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.files.some((file) => file.startsWith('escape/'))).toBe(false)

    rmSync(join(root, 'escape'), { recursive: true, force: true })
  })
})

describe('every write tool is behind the guard', () => {
  const escapeCases: Array<[string, (f: ReturnType<typeof fs>) => unknown]> = [
    ['parent traversal', (f) => f.writeFile('../escaped.txt', 'x')],
    ['normalises out of bounds', (f) => f.writeFile('a/b/../../../escaped.txt', 'x')],
    ['edit through a traversal', (f) => f.editFile('../precious.txt', 'do', 'DO')],
    ['append through a traversal', (f) => f.appendFile('../precious.txt', 'x')],
    ['read through a traversal', (f) => f.readFile('../precious.txt')],
    ['list through a traversal', (f) => f.listFiles('../..')],
  ]

  for (const [name, call] of escapeCases) {
    it(`refuses and records: ${name}`, () => {
      const result = call(fs()) as { ok: boolean }
      expect(result.ok).toBe(false)
      expect(escapes).toHaveLength(1)
      expect(escapes[0]).toBeInstanceOf(SandboxEscape)
    })
  }

  it('refuses an absolute path outside the sandbox and writes nothing there', () => {
    const target = join(outside, 'precious.txt')
    expect((fs().writeFile(target, 'clobbered') as { ok: boolean }).ok).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('do not touch\n')
    expect(escapes).toHaveLength(1)
  })

  it('refuses to write through a link that leaves the sandbox', () => {
    // `junction` so this runs on Windows without developer mode.
    symlinkSync(outside, join(root, 'out'), 'junction')

    expect((fs().writeFile('out/precious.txt', 'clobbered') as { ok: boolean }).ok).toBe(
      false,
    )
    expect((fs().appendFile('out/fresh.txt', 'x') as { ok: boolean }).ok).toBe(false)
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('do not touch\n')
    expect(escapes).toHaveLength(2)

    rmSync(join(root, 'out'), { recursive: true, force: true })
  })

  it('refuses to write through a link whose target does not exist yet', () => {
    // The dangling case. `existsSync` follows links, so the first version of
    // the guard walked straight past this one and approved the path.
    symlinkSync(join(outside, 'not-yet'), join(root, 'dangling'), 'junction')

    expect((fs().writeFile('dangling/escaped.txt', 'x') as { ok: boolean }).ok).toBe(false)
    expect((fs().appendFile('dangling/escaped.txt', 'x') as { ok: boolean }).ok).toBe(false)
    expect(existsSync(join(outside, 'not-yet'))).toBe(false)
    expect(escapes).toHaveLength(2)

    rmSync(join(root, 'dangling'), { recursive: true, force: true })
  })

  it('still writes inside a directory whose name merely starts with the sandbox name', () => {
    // The string-prefix bug, from the other side: this is a legitimate write.
    mkdirSync(join(root, 'nested'), { recursive: true })
    expect((fs().writeFile('nested/ok.txt', 'fine\n') as { ok: boolean }).ok).toBe(true)
    expect(escapes).toHaveLength(0)
  })
})
