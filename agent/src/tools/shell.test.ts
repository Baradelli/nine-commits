import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ALLOWED,
  ALLOWED_NAMES,
  childEnvironment,
  createShell,
  defuseOutputFence,
  driveQualified,
  METACHARACTERS,
  OUTPUT_CHAR_LIMIT,
  OUTPUT_CLOSE,
  OUTPUT_OPEN,
  planCommand,
  resolveBinary,
  ShellRefusal,
  tokenize,
} from './shell.ts'
import { PROJECT_ROOT } from './fs.ts'
import { UnsafeRoot } from './sandbox.ts'

/*
 * The guard, attacked.
 *
 * `tools/shell/attacks.ts` is the wide sweep — ninety-odd hostile command
 * lines, each with a prediction written before it was run, recomputed into a
 * committed table. This file is the narrow one: the properties that have to
 * hold for that table to mean anything, and the three holes the sweep found by
 * measurement rather than by assertion.
 */

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nine-shell-test-'))
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(join(root, 'README.md'), 'INSIDE-THE-SANDBOX\n', 'utf8')
  writeFileSync(join(root, '.env'), 'AGENT_TOKEN=DECOY\n', 'utf8')
  writeFileSync(join(root, 'config', 'settings.json'), '{"timeoutMs": 4500}\n', 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function refusal(command: string): ShellRefusal {
  try {
    planCommand(root, command)
  } catch (error: unknown) {
    if (error instanceof ShellRefusal) return error
    throw error
  }
  throw new Error(`expected "${command}" to be refused, and it was not`)
}

describe('tokenize', () => {
  it('splits on runs of spaces and keeps quoted spans whole', () => {
    expect(tokenize('ls   -la  README.md')).toEqual(['ls', '-la', 'README.md'])
    expect(tokenize("grep 'two words' README.md")).toEqual([
      'grep',
      'two words',
      'README.md',
    ])
    expect(tokenize('echo "a b" c')).toEqual(['echo', 'a b', 'c'])
  })

  it('keeps an empty quoted argument, which is not the same as no argument', () => {
    expect(tokenize("echo ''")).toEqual(['echo', ''])
    expect(tokenize('echo')).toEqual(['echo'])
  })

  it('refuses rather than guesses where an unterminated string ended', () => {
    // A tokenizer that closes the quote for you is a tokenizer that can be
    // made to close it in the wrong place, and every token after that point is
    // one the guard read differently from the program that will run it.
    expect(() => tokenize("ls 'README.md")).toThrow(ShellRefusal)
  })
})

describe('the metacharacter rule', () => {
  it('names every character a shell reads as punctuation', () => {
    for (const character of ';&|<>`$(){}[]*?!#~\\') {
      expect(METACHARACTERS.test(character), character).toBe(true)
    }
    for (const character of '\n\r\t\u0000\u001b\u007f') {
      expect(METACHARACTERS.test(character), JSON.stringify(character)).toBe(true)
    }
  })

  it('leaves quoting, spaces and ordinary path characters alone', () => {
    for (const character of `'" ./-_=+,:%@abcABC019`) {
      expect(METACHARACTERS.test(character), character).toBe(false)
    }
  })

  it('refuses a second command however it is spelled', () => {
    for (const command of [
      'ls; rm -rf .',
      'ls && rm -rf .',
      'ls || rm -rf .',
      'ls | sh',
      'ls & rm -rf .',
      'ls\nrm -rf .',
      'ls\rrm -rf .',
      'ls # and the rest',
    ]) {
      expect(refusal(command).rule).toBe('metacharacter')
    }
  })

  it('refuses substitution, redirection and globbing', () => {
    for (const command of [
      'echo $(ls)',
      'echo `ls`',
      'echo $OPENAI_API_KEY',
      'echo ${PATH}',
      'cat README.md > stolen.txt',
      'cat < /etc/passwd',
      'cat src/*.ts',
      'ls ?.md',
      'ls ~',
    ]) {
      expect(refusal(command).rule).toBe('metacharacter')
    }
  })
})

describe('the binary allow-list', () => {
  it('refuses every interpreter, by whatever name', () => {
    for (const command of [
      'sh -c ls',
      'bash -c ls',
      'node -e 1',
      'python -c 1',
      'perl -e 1',
      'awk 1 README.md',
      'sed -i s/a/b/ README.md',
      'git status',
      'xargs ls',
      'env',
      'rm -rf .',
      'tee out.txt',
      'ln -s / escape',
      'curl http://example.com',
      'chmod 777 .',
      'tar -xf x.tar',
    ]) {
      expect(refusal(command).rule).toBe('binary')
    }
  })

  it('refuses a binary named by path, so PATH is the only way in', () => {
    expect(refusal('/bin/sh -c ls').rule).toBe('binary')
    expect(refusal('./ls').rule).toBe('binary')
    expect(refusal('ls.exe').rule).toBe('binary')
  })

  it('does not answer to what every JavaScript object answers to', () => {
    // `ALLOWED[name] !== undefined` would find `constructor` on the prototype
    // and hand the guard a "binary" with no `flags`, which crashes it from the
    // inside. `Object.hasOwn` is the whole fix and it is one call.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(refusal(name).rule).toBe('binary')
    }
  })

  it('every allowed name is a bare name with no separator in it', () => {
    for (const name of ALLOWED_NAMES) {
      expect(name).toMatch(/^[a-z]+$/)
    }
  })

  it('cannot author a byte of its own, which is the result rather than an omission', () => {
    // If this ever stops being true, the sentence in `descriptions.ts` that
    // tells the model so becomes false, and the post's argument for why a
    // defensible shell cannot compose content goes with it.
    for (const writer of ['sed', 'tee', 'awk', 'perl', 'python', 'sh', 'bash', 'ed', 'patch', 'dd', 'truncate']) {
      expect(ALLOWED_NAMES).not.toContain(writer)
    }
  })

  it('does hold four binaries that mutate the filesystem, which is why the claim is the narrow one', () => {
    // The thesis says "cannot author a byte of its own" and deliberately not
    // "read-only". This is the difference, and it is not hypothetical: `cp`
    // replaces a destination file's contents outright, with no flag, from the
    // allow-list. If someone widens the published claim back to read-only,
    // this test is the sentence that contradicts it.
    for (const mutator of ['cp', 'mv', 'touch', 'mkdir']) {
      expect(ALLOWED_NAMES).toContain(mutator)
    }
  })
})

