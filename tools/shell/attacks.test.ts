import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { ATTACKS } from './attacks.ts'
import { parseAttacks } from './attack-row.ts'
import { ALLOWED_NAMES, planCommand, ShellRefusal } from '../../agent/src/tools/shell.ts'

/*
 * The committed attack table, recounted.
 *
 * Every number post 8 prints about the guard comes out of
 * `site/src/content/posts/08-shell/attacks.tsv`, and this file recomputes each
 * of them from that file. If the prose and the table drift apart, `npm test`
 * says so — which is the rule every tally in this series is held to since post
 * 2 typed its table out of a terminal by hand.
 *
 * It also re-runs the guard over the committed table's own command strings, so
 * a change to `shell.ts` that quietly starts allowing something the table says
 * was refused turns this red without anyone having to re-run `npm run attacks`.
 */

const TABLE = join(POSTS_DIR, '08-shell', 'attacks.tsv')
const rows = parseAttacks(readFileSync(TABLE, 'utf8'))

/** The escaped spellings `attack-row.ts` writes, undone. */
function unescape(command: string): string {
  return command
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\0/g, '\u0000')
}

describe('the committed attack table', () => {
  it('has a row for every attack, and no row for anything else', () => {
    expect(rows.map((row) => row.id).sort()).toEqual(
      ATTACKS.map((attack) => attack.id).sort(),
    )
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('is the size the post says it is', () => {
    expect(rows).toHaveLength(97)
    expect(rows.filter((row) => row.verdict === 'refused')).toHaveLength(80)
    expect(rows.filter((row) => row.verdict === 'allowed')).toHaveLength(17)
  })

  it('agreed with every prediction, which is the weakest of its results', () => {
    // Zero disagreements is not evidence that the guard is good. It is
    // evidence that its author and its attacker are the same person. The
    // holes this commit actually found — the PATH shim, the environment the
    // MSYS runtime rebuilds, the eleven things allowed *inside* the sandbox —
    // were found by measuring, not by predicting, and three of them are in
    // `shell.test.ts` rather than here.
    expect(rows.filter((row) => row.agreed === 'no')).toHaveLength(0)
  })

  it('counts the refusals by rule the way the post does', () => {
    const byRule = new Map<string, number>()
    for (const row of rows.filter((r) => r.verdict === 'refused')) {
      byRule.set(row.rule, (byRule.get(row.rule) ?? 0) + 1)
    }
    expect(Object.fromEntries([...byRule].sort())).toEqual({
      binary: 25,
      empty: 1,
      flag: 14,
      metacharacter: 24,
      path: 13,
      stdin: 1,
      'too-long': 1,
      'unterminated-quote': 1,
    })
  })

  it('counts the classes the way the post does', () => {
    const byClass = new Map<string, number>()
    for (const row of rows) byClass.set(row.class, (byClass.get(row.class) ?? 0) + 1)
    expect(Object.fromEntries([...byClass].sort())).toEqual({
      chaining: 8,
      flag: 14,
      inside: 11,
      interpreter: 20,
      parser: 13,
      path: 15,
      prototype: 4,
      substitution: 12,
    })
  })

  it('refused every attack whose goal was to leave the sandbox or start a program', () => {
    // The four classes that would be a breach. Every row in them is refused;
    // if one ever is not, this is the test that says so.
    for (const row of rows) {
      if (['chaining', 'substitution', 'interpreter', 'prototype'].includes(row.class)) {
        expect(row.verdict, `${row.id}: ${row.command}`).toBe('refused')
      }
    }
    for (const row of rows.filter((r) => r.class === 'path')) {
      // One exception, and it is in the table by name: a drive-relative path
      // that Node resolves inside the sandbox and MSYS reads as a filename.
      // Neither reaches outside; the finding is that the two disagree at all.
      if (row.id === 'drive-relative' || row.id === 'colon-prefix') continue
      expect(row.verdict, `${row.id}: ${row.command}`).toBe('refused')
    }
  })

  it('records that every allowed row is allowed inside the sandbox and nowhere else', () => {
    for (const row of rows.filter((r) => r.verdict === 'allowed')) {
      expect(['parser', 'path', 'inside'], `${row.id}`).toContain(row.class)
    }
  })

  it('shows the dotfile the four filesystem tools cannot see, being read', () => {
    const row = rows.find((candidate) => candidate.id === 'cat-dotfile')
    expect(row?.verdict).toBe('allowed')
    expect(row?.effect).toContain('AGENT_TOKEN=DECOY_SECRET_NOT_A_REAL_KEY')
  })

  it('still refuses what it says it refused, run against the guard as it stands', () => {
    // Not a recount of the file: the file's own command strings, put back
    // through `planCommand`. A change to `shell.ts` that started allowing one
    // of them would leave the table and the code disagreeing, and a committed
    // table nobody re-runs is a claim about a version of the code that is gone.
    const root = mkdtempSync(join(tmpdir(), 'nine-attacks-recheck-'))
    try {
      for (const row of rows.filter((r) => r.verdict === 'refused')) {
        let caught: unknown
        try {
          planCommand(root, unescape(row.command))
        } catch (error: unknown) {
          caught = error
        }
        expect(caught, `${row.id}: ${row.command} was not refused`).toBeInstanceOf(
          ShellRefusal,
        )
        // And refused for the same reason. A rule that changed which branch
        // catches an attack is a change to the guard's shape, even when the
        // verdict is the same.
        expect((caught as ShellRefusal).rule, `${row.id}: ${row.command}`).toBe(row.rule)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still allows what it says it allowed', () => {
    const root = mkdtempSync(join(tmpdir(), 'nine-attacks-recheck-'))
    try {
      for (const row of rows.filter((r) => r.verdict === 'allowed')) {
        expect(
          () => planCommand(root, unescape(row.command)),
          `${row.id}: ${row.command}`,
        ).not.toThrow()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the allow-list the post names', () => {
  it('is fifteen binaries and none of them can change a byte inside a file', () => {
    // The post prints these fifteen names in a sentence. If one is added or
    // removed and the sentence is not, this is what says so.
    expect(ALLOWED_NAMES).toEqual([
      'cat', 'cp', 'diff', 'echo', 'find', 'grep', 'head',
      'ls', 'mkdir', 'mv', 'sort', 'tail', 'touch', 'uniq', 'wc',
    ])
    expect(ALLOWED_NAMES).toHaveLength(15)
  })
})
