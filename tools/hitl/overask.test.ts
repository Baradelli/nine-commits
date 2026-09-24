import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ALLOWED_NAMES, createShell } from '../../agent/src/tools/shell.ts'
import { binaryOf, couldChangeSomething, overAsk, readShellRuns, WRITERS } from './overask.ts'

/*
 * What a name-based gate would have cost, checked against the file it is
 * counted from — and the one list it depends on, re-derived rather than
 * trusted.
 *
 * `WRITERS` is an enumeration, and this series has shipped four wrong ones in
 * a row. `tools/shell/writers.test.ts` derives the same set by running fifteen
 * binaries with a table of fifteen probes; copying that table here would make
 * the second check a copy of the first. So the derivation below is
 * independent: one probe shape, `<binary> in.txt out.txt`, applied to every
 * allow-listed name. Two different measurements agreeing is worth more than
 * one measurement asserted twice.
 */

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'nine-overask-'))
  writeFileSync(join(root, 'in.txt'), 'a\na\nb\n', 'utf8')
  return root
}

async function deriveWriters(): Promise<string[]> {
  const writers: string[] = []
  for (const name of ALLOWED_NAMES) {
    const root = sandbox()
    try {
      const shell = createShell(root)
      // The listing, not its length. Counting entries misses `mv`, which
      // moves `in.txt` onto the probe name and leaves the directory exactly
      // as long as it was — and a derivation with that bug in it would have
      // "independently confirmed" a set of four.
      const before = readdirSync(root).sort().join(' ')
      await shell.runCommand(`${name} in.txt probe-out.txt`)
      if (readdirSync(root).sort().join(' ') !== before) writers.push(name)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  return writers
}

const DERIVED = await deriveWriters()

describe('the writing set, derived a second way', () => {
  it('matches the list this module counts with', () => {
    expect([...DERIVED].sort()).toEqual([...WRITERS].sort())
  })

  it('is five of the fifteen', () => {
    expect(DERIVED).toHaveLength(5)
    expect(ALLOWED_NAMES).toHaveLength(15)
  })
})

describe('couldChangeSomething', () => {
  it('is false for a command that only reads', () => {
    expect(couldChangeSomething('grep -r parcel .')).toBe(false)
    expect(couldChangeSomething('wc -c README.md')).toBe(false)
    expect(couldChangeSomething('ls -la')).toBe(false)
  })

  it('is true for one of the five that write', () => {
    expect(couldChangeSomething('cp a b')).toBe(true)
    expect(couldChangeSomething('uniq -c a b')).toBe(true)
  })

  it('is true for a binary the shell guard would refuse', () => {
    // Generous to the gate on purpose: the gate is asked before the guard
    // runs, so it cannot know `sh` would be refused. Counting these as useful
    // questions under-counts the wasted ones.
    expect(couldChangeSomething('sh -c "rm -rf /"')).toBe(true)
    expect(couldChangeSomething('sed -i s/a/b/ f')).toBe(true)
  })

  it('is false for nothing at all', () => {
    expect(couldChangeSomething('   ')).toBe(false)
  })

  it('reads the first word as the program', () => {
    expect(binaryOf('  grep   -r x .')).toBe('grep')
  })
})

describe("over post 8's committed runs", () => {
  const measured = overAsk(readShellRuns())

  it('counts the runs the post counted', () => {
    expect(measured.runs).toBe(140)
  })

  it('would have asked once per command line the model wrote', () => {
    expect(measured.questions).toBe(79)
    expect(measured.commands).toBe(79)
  })

  it('finds that not one of those questions was about something that could change a byte', () => {
    expect(measured.pointless).toBe(79)
    expect(measured.questions - measured.pointless).toBe(0)
  })

  it('names the four programs the model actually reached for', () => {
    expect(Object.fromEntries(measured.binaries)).toEqual({
      grep: 55,
      wc: 17,
      find: 6,
      ls: 1,
    })
  })

  it('would have interrupted a third of the runs', () => {
    expect(measured.runsInterrupted).toBe(31)
  })
})