describe('the flag allow-lists', () => {
  it('refuses the flags that run a command or write a file', () => {
    for (const command of [
      'find . -exec ls +',
      'find . -execdir ls +',
      'find . -delete',
      'find . -fprintf out.txt x',
      'find . -fls out.txt',
      'grep -f patterns.txt README.md',
      'sort -o out.txt README.md',
      'head --bytes=10 README.md',
    ]) {
      expect(refusal(command).rule).toBe('flag')
    }
  })

  it('refuses the flags that follow a link the path guard just refused to follow', () => {
    expect(refusal('ls -L escape').rule).toBe('flag')
    expect(refusal('grep -R needle .').rule).toBe('flag')
    expect(refusal('cp -L escape copy.txt').rule).toBe('flag')
  })

  it('undoes bundling before it checks, so a bad letter cannot hide in a good bundle', () => {
    expect(refusal('ls -lZ').rule).toBe('flag')
    expect(planCommand(root, 'ls -la').args).toEqual(['-la'])
    expect(planCommand(root, 'wc -lc README.md').args).toEqual(['-lc', 'README.md'])
  })

  it('does not bundle where bundling is wrong, and refuses a glued value', () => {
    // `find`'s primaries are words: bundling `-name` into `-n -a -m -e` would
    // refuse every legitimate find. `head -n5` is the opposite problem — under
    // bundling it is `-n -5`, and a guard that cannot tell a value from a flag
    // should refuse rather than pick.
    expect(ALLOWED.find?.bundled).toBe(false)
    expect(refusal('head -n5 README.md').rule).toBe('flag')
    expect(planCommand(root, 'head -n 5 README.md').args).toEqual(['-n', '5', 'README.md'])
  })

  it('refuses standard input, which this tool does not have', () => {
    expect(refusal('cat -').rule).toBe('stdin')
  })
})

