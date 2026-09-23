import { describe, it, expect } from 'vitest'
import { reachOf, toRow, HEADER, type Trace } from './corpus-reach.ts'

/*
 * The columns behind post 3's corpus table.
 *
 * Every fixture here is shaped like a real search result and carries no value
 * this repository's runs were graded on: a fixture holding the answer key
 * would plant it in the corpus the agent searches, which is the exact defect
 * the table it supports exists to count.
 */

const search = (matches: { file: string; line: number; text: string }[]) => ({
  type: 'tool_result',
  result: { matches },
})

const call = { type: 'tool_call', name: 'search_files' }
const said = (content: string) => ({ type: 'assistant', content })

const trace = (frames: Trace['frames']): Trace => ({ frames })

describe('reachOf', () => {
  it('counts only search calls', () => {
    const t = trace([call, { type: 'tool_call', name: 'list_files' }, call])
    expect(reachOf('r', t).searchCalls).toBe(2)
  })

  it('collects published post files, deduplicated and sorted', () => {
    const t = trace([
      search([
        { file: 'site/src/content/posts/02-hands/index.mdx', line: 9, text: 'x' },
        { file: 'site/src/content/posts/01-not-an-agent/index.mdx', line: 4, text: 'y' },
        { file: 'site/src/content/posts/02-hands/index.mdx', line: 12, text: 'z' },
        { file: 'agent/src/run.ts', line: 1, text: 'not a post' },
      ]),
    ])
    expect(reachOf('r', t).postFiles).toEqual([
      'site/src/content/posts/01-not-an-agent/index.mdx',
      'site/src/content/posts/02-hands/index.mdx',
    ])
  })

  it("sees post 2's prose statement of the answer only inside a post", () => {
    const inPost = trace([
      search([
        {
          file: 'site/src/content/posts/02-hands/index.mdx',
          line: 102,
          text: 'The true answer is `a/b.ts`, and `a-value`. You can read both',
        },
      ]),
    ])
    const elsewhere = trace([
      search([
        { file: 'README.md', line: 3, text: 'The true answer is elsewhere' },
      ]),
    ])
    expect(reachOf('r', inPost).sawPostAnswer).toBe(true)
    expect(reachOf('r', elsewhere).sawPostAnswer).toBe(false)
  })

  /*
   * The usage example names a path and a value in one string; the doc comment
   * two lines above it names neither. Telling them apart is the whole job, and
   * getting it wrong in either direction would move a published number.
   */
  it("tells the CLI's usage example from its placeholder", () => {
    const example = trace([
      search([
        {
          file: 'agent/src/cli.ts',
          line: 48,
          text: `'must contain, e.g. TRACE_EXPECT="some/path.ts,some-value". ' +`,
        },
      ]),
    ])
    const placeholder = trace([
      search([
        {
          file: 'agent/src/cli.ts',
          line: 22,
          text: '* the question, given as `TRACE_EXPECT="a,b"`.',
        },
      ]),
    ])
    expect(reachOf('r', example).sawCliAnswer).toBe(true)
    expect(reachOf('r', placeholder).sawCliAnswer).toBe(false)
  })

  it('sees the ground truth only in the file that holds it', () => {
    const source = trace([
      search([
        { file: 'agent/src/config.ts', line: 1, text: 'export const MODEL_NAME = ...' },
      ]),
    ])
    const quotedElsewhere = trace([
      search([{ file: 'agent/src/run.ts', line: 3, text: 'import { MODEL_NAME }' }]),
    ])
    expect(reachOf('r', source).sawGroundTruth).toBe(true)
    expect(reachOf('r', quotedElsewhere).sawGroundTruth).toBe(false)
  })

  it.each([
    ['the post says so', true],
    ['see 02-hands/index.mdx', true],
    ['the README covers it', true],
    ['it is in DECISIONS.md', true],
    ['The file agent/src/config.ts sets it.', false],
  ])('grades %s as naming a document: %s', (answer, expected) => {
    expect(reachOf('r', trace([said(answer)])).answerNamesADoc).toBe(expected)
  })

  it('joins and flattens every assistant frame into the final answer', () => {
    const t = trace([said('First\n  part.'), search([]), said('Second part.')])
    expect(reachOf('r', t).finalAnswer).toBe('First part. Second part.')
  })

  it('reports nothing rather than throwing on a run with no frames', () => {
    const r = reachOf('empty', trace([]))
    expect(r).toMatchObject({
      searchCalls: 0,
      postFiles: [],
      sawPostAnswer: false,
      sawCliAnswer: false,
      sawGroundTruth: false,
      answerNamesADoc: false,
      finalAnswer: '',
    })
  })
})

describe('toRow', () => {
  it('writes one tab-separated field per header column', () => {
    const row = toRow(reachOf('r', trace([said('an answer')])))
    expect(row.split('\t')).toHaveLength(HEADER.split('\t').length)
  })

  it('writes a dash rather than an empty cell when no post was reached', () => {
    expect(toRow(reachOf('r', trace([]))).split('\t')[2]).toBe('-')
  })
})
