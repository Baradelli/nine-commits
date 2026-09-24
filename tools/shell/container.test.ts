import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * `container.md` against `unguarded.mjs`.
 *
 * The container transcript is the strongest claim on the page — a shell is
 * everything you can do, shown rather than asserted — and until this file
 * existed it was the weakest anchor: one hand-written Markdown file that would
 * go stale silently if anybody added, removed or reworded a `show(...)` call.
 * Every other claim in commit 8 is pinned to a committed table that a script
 * regenerates. This is the closest equivalent available for a transcript that
 * can only be produced by destroying a container: it cannot prove the outputs
 * were recorded rather than typed, but it does prove the transcript is a
 * transcript of *this* script, in this order, and that the two numbers the
 * prose depends on — twelve lines of output, and which calls were cut at it —
 * are true of the file as committed.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = readFileSync(join(HERE, 'unguarded.mjs'), 'utf8')
const DOC = readFileSync(join(HERE, 'container.md'), 'utf8')

/** A JS single-quoted literal, backslash escapes included. */
const SHOW = /^\s*show\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/gm

function unescapeJs(literal: string): string {
  return literal.replace(/\\(.)/g, '$1')
}

/** The `show(what, command)` calls in `unguarded.mjs`, in source order. */
function shownCalls(): { what: string; command: string }[] {
  SHOW.lastIndex = 0
  const out: { what: string; command: string }[] = []
  let match: RegExpExecArray | null
  while ((match = SHOW.exec(SCRIPT)) !== null) {
    out.push({ what: unescapeJs(match[1] as string), command: unescapeJs(match[2] as string) })
  }
  return out
}

/** The fenced block under `## The transcript`, as lines. */
function transcript(): string[] {
  const section = DOC.split('\n## The transcript\n')[1]
  expect(section).toBeDefined()
  const fenced = (section as string).split('```')[1]
  expect(fenced).toBeDefined()
  return (fenced as string).split('\n')
}

/** Output blocks, keyed by the command line that produced them. */
function blocks(): { command: string; what: string; output: string[] }[] {
  const out: { command: string; what: string; output: string[] }[] = []
  let current: { command: string; what: string; output: string[] } | undefined
  for (const line of transcript()) {
    if (line.startsWith('$ ')) {
      current = { command: line.slice(2), what: '', output: [] }
      out.push(current)
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('# ')) {
      current.what = line.slice(2)
      continue
    }
    if (line.startsWith('  ')) current.output.push(line.slice(2))
  }
  return out
}

describe('the container transcript against the script that produced it', () => {
  it('runs exactly the commands unguarded.mjs shows, in order', () => {
    expect(blocks().map((block) => block.command)).toEqual(
      shownCalls().map((call) => call.command),
    )
  })

  it('labels each one with the same sentence the script passes', () => {
    expect(blocks().map((block) => block.what)).toEqual(
      shownCalls().map((call) => call.what),
    )
  })

  it('names the truncation the script does, because the transcript is not whole output', () => {
    // `show` slices at twelve. The doc used to say the transcript was
    // "unedited except for indentation", which is how `cat /etc/shadow` and
    // `ls /` came to be published as if they were a whole file and a whole
    // directory.
    expect(SCRIPT).toContain('.slice(0, 12)')
    expect(DOC).toMatch(/first twelve\s+lines/)

    const longest = Math.max(...blocks().map((block) => block.output.length))
    expect(longest).toBe(12)

    const cut = blocks()
      .filter((block) => block.output.length === 12)
      .map((block) => block.command)
    expect(cut).toEqual(['cat /etc/shadow', 'ls /'])
  })

  it('reproduces the docker command it claims to, flag included', () => {
    // The script is inert without the flag, so a reproduce block that omits it
    // would print a refusal instead of the transcript above it.
    expect(SCRIPT).toContain("process.argv.includes('--destroy-this-container')")
    for (const line of DOC.split('\n').filter((l) => l.includes('node /work.mjs'))) {
      // Every invocation in the doc either carries the flag, or is one of the
      // refusal demonstrations, which are there precisely because it does not.
      const hasFlag = line.includes('node /work.mjs --destroy-this-container')
      const isRefusalDemo = line.includes("node /work.mjs'")
      expect(hasFlag || isRefusalDemo).toBe(true)
    }
  })
})