describe('the path rule', () => {
  it('refuses every way out of the sandbox it was given', () => {
    for (const command of [
      'ls ..',
      'cat ../../../etc/passwd',
      'cat /etc/passwd',
      'cat C:/Windows/win.ini',
      'ls //server/share',
      'cat notes/../../outside.txt',
      'cp README.md ../stolen.md',
      'mkdir ../planted',
      'find .. -name x',
    ]) {
      expect(refusal(command).rule).toBe('path')
    }
  })

  it('refuses a drive-qualified path on every platform, not only on Windows', () => {
    // The guard used to answer this differently depending on where it ran.
    // `path.resolve` reads `C:/Windows/win.ini` as an absolute path on Windows
    // and as an ordinary relative name on POSIX, so the same string was refused
    // on the machine the runs happened on and allowed on the Linux runner CI
    // uses. Both answers are right about their own platform, and that is the
    // defect: `attacks.tsv` is a committed claim about what this guard refuses,
    // and a claim that holds on one operating system is not the claim it is
    // printed as. The rule is explicit now, and this asserts the shape rather
    // than the platform.
    for (const command of [
      'cat C:/Windows/win.ini',
      'cat c:/windows/win.ini',
      'find C:/Windows -name x',
      'grep -m C:/Windows/win.ini needle README.md',
    ]) {
      expect(refusal(command).rule, command).toBe('path')
    }
    // The backslash spelling never reaches the path rule at all: `\` is a
    // metacharacter and rule 2 takes it first. Asserted rather than left
    // implicit, because "refused" and "refused by the rule you think" are
    // different facts and the attack table records the second one.
    expect(refusal('cat D:\\secrets\\keys.txt').rule).toBe('metacharacter')
  })

  it('has the drive rule as a predicate, because on Windows it is redundant', () => {
    // Every assertion above passes on this machine with the rule deleted:
    // `resolveInside` already refuses `C:/…` here, because `path.resolve` reads
    // it as absolute. The rule only does work on POSIX, where the same string
    // resolves inside the sandbox — so the only way to make it falsifiable on
    // the machine it was written on is to test the predicate itself. A test
    // that could only go red on an operating system I am not running is a test
    // I have not run.
    for (const value of ['C:/Windows', 'c:/windows', 'D:\\secrets', 'z:/x']) {
      expect(driveQualified(value), value).toBe(true)
    }
    for (const value of ['C:README.md', 'README.md:zone', '/etc/passwd', '..', 'a:b', '']) {
      expect(driveQualified(value), value).toBe(false)
    }
  })

  it('still allows the drive-relative form, which is the one that disagrees', () => {
    // `C:README.md` has no separator after the colon. On Windows it is
    // drive-relative and lands inside the sandbox; on POSIX it is a filename
    // with a colon in it and lands inside the sandbox. Both inside — and the
    // program it is handed to reads it as neither, which is the finding in the
    // attack table and the reason the rule above is anchored to the separator
    // rather than to the colon.
    expect(() => planCommand(root, 'cat C:README.md')).not.toThrow()
  })

  it("checks a flag's value by the same rule as an operand", () => {
    // A guard that stopped looking after it recognised a flag would not know
    // whether the token it skipped was a number or a path.
    expect(refusal('grep -m ../../etc/passwd needle README.md').rule).toBe('path')
    expect(refusal('head -n ../../etc/passwd README.md').rule).toBe('path')
  })

  it('refuses a path that reaches through a link, by the guard post 6 built', () => {
    const outside = mkdtempSync(join(tmpdir(), 'nine-shell-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE\n', 'utf8')
    const linked = mkdtempSync(join(tmpdir(), 'nine-shell-linked-'))
    try {
      symlinkSync(outside, join(linked, 'escape'), 'junction')
      expect(() => planCommand(linked, 'cat escape/secret.txt')).toThrow(ShellRefusal)
      expect(() => planCommand(linked, 'ls escape')).toThrow(ShellRefusal)
    } finally {
      rmSync(linked, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('checks operands that are not paths too, and lets them through', () => {
    // `4500` is not a path and `s/a/b/` is not a path, and the guard has no way
    // to know that. Running them through the path rule anyway is the only
    // honest option: the alternative is a list of arguments it does not check.
    expect(planCommand(root, 'grep -rn 4500 .').args).toEqual(['-rn', '4500', '.'])
  })
})

describe('resolveBinary', () => {
  it('refuses anything with a path separator in it', () => {
    expect(resolveBinary('/bin/ls')).toBeUndefined()
    expect(resolveBinary('../ls')).toBeUndefined()
    expect(resolveBinary('C:ls')).toBeUndefined()
    expect(resolveBinary('')).toBeUndefined()
  })

  it('will not run a batch file, whatever PATHEXT says', () => {
    // On Windows an argument vector handed to a `.bat` is re-parsed by
    // `cmd.exe`, so `shell: false` is not false for a batch file
    // (CVE-2024-27980). The fix is not to quote better; it is not to run one.
    const dir = mkdtempSync(join(tmpdir(), 'nine-shell-bat-'))
    try {
      writeFileSync(join(dir, 'ls.bat'), '@echo off\n', 'utf8')
      writeFileSync(join(dir, 'ls.cmd'), '@echo off\n', 'utf8')
      expect(resolveBinary('ls', dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takes the first PATH entry, which is a hole and not a feature', () => {
    // MEASURED, not asserted. An allow-list of names is a bet that a name is
    // an identity, and on any machine where something can be put in front of
    // PATH it is not. The agent cannot set PATH — there is no `env` and no
    // variable syntax — but whoever starts the process can, and post 6 found
    // the same shape in `TMP`.
    const real = resolveBinary('ls')
    expect(real).toBeDefined()
    const shim = mkdtempSync(join(tmpdir(), 'nine-shell-shim-'))
    try {
      const other = resolveBinary('whoami')
      if (other === undefined) return
      copyFileSync(other, join(shim, process.platform === 'win32' ? 'ls.exe' : 'ls'))
      const hijacked = resolveBinary('ls', shim + delimiter + (process.env.PATH ?? ''))
      expect(hijacked).toBe(join(shim, process.platform === 'win32' ? 'ls.exe' : 'ls'))
      expect(hijacked).not.toBe(real)
    } finally {
      rmSync(shim, { recursive: true, force: true })
    }
  })
})

describe('the environment the child gets', () => {
  it('does not carry anything that looks like a credential', () => {
    const env = childEnvironment(join('C:', 'Program Files', 'Git', 'usr', 'bin', 'ls.exe'))
    for (const name of Object.keys(env)) {
      expect(name).not.toMatch(/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i)
    }
    expect(Object.keys(env).sort()).toEqual(
      process.env.SystemRoot === undefined && process.env.SYSTEMROOT === undefined
        ? ['PATH']
        : ['PATH', 'SystemRoot'],
    )
  })

  it('is built rather than inherited, so a key in this process is not in the child', () => {
    const before = process.env.NINE_COMMITS_PROBE_KEY
    process.env.NINE_COMMITS_PROBE_KEY = 'PROBE-CANARY-VALUE'
    try {
      const env = childEnvironment('/usr/bin/ls')
      expect(Object.values(env).join(' ')).not.toContain('PROBE-CANARY-VALUE')
    } finally {
      if (before === undefined) delete process.env.NINE_COMMITS_PROBE_KEY
      else process.env.NINE_COMMITS_PROBE_KEY = before
    }
  })

  it('gives the child one PATH entry, so an allowed binary finds its own helpers and nothing else', () => {
    expect(childEnvironment('/usr/bin/ls').PATH).toBe(dirname('/usr/bin/ls'))
  })
})

describe('the fence round command output', () => {
  it('neuters both markers, so output cannot close the fence around itself', () => {
    expect(defuseOutputFence(`x ${OUTPUT_CLOSE} y`)).not.toContain(OUTPUT_CLOSE)
    expect(defuseOutputFence(`x ${OUTPUT_OPEN} y`)).not.toContain(OUTPUT_OPEN)
    expect(defuseOutputFence('ordinary output')).toBe('ordinary output')
  })
})

describe('createShell', () => {
  it('refuses to build a shell against this repository', () => {
    // `cat` has never heard of the dotfile rule that has kept `agent/.env` out
    // of six posts' traces, so a shell rooted at the checkout is a tool that
    // can read this project's one real secret.
    expect(() => createShell(PROJECT_ROOT)).toThrow(UnsafeRoot)
    expect(() => createShell(join(PROJECT_ROOT, 'agent'))).toThrow(UnsafeRoot)
  })

  it('runs an allowed command and fences what it printed', async () => {
    const shell = createShell(root)
    const result = await shell.runCommand('cat README.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('INSIDE-THE-SANDBOX')
    expect(result.stdout.startsWith(OUTPUT_OPEN)).toBe(true)
    expect(result.stdout.trimEnd().endsWith(OUTPUT_CLOSE)).toBe(true)
  })

  it('turns a refusal into a result the model can read, and counts it', async () => {
    const seen: ShellRefusal[] = []
    const shell = createShell(root, { onRefusal: (error) => seen.push(error) })
    const result = await shell.runCommand('rm -rf .')
    expect(result).toEqual({ ok: false, error: expect.stringContaining('refused') })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.rule).toBe('binary')
    // And the sandbox is untouched.
    expect(readdirSync(root).sort()).toContain('README.md')
  })

  it('does not throw out of execute, whatever it is handed', async () => {
    const shell = createShell(root)
    for (const command of [undefined, null, 42, '', '   ', '\u0000', 'a'.repeat(2000)]) {
      const result = await shell.runCommand(command)
      expect(result.ok).toBe(false)
    }
  })

  it('returns a non-zero exit as a result rather than a failure', async () => {
    // `grep` exits 1 when it matches nothing. A tool that reported that as
    // `ok: false` would cap every such run's recorded grade at `partial`, by
    // a rule written at v2 for an agent whose only product was a sentence.
    const shell = createShell(root)
    const result = await shell.runCommand('grep -r NOTHING-IS-HERE .')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.exitCode).toBe(1)
  })

  it('does not wait for standard input', async () => {
    const shell = createShell(root)
    const result = await shell.runCommand('cat')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timedOut).toBe(false)
  })

  it('caps what one command can put into the context', async () => {
    const big = mkdtempSync(join(tmpdir(), 'nine-shell-big-'))
    try {
      writeFileSync(join(big, 'big.txt'), 'x'.repeat(OUTPUT_CHAR_LIMIT * 3), 'utf8')
      const shell = createShell(big)
      const result = await shell.runCommand('cat big.txt')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.truncated).toBe(true)
      expect(result.stdout.length).toBeLessThan(
        OUTPUT_CHAR_LIMIT + OUTPUT_OPEN.length + OUTPUT_CLOSE.length + 4,
      )
    } finally {
      rmSync(big, { recursive: true, force: true })
    }
  })

  it('leaves everything outside the sandbox exactly as it found it', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'nine-shell-canary-'))
    const canaryPath = join(outside, 'canary.txt')
    writeFileSync(canaryPath, 'CANARY\n', 'utf8')
    const shell = createShell(root)
    try {
      for (const command of [
        'cp README.md ../canary.txt',
        'mv README.md ../canary.txt',
        'mkdir ../planted',
        'touch ../planted.txt',
        'cat ../canary.txt',
      ]) {
        expect((await shell.runCommand(command)).ok).toBe(false)
      }
      expect(readFileSync(canaryPath, 'utf8')).toBe('CANARY\n')
      expect(readdirSync(outside)).toEqual(['canary.txt'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does change every byte of a file inside the sandbox, with cp and no flag', async () => {
    // The published thesis used to say the tool "cannot change a byte inside a
    // file". `cp` falsifies that in two tokens, and this is the measurement,
    // end to end through the same function a live run calls. The claim that
    // survives is narrower: nothing in the allow-list can *author* content.
    const box = mkdtempSync(join(tmpdir(), 'nine-shell-cp-'))
    try {
      writeFileSync(join(box, 'source.txt'), 'OTHER\n', 'utf8')
      writeFileSync(join(box, 'target.txt'), 'ORIGINAL-CONTENT\n', 'utf8')
      const shell = createShell(box)

      const copied = await shell.runCommand('cp source.txt target.txt')
      expect(copied.ok).toBe(true)
      if (copied.ok) expect(copied.exitCode).toBe(0)
      expect(readFileSync(join(box, 'target.txt'), 'utf8')).toBe('OTHER\n')

      expect((await shell.runCommand('touch brand-new.txt')).ok).toBe(true)
      expect((await shell.runCommand('mkdir newdir')).ok).toBe(true)
      expect((await shell.runCommand('mv source.txt renamed.txt')).ok).toBe(true)
      expect(readdirSync(box).sort()).toEqual([
        'brand-new.txt',
        'newdir',
        'renamed.txt',
        'target.txt',
      ])

      // And the narrow claim, which is the one the post makes: every byte now
      // in the sandbox was already on disk. Nothing the model composed is.
      expect(readFileSync(join(box, 'brand-new.txt'), 'utf8')).toBe('')
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  })
})
