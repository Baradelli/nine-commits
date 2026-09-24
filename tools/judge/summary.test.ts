import { describe, it, expect } from 'vitest'
import { parseTrace, type Trace } from '../trace/schema.ts'
import {
  buildSummaryPrompt,
  checkQuote,
  compactionsIn,
  historyBefore,
  parseSummaryJudgement,
  SUMMARY_JUDGE_INSTRUCTIONS,
  UnreadableSummaryJudgement,
} from './summary.ts'
import { corruptedSummary, verbatimSummary } from './summary-panel.ts'

/*
 * The summary judge, with no network anywhere.
 *
 * What is tested here is everything except the model call: the panel's two
 * constructions, the quotation check that makes a verdict falsifiable, and the
 * parse that refuses rather than retries.
 */

const PAGE = [
  'IPv6 is the most recent version of the Internet Protocol.',
  'An IPv6 address is 128 bits long, four times as long as an IPv4 address.',
  'It was designed as a successor to IPv4 and is described in RFC 8200 and other documents.',
].join('\n')

const trace: Trace = parseTrace({
  id: 'fixture',
  commit: 'v7-context',
  model: 'a-model',
  task: 'look something up',
  outcome: 'success',
  tokens: [100, 200, 300, 400, 500, 600],
  frames: [
    { type: 'user', content: 'look something up' },
    { type: 'tool_call', id: 'c1', name: 'web_search', args: { query: 'IPv6' } },
    {
      type: 'tool_result',
      id: 'c1',
      ok: true,
      result: {
        ok: true,
        query: 'IPv6',
        results: [
          {
            title: 'IPv6',
            url: 'https://en.wikipedia.org/wiki/IPv6',
            snippet: 'IPv6 is the most recent version',
          },
        ],
      },
    },
    {
      type: 'tool_call',
      id: 'c2',
      name: 'fetch_page',
      args: { url: 'https://en.wikipedia.org/wiki/IPv6' },
    },
    {
      type: 'tool_result',
      id: 'c2',
      ok: true,
      result: {
        ok: true,
        url: 'https://en.wikipedia.org/wiki/IPv6',
        title: 'IPv6',
        chars: PAGE.length,
        truncated: false,
        cached: true,
        content: PAGE,
      },
    },
    {
      type: 'compaction',
      before: 9000,
      after: 1200,
      summary: 'The run searched for IPv6 and found that an address is 128 bits long.',
    },
  ],
})

describe('compactionsIn', () => {
  it('finds the compaction and where it happened', () => {
    expect(compactionsIn(trace)).toEqual([
      {
        index: 5,
        before: 9000,
        after: 1200,
        summary: 'The run searched for IPv6 and found that an address is 128 bits long.',
      },
    ])
  })

  it('finds nothing in a trace that never compacted', () => {
    const plain = parseTrace({
      ...trace,
      frames: trace.frames.slice(0, 5),
      tokens: trace.tokens.slice(0, 5),
    })
    expect(compactionsIn(plain)).toEqual([])
  })
})

describe('historyBefore', () => {
  it('is everything up to the rewrite, and keeps one token per frame', () => {
    const history = historyBefore(trace, 5)
    expect(history.frames).toHaveLength(5)
    expect(history.tokens).toHaveLength(5)
    expect(history.frames.some((frame) => frame.type === 'compaction')).toBe(false)
  })
})

describe('verbatimSummary', () => {
  const history = historyBefore(trace, 5)
  const summary = verbatimSummary(history)

  it('says only things the transcript says', () => {
    expect(summary).toContain('"IPv6"')
    expect(summary).toContain('https://en.wikipedia.org/wiki/IPv6')
    // The quoted sentence is in the page, character for character.
    const quoted = summary.split('contains this sentence: ')[1] ?? ''
    expect(quoted.length).toBeGreaterThan(40)
    expect(PAGE).toContain(quoted)
  })
})

