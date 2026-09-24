import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { check, FACTS, NOTE, PROMPT } from './task.ts'
import { POSTS_DIR, TRACE_FILE } from '../paths.ts'
import { parseTrace } from '../trace/schema.ts'
import {
  FETCH_CHAR_LIMIT,
  PROVIDER_HOST,
  titleFromUrl,
} from '../../agent/src/tools/web.ts'

const POST_DIR = join(POSTS_DIR, '07-context')

/*
 * A grader that cannot fail is not a grader, and post 6 had to say so about
 * one that returned `pass` a hundred and fifty times. So most of this file is
 * failures: the notes a plausible bad run would leave behind, each asserted to
 * be refused, and each one a mistake that actually happened in a pilot or is
 * one keystroke away from it.
 */

const TCP = 'https://en.wikipedia.org/wiki/Transmission_Control_Protocol'
const IPV6 = 'https://en.wikipedia.org/wiki/IPv6'
const UTF8 = 'https://en.wikipedia.org/wiki/UTF-8'

const good = [
  `- TCP header minimum: 20 bytes — ${TCP}`,
  `- IPv6 address length: 128 bits — ${IPV6}`,
  `- UTF-8 code points: 1,112,064 — ${UTF8}`,
  '',
].join('\n')

const tree = (note: string): Record<string, string> => ({ [NOTE]: note })

describe('the research task', () => {
  it('asks for a citation, because the model already knows the answers', () => {
    // Every one of these three numbers is something `gpt-5-mini` can produce
    // from memory. A task it can answer without looking is not a task about
    // context, so the note has to name the page — which forces the page into
    // the window, which is the thing under test.
    expect(PROMPT).toMatch(/URL of/)
    expect(PROMPT).toMatch(/rather than answering from memory/)
  })

  it('names the file it wants, so the grade is on a file and not on a sentence', () => {
    expect(PROMPT).toContain(NOTE)
  })

  it('points every answer at a page the fetch tool will accept', () => {
    for (const fact of FACTS) {
      expect(titleFromUrl(fact.url)).toBeDefined()
      expect(fact.url).toContain(PROVIDER_HOST)
    }
  })
})

describe('check', () => {
  it('passes a note with three answers, each beside its source', () => {
    const verdict = check(tree(good))
    expect(verdict.pass).toBe(true)
    expect(verdict.facts).toEqual(FACTS.map((f) => f.id))
  })

  it('accepts a bare number, because a unit is formatting and not an answer', () => {
    // The discarded pilot wrote `20 <url>` with no unit and the first version
    // of this grader called it a miss. That was grading the shape of the
    // sentence, which is the mistake post 6 found in the recorder.
    const bare = [
      `1. 20 ${TCP}`,
      `2. 128 ${IPV6}`,
      `3. 1112064 ${UTF8}`,
    ].join('\n')
    expect(check(tree(bare)).pass).toBe(true)
  })

  it('fails when there is no note at all', () => {
    const verdict = check({})
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toContain(NOTE)
  })

  it('fails an empty note', () => {
    expect(check(tree('')).pass).toBe(false)
  })

  it('fails when an answer is missing', () => {
    const two = good.split('\n').filter((line) => !line.includes('IPv6')).join('\n')
    const verdict = check(tree(two))
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toContain('ipv6-length')
  })

  it('fails an answer that cites the wrong page', () => {
    // This is not hypothetical. A pilot run wrote `128 bits` and cited
    // `/wiki/IP_address`, having lost track of which page the number came from
    // across a compaction. The number was right and the provenance was not.
    const wrong = good.replace(IPV6, 'https://en.wikipedia.org/wiki/IP_address')
    const verdict = check(tree(wrong))
    expect(verdict.pass).toBe(false)
    expect(verdict.facts).not.toContain('ipv6-length')
    // and the looser count still sees the number, which is how the tally can
    // report the difference between "wrong" and "unsourced"
    expect(verdict.loose).toContain('ipv6-length')
  })

  it('fails a note that has every number and every source, mispaired', () => {
    // The reason the check is per line. As one blob this note contains all
    // three numbers and all three URLs and every pairing is wrong.
    const mispaired = [
      `1. 128 bits — ${TCP}`,
      `2. 1,112,064 — ${IPV6}`,
      `3. 20 bytes — ${UTF8}`,
    ].join('\n')
    expect(check(tree(mispaired)).pass).toBe(false)
  })

  it('fails a wrong number', () => {
    expect(check(tree(good.replace('20 bytes', '24 bytes'))).pass).toBe(false)
    expect(check(tree(good.replace('128 bits', '64 bits'))).pass).toBe(false)
    expect(check(tree(good.replace('1,112,064', '1,114,112'))).pass).toBe(false)
  })

  it('does not accept a number that is part of a larger one', () => {
    // `2026` contains `20` and `1128` contains `128`. A grader that matched
    // those would pass a note that answered nothing and dated itself.
    const dated = [
      `1. Looked up on 2026-09-24 — ${TCP}`,
      `2. Address is 1128 long — ${IPV6}`,
      `3. 1,112,064 — ${UTF8}`,
    ].join('\n')
    const verdict = check(tree(dated))
    expect(verdict.facts).toEqual(['utf8-codepoints'])
  })

  it('fails a run that wrote somewhere else as well', () => {
    const verdict = check({ ...tree(good), 'scratch.txt': 'notes' })
    expect(verdict.pass).toBe(false)
    expect(verdict.why).toContain('scratch.txt')
  })

  it('fails a run that did nothing, which is the rubber-stamp check', () => {
    expect(check({}).pass).toBe(false)
    expect(check(tree('I could not find the answers.')).pass).toBe(false)
  })
})

