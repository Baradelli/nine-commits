import { describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import {
  ALLOWED,
  ALLOWED_NAMES,
  createShell,
  planCommand,
  ShellRefusal,
} from '../../agent/src/tools/shell.ts'
import { DESCRIPTIONS } from '../../agent/src/tools/descriptions.ts'

/*
 * Which of the fifteen binaries can write, measured — and every shipped
 * sentence that says so, checked against the measurement.
 *
 * This series has now published the same defect four times, and the last two
 * were both inside a fix. The thesis said "read-only", which `cp` falsifies in
 * two tokens. The fix said the tool "can read, copy, rename and make empty
 * things, and nothing else", which `uniq` falsifies in three — `uniq
 * [OPTION]... [INPUT [OUTPUT]]` takes an output operand, and `checkOperand` has
 * no notion of read against write, so `uniq -c in.txt out.txt` replaces
 * `out.txt` with a count column that was on no disk anywhere. Each correction
 * replaced a false claim with a narrower false claim, because an enumeration is
 * a claim about everything it leaves out.
 *
 * `shell.test.ts` could not catch either one: it asserts that four named
 * binaries are present and that a list of named writers is absent, and neither
 * assertion moves if `uniq` is the only writer left. Nothing in a hundred and
 * forty runs caught it either — `uniq` was never called once, which is the same
 * shape as post 6's `escapes recorded: 0`.
 *
 * So the set is derived here by running every binary in `ALLOWED`, with every
 * flag `ALLOWED` gives it, against a scratch directory and watching what moves.
 * Nothing in this file is written from memory, and the prose is held to what
 * the measurement says rather than the other way round.
 */

/** A file tree, as relative path to contents. Directories carry a marker. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const key = relative(root, full).split(sep).join('/')
      if (entry.isDirectory()) {
        out.set(key, '<dir>')
        walk(full)
      } else {
        out.set(key, readFileSync(full, 'utf8'))
      }
    }
  }
  walk(root)
  return out
}

function differs(before: Map<string, string>, after: Map<string, string>): boolean {
  if (before.size !== after.size) return true
  for (const [key, value] of before) if (after.get(key) !== value) return true
  return false
}

/**
 * One binary's best chance of changing the filesystem.
 *
 * Every flag and value flag the allow-list grants appears in at least one probe
 * — asserted below, so adding a flag without a probe for it turns this red —
 * and every probe ends with a path the binary would write to if it could.
 */
const PROBES: Record<string, string[]> = {
  ls: ['ls -l -a -A -1 -R -h -r -t -S -d -F in.txt probe-ls.txt'],
  cat: ['cat -n -b -s -E in.txt probe-cat.txt'],
  head: ['head -q -v in.txt probe-head.txt', 'head -n 1 -c 1 in.txt probe-head.txt'],
  tail: ['tail -q -v in.txt probe-tail.txt', 'tail -n 1 -c 1 in.txt probe-tail.txt'],
  wc: ['wc -l -w -c -m -L in.txt probe-wc.txt'],
  grep: [
    'grep -n -i -c -l -L -v -w -x -E -F -o -h -s a in.txt probe-grep.txt',
    'grep -r -A 1 -B 1 -C 1 -m 1 a . probe-grep.txt',
  ],
  find: [
    'find . -maxdepth 1 -mindepth 0 -type f -name in.txt -size +0 -print',
    'find . -empty -print probe-find.txt',
  ],
  sort: ['sort -n -r -u -f -b -h -k 1 -t , in.txt probe-sort.txt'],
  uniq: ['uniq -c in.txt probe-uniq.txt', 'uniq -d -u -i in.txt probe-uniq-two.txt'],
  diff: ['diff -u -q -r -w -b -i in.txt probe-diff.txt'],
  echo: ['echo -n probe-echo.txt'],
  mkdir: ['mkdir -p -v probe-mkdir'],
  touch: ['touch probe-touch.txt'],
  cp: ['cp -r -R -p -v -n in.txt probe-cp.txt'],
  mv: ['mv -v -n movable.txt probe-mv.txt'],
}

/** A sandbox with something to read, something to move and somewhere to walk. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'nine-writers-'))
  writeFileSync(join(root, 'in.txt'), 'a\na\nb\n', 'utf8')
  writeFileSync(join(root, 'movable.txt'), 'MOVE\n', 'utf8')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'nested.txt'), 'nested\n', 'utf8')
  return root
}

/** The binaries whose probes changed the sandbox, measured once and reused. */
async function measureWriters(): Promise<string[]> {
  const writers: string[] = []
  for (const name of ALLOWED_NAMES) {
    const root = sandbox()
    try {
      const shell = createShell(root)
      const before = snapshot(root)
      for (const command of PROBES[name] ?? []) await shell.runCommand(command)
      if (differs(before, snapshot(root))) writers.push(name)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  return writers
}

const WRITERS = await measureWriters()

describe('the binaries that write, measured rather than listed', () => {
  it('probes every allowed binary with every flag the allow-list gives it', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...ALLOWED_NAMES].sort())
    for (const name of ALLOWED_NAMES) {
      const binary = ALLOWED[name]
      if (binary === undefined) throw new Error(`no binary named ${name}`)
      const used = new Set(
        (PROBES[name] ?? []).flatMap((command) => command.split(' ').filter((t) => t.startsWith('-'))),
      )
      for (const flag of [...binary.flags, ...(binary.valueFlags ?? [])]) {
        expect({ binary: name, flag, probed: used.has(flag) }).toEqual({
          binary: name,
          flag,
          probed: true,
        })
      }
    }
  })

  it('is five of the fifteen, and uniq is one of them', () => {
    expect(WRITERS).toEqual(['cp', 'mkdir', 'mv', 'touch', 'uniq'])
  })

  it('writes through uniq bytes that were on no disk, which cp and mv cannot', async () => {
    const root = sandbox()
    try {
      writeFileSync(join(root, 'target.txt'), 'ORIGINAL-CONTENT\n', 'utf8')
      const shell = createShell(root)
      const result = await shell.runCommand('uniq -c in.txt target.txt')
      expect(result.ok).toBe(true)
      const written = readFileSync(join(root, 'target.txt'), 'utf8')

      // The destination is gone, exactly as `cp` would leave it.
      expect(written).not.toContain('ORIGINAL-CONTENT')
      // And the count column is not a substring of anything that was on disk:
      // `uniq -c` composed it. This is the sentence in the post that says the
      // narrow claim is about *authoring* and not about writing.
      expect(written).toBe('      2 a\n      1 b\n')
      expect(readFileSync(join(root, 'in.txt'), 'utf8')).not.toContain('      2 a')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('refuses every option that would make a sixth binary write', async () => {
    // The sweep behind the five: the write-capable options the fifteen binaries
    // actually have — read out of each binary's own `--help` rather than out of
    // memory — each one absent from its allow-list and therefore refused on the
    // flag, before any operand is looked at.
    const root = sandbox()
    try {
      const shell = createShell(root)
      for (const command of [
        'sort -o probe.txt in.txt',
        'sort --output=probe.txt in.txt',
        'find . -delete',
        'find . -fprintf probe.txt x',
        'find . -fls probe.txt',
        'find . -fprint probe.txt',
        'find . -exec touch probe.txt +',
        'grep -f in.txt a .',
        'touch -r in.txt probe.txt',
        'cp -t sub in.txt',
        'mv -t sub movable.txt',
        'mkdir -m 777 probe-dir',
      ]) {
        let rule: string | undefined
        try {
          planCommand(root, command)
        } catch (error: unknown) {
          if (error instanceof ShellRefusal) rule = error.rule
        }
        expect(`${command} -> ${rule}`).toBe(`${command} -> flag`)
        expect((await shell.runCommand(command)).ok).toBe(false)
      }
      expect(readdirSync(root).sort()).toEqual(['in.txt', 'movable.txt', 'sub'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

/*
 * The prose half.
 *
 * Every file below describes what the tool can write, and one of them —
 * `descriptions.ts` — describes it to the model. The rule is the one the second
 * fix round cost: a passage that names some of the writers is an enumeration,
 * and an enumeration that is short is a false claim about the ones it left out.
 */

const SHIPPED = [
  join('agent', 'src', 'tools', 'shell.ts'),
  join('agent', 'src', 'tools', 'descriptions.ts'),
  join('agent', 'src', 'tools', 'index.ts'),
  join('site', 'src', 'lib', 'series.ts'),
  join(POSTS_DIR, '08-shell', 'index.mdx'),
  join('tools', 'shell', 'container.md'),
  join('tools', 'shell', 'tasks.ts'),
  join('tools', 'shell', 'tally.ts'),
]

/** A whole word, so `mvn` and `copy` are not `mv` and `cp`. */
function names(text: string, word: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_-])${word}([^A-Za-z0-9_-]|$)`).test(text)
}

/**
 * Only what a passage says in code spans.
 *
 * Every one of these files names a binary in backticks, and the alternative —
 * matching bare words — reads "tools that touch something outside the machine"
 * as an enumeration containing `touch`. The model-facing string has no
 * backticks and gets its own assertion below.
 */
function codeOf(passage: string): string {
  return [...passage.matchAll(/`([^`]*)`/g)].map((match) => match[1]).join(' ')
}

describe('every shipped sentence that enumerates them', () => {
  it('names all five wherever it names three', () => {
    const short: string[] = []
    for (const file of SHIPPED) {
      const text = readFileSync(file, 'utf8')
      const passages = text.split(/\r?\n\s*\r?\n/)
      for (const passage of passages) {
        const code = codeOf(passage)
        const named = WRITERS.filter((writer) => names(code, writer))
        if (named.length < 3 || named.length === WRITERS.length) continue
        const missing = WRITERS.filter((writer) => !named.includes(writer))
        short.push(`${file}: names ${named.join(', ')} and not ${missing.join(', ')}`)
      }
    }
    expect(short).toEqual([])
  })

  it('never hands the model a sentence saying it cannot write', () => {
    // The two that shipped, literally. The first rode in all 140 runs; the
    // second replaced it and was false about `uniq`.
    const description = DESCRIPTIONS.precise.run_command
    expect(description).not.toContain('cannot change what is inside a file')
    expect(description).not.toContain('cannot write new content into one')
    expect(description).not.toMatch(/read-only/i)
    // And it must not describe the writing set more narrowly than it is.
    for (const writer of WRITERS) expect(names(description, writer)).toBe(true)
  })
})