describe('corruptedSummary', () => {
  it('changes exactly one number and leaves the rest alone', () => {
    const original = 'The run found that an IPv6 address is 128 bits long.'
    const corrupted = corruptedSummary(original)
    expect(corrupted).toBeDefined()
    expect(corrupted).not.toBe(original)
    expect(corrupted).not.toContain('128')
    // Same shape, same length, one digit different: the prose is identically
    // confident and exactly one claim is now false.
    expect(corrupted).toHaveLength(original.length)
    expect(corrupted).toContain('IPv6 address is')
  })

  it('refuses rather than inventing a control when there is no number', () => {
    // A case whose known answer had to be manufactured is not a control.
    expect(corruptedSummary('The run searched and found nothing useful.')).toBeUndefined()
  })
})

describe('checkQuote', () => {
  const summary = 'An IPv6 address is 128 bits long.'

  it('passes a quotation that is in the summary', () => {
    expect(
      checkQuote(summary, { verdict: 'unsupported', quote: '128 bits long' }),
    ).toBe('present')
  })

  it('catches a judge objecting to a sentence it wrote itself', () => {
    expect(
      checkQuote(summary, { verdict: 'unsupported', quote: '64 bits long' }),
    ).toBe('absent')
  })

  it('catches an objection with nothing objected to', () => {
    expect(checkQuote(summary, { verdict: 'unsupported', quote: 'none' })).toBe('none')
    expect(checkQuote(summary, { verdict: 'unsupported', quote: '  ' })).toBe('none')
  })

  it('has nothing to check when the verdict is that everything checks out', () => {
    expect(checkQuote(summary, { verdict: 'supported', quote: 'none' })).toBe('n/a')
  })

  it('ignores whitespace and case, which are formatting', () => {
    expect(
      checkQuote(summary, { verdict: 'unsupported', quote: 'an  IPV6\naddress' }),
    ).toBe('present')
  })
})

describe('parseSummaryJudgement', () => {
  const good = '{"verdict":"supported","quote":"none","confidence":0.9,"reason":"all of it"}'

  it('reads a judgement', () => {
    expect(parseSummaryJudgement(good).verdict).toBe('supported')
  })

  it('reads one inside a fenced block, which is what models do', () => {
    expect(parseSummaryJudgement('```json\n' + good + '\n```').verdict).toBe('supported')
  })

  it('refuses a reply that is not JSON', () => {
    expect(() => parseSummaryJudgement('I think it is fine')).toThrow(
      UnreadableSummaryJudgement,
    )
  })

  it('refuses a verdict outside the two', () => {
    expect(() =>
      parseSummaryJudgement('{"verdict":"maybe","quote":"none","confidence":1,"reason":"x"}'),
    ).toThrow(UnreadableSummaryJudgement)
  })

  it('refuses a confidence outside 0 to 1', () => {
    expect(() =>
      parseSummaryJudgement('{"verdict":"supported","quote":"none","confidence":7,"reason":"x"}'),
    ).toThrow(UnreadableSummaryJudgement)
  })
})

describe('the question put to the summary judge', () => {
  const prompt = buildSummaryPrompt(historyBefore(trace, 5), 'a summary')

  it('puts the whole transcript in front of it', () => {
    expect(prompt).toContain('128 bits long')
    expect(prompt).toContain('fetch_page')
  })

  it('says that an omission is not an unsupported claim', () => {
    // Compaction is lossy by design. A judge that counted every omission as a
    // fault would return `unsupported` on every case and measure nothing.
    expect(prompt).toMatch(/Leaving something out is not unsupported/)
  })

  it('does not tell the judge which answer is the careful one', () => {
    expect(prompt).not.toMatch(/usually/i)
    expect(prompt).not.toMatch(/when in doubt/i)
  })

  it('does not name the numbers this experiment happens to grade on', () => {
    // A judge handed the answer key would pass by checking a list.
    expect(prompt).not.toContain('1,112,064')
    expect(SUMMARY_JUDGE_INSTRUCTIONS).not.toContain('1,112,064')
  })
})