/*
 * The other half of a fair task: every answer has to be inside the part of the
 * page the agent is actually handed. The TCP article is 70,763 characters and
 * the fetch limit is 24,000, so an answer in the last third would make this a
 * measurement of the limit rather than of the run.
 *
 * Checked against the committed cache, which is the corpus the runs read.
 */
describe('what the agent was actually handed', () => {
  /** Every page body that reached the model, across every published trace. */
  const fetched = (existsSync(POST_DIR) ? readdirSync(POST_DIR) : [])
    .filter((name) => TRACE_FILE.test(name))
    .flatMap((name) => parseTrace(JSON.parse(readFileSync(join(POST_DIR, name), 'utf8'))).frames)
    .filter((frame) => frame.type === 'tool_result' && frame.ok)
    .map((frame) => (frame as { result: unknown }).result as { url?: unknown; content?: unknown })
    .filter(
      (result): result is { url: string; content: string } =>
        typeof result.url === 'string' && typeof result.content === 'string',
    )

  it('ships traces that contain real fetched pages', () => {
    expect(fetched.length).toBeGreaterThan(0)
  })

  it('never hands the model more than the fetch limit', () => {
    for (const page of fetched) {
      // The fence adds a line at each end, so a page body is the limit plus two
      // short labels — never the whole of a 70,000-character article.
      expect(page.content.length).toBeLessThan(FETCH_CHAR_LIMIT + 200)
    }
  })

  it('only ever fetched the provider the search results came from', () => {
    for (const page of fetched) {
      expect(titleFromUrl(page.url)).toBeDefined()
      expect(new URL(page.url).host).toBe(PROVIDER_HOST)
    }
  })

  it.each(FACTS.map((fact) => [fact.id] as const))(
    'put %s’s answer inside what the agent was handed',
    (id) => {
      const fact = FACTS.find((candidate) => candidate.id === id)
      expect(fact).toBeDefined()
      const page = fetched.find((candidate) => candidate.url === fact?.url)
      expect(page, `no published trace fetched ${fact?.url}`).toBeDefined()
      expect(fact?.pattern.test(page?.content ?? '')).toBe(true)
    },
  )
})
