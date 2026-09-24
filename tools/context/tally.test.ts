import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POSTS_DIR } from '../paths.ts'
import { parseTrace } from '../trace/schema.ts'
import { FACTS } from './task.ts'
import { CONTEXT_LIMIT, RUNS_PER_CONDITION } from '../run-context.ts'
import { MEASURED_MODEL_WINDOW } from '../../agent/src/context.ts'
import {
  batched,
  cents,
  cut,
  factCount,
  meanEstimateError,
  perFact,
  readTally,
  rowsWhere,
  sequential,
  zeroRateUpperBound,
} from './tally.ts'

/*
 * Every number post 7 prints, recomputed from the committed tally.
 *
 * The rule this series runs on: nothing on the page is typed out of a terminal.
 * If the prose and the file drift apart — because a row changed, because a cut
 * was rewritten, because somebody re-ran something — `npm test` says which.
 *
 * The literals here are the literals in `index.mdx`. That is the point of the
 * file.
 */
const POST = join(POSTS_DIR, '07-context')
const rows = readTally(readFileSync(join(POST, 'runs.tsv'), 'utf8'))
const off = rowsWhere(rows, 'off')
const on = rowsWhere(rows, 'on')

describe('the tally the post is written from', () => {
  it('has one row per run, and the same number of runs per condition', () => {
    expect(rows).toHaveLength(RUNS_PER_CONDITION * 2)
    expect(off).toHaveLength(RUNS_PER_CONDITION)
    expect(on).toHaveLength(RUNS_PER_CONDITION)
  })

  it('records every run that was made, including the ones that threw', () => {
    // There is no mechanism in this project for discarding a run, so a row
    // that says `threw` is a row. This asserts none did rather than that none
    // could.
    expect(rows.filter((row) => row.stopped_by === 'threw')).toHaveLength(0)
  })

  it('was run at the ceiling the post says it was', () => {
    // Every request the provider counted is under the program's ceiling, and
    // the ceiling is far under the provider's own.
    expect(CONTEXT_LIMIT).toBe(16_000)
    expect(cut(rows).peakContext).toBeLessThan(CONTEXT_LIMIT)
    expect(MEASURED_MODEL_WINDOW).toBe(266_684)
  })
})

describe('claim two: compaction and the loop', () => {
  it('finishes nothing at all without compaction', () => {
    expect(cut(off).passes).toBe(0)
    expect(cut(off).wroteNote).toBe(0)
  })

  it('ends every uncompacted run the same way', () => {
    expect(cut(off).overflowed).toBe(RUNS_PER_CONDITION)
  })

  it('never compacts in the control, which is what makes it a control', () => {
    expect(cut(off).compactions).toBe(0)
    expect(cut(on).compactions).toBeGreaterThan(0)
  })
})

describe('the composition check', () => {
  /*
   * Post 5's lesson: a causal reading has to be checked against the mix before
   * it is read as an effect. The mix here is whether a run ever pulled more
   * than one page into a single turn, because a turn that fetches three pages
   * adds more than the whole budget in one go and no compaction that preserves
   * the most recent exchange can help.
   */
  it('splits both conditions into two groups that are both populated', () => {
    for (const subset of [off, on]) {
      expect(sequential(subset).length).toBeGreaterThan(0)
      expect(batched(subset).length).toBeGreaterThan(0)
      expect(sequential(subset).length + batched(subset).length).toBe(subset.length)
    }
  })

  it('shows the control failing in both groups, so the control is not a mix effect', () => {
    expect(cut(sequential(off)).passes).toBe(0)
    expect(cut(batched(off)).passes).toBe(0)
  })
})

describe('what compaction cost', () => {
  it('measures the loss against the dropped messages, not against the trace', () => {
    // A trace keeps every frame, including the ones the model was made to
    // forget, so the only place this can be measured is the compaction event.
    const dropped = on.reduce(
      (sum, row) => sum + (row.facts_dropped === 'none' ? 0 : row.facts_dropped.split(' ').length),
      0,
    )
    const kept = on.reduce(
      (sum, row) => sum + (row.facts_kept === 'none' ? 0 : row.facts_kept.split(' ').length),
      0,
    )
    const lost = on.reduce(
      (sum, row) => sum + (row.facts_lost === 'none' ? 0 : row.facts_lost.split(' ').length),
      0,
    )
    expect(dropped).toBeGreaterThan(0)
    expect(kept + lost).toBe(dropped)
  })

  it('has nothing to lose in the control', () => {
    expect(off.every((row) => row.facts_dropped === 'none')).toBe(true)
  })
})

describe('the instruments', () => {
  it('counts each of the three answers in both conditions', () => {
    for (const subset of [off, on]) {
      const counts = perFact(subset)
      expect([...counts.keys()].sort()).toEqual(FACTS.map((f) => f.id).sort())
    }
  })

  it('agrees with itself about how many facts a row carries', () => {
    for (const row of rows) {
      const n = factCount(row)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(FACTS.length)
    }
  })

  it('reports the estimator signed, because the direction is the finding', () => {
    // It reads LOW. That is the direction that lets a request through which the
    // provider would refuse — and it is NOT the direction that would have
    // killed the control early, which is the error this post was at risk of.
    expect(meanEstimateError(off)).toBeLessThan(0)
    expect(meanEstimateError(on)).toBeLessThan(0)
  })

  it('states a detection floor that matches the run count', () => {
    // Post 6's rule: a rate observed zero times needs its upper bound stated.
    expect(zeroRateUpperBound(50)).toBeCloseTo(0.0582, 3)
    expect(zeroRateUpperBound(0)).toBe(1)
  })

  it('counts the summariser into the bill rather than beside it', () => {
    const withSummariser = cents(on, 0.25, 2)
    const withoutSummariser = cents(
      on.map((row) => ({ ...row, summary_input_tokens: '0', summary_output_tokens: '0' })),
      0.25,
      2,
    )
    expect(withSummariser).toBeGreaterThan(withoutSummariser)
  })
})

describe('claim one, from the published trace', () => {
  const trace = parseTrace(
    JSON.parse(readFileSync(join(POST, 'trace-a-off.json'), 'utf8')),
  )

  /*
   * The measurement the corrected thesis rests on, taken off a committed file
   * so a reader can recount it: the context before the run did anything, and
   * the context once one search and one page had come back.
   */
  const before = trace.tokens[0] ?? 0
  const afterOneSearchAndRead = trace.tokens[4] ?? 0
  const oneSearchAndRead = afterOneSearchAndRead - before

  it('starts with the instruction, the tool definitions and the task', () => {
    expect(before).toBe(708)
  })

  it('costs one search and one page read', () => {
    expect(oneSearchAndRead).toBe(5_644)
  })

  it('is a small single-digit share of the window', () => {
    const share = (oneSearchAndRead / MEASURED_MODEL_WINDOW) * 100
    expect(share).toBeGreaterThan(2)
    expect(share).toBeLessThan(2.2)
  })

  it('would take about forty-seven of them to fill it', () => {
    const fills = (MEASURED_MODEL_WINDOW - before) / oneSearchAndRead
    expect(Math.round(fills)).toBe(47)
  })

  it('reads a page that is bigger than everything else in the run so far', () => {
    // The page alone, against the whole context it arrived into.
    const page = afterOneSearchAndRead - (trace.tokens[3] ?? 0)
    expect(page).toBe(5_044)
    // "Nearly four times the whole of the rest of the context."
    expect(page / (trace.tokens[3] ?? 1)).toBeGreaterThan(3.8)
    expect(page / (trace.tokens[3] ?? 1)).toBeLessThan(4)
  })
})

/*
 * The literals the post prints.
 *
 * Post 6's rule, kept: nothing on the page is typed out of a terminal. Every
 * number in the two tables and in the prose around them is recomputed here from
 * `runs.tsv`, so a row that changes makes `npm test` name the sentence that
 * stopped being true.
 */
describe('the numbers in the post', () => {
  const offCut = cut(off)
  const onCut = cut(on)

  it('the table of conditions', () => {
    expect([offCut.runs, onCut.runs]).toEqual([50, 50])
    expect([offCut.passes, onCut.passes]).toEqual([0, 24])
    expect([offCut.wroteNote, onCut.wroteNote]).toEqual([0, 29])
    expect([offCut.overflowed, onCut.overflowed]).toEqual([50, 17])
    expect([offCut.capped, onCut.capped]).toEqual([0, 4])
    expect([
      offCut.runs - offCut.overflowed - offCut.capped,
      onCut.runs - onCut.overflowed - onCut.capped,
    ]).toEqual([0, 29])
    expect((offCut.compactions / offCut.runs).toFixed(1)).toBe('0.0')
    expect((onCut.compactions / onCut.runs).toFixed(1)).toBe('3.7')
    expect((offCut.steps / offCut.runs).toFixed(1)).toBe('5.3')
    expect((onCut.steps / onCut.runs).toFixed(1)).toBe('8.5')
    expect([offCut.peakContext, onCut.peakContext]).toEqual([15_415, 12_823])
  })

  it('the pages fetched per run, which is where the cost is', () => {
    const fetches = (rs: typeof off): string => {
      const total = rs.reduce(
        (sum, row) => sum + row.tools_called.split(' ').filter((t) => t === 'fetch_page').length,
        0,
      )
      return (total / rs.length).toFixed(2)
    }
    expect(fetches(off)).toBe('3.00')
    expect(fetches(on)).toBe('5.54')
  })

  it('the composition table', () => {
    expect([cut(sequential(off)).runs, cut(sequential(off)).passes, cut(sequential(off)).overflowed])
      .toEqual([26, 0, 26])
    expect([cut(batched(off)).runs, cut(batched(off)).passes, cut(batched(off)).overflowed])
      .toEqual([24, 0, 24])
    expect([cut(sequential(on)).runs, cut(sequential(on)).passes, cut(sequential(on)).overflowed])
      .toEqual([18, 11, 0])
    expect([cut(batched(on)).runs, cut(batched(on)).passes, cut(batched(on)).overflowed])
      .toEqual([32, 13, 17])
  })

  it('what the summary carried and what it lost', () => {
    const tally = (key: 'facts_dropped' | 'facts_kept' | 'facts_lost'): number =>
      on.reduce((sum, row) => sum + (row[key] === 'none' ? 0 : row[key].split(' ').length), 0)
    expect(tally('facts_dropped')).toBe(143)
    expect(tally('facts_kept')).toBe(139)
    expect(tally('facts_lost')).toBe(4)
    // All four were the same answer.
    expect(
      new Set(on.filter((row) => row.facts_lost !== 'none').map((row) => row.facts_lost)),
    ).toEqual(new Set(['utf8-codepoints']))
  })

  it('the detection floors the post prints beside its two zeros', () => {
    expect((zeroRateUpperBound(18) * 100).toFixed(1)).toBe('15.3')
    expect((zeroRateUpperBound(50) * 100).toFixed(1)).toBe('5.8')
  })

  it('the requests that actually left the machine', () => {
    expect(rows.reduce((sum, row) => sum + Number(row.live_fetches), 0)).toBe(159)
  })

  it('the estimator, signed, to one decimal', () => {
    expect(meanEstimateError(off).toFixed(1)).toBe('-8.0')
    expect(meanEstimateError(on).toFixed(1)).toBe('-8.1')
  })

  it('the bill, and the summariser inside it', () => {
    expect(Math.round(cents(rows, 0.25, 2))).toBe(226)
    expect(Math.round(cents(on, 0.25, 2))).toBe(174)
    const summariser =
      (onCut.summaryInputTokens / 1_000_000) * 0.25 * 100 +
      (onCut.summaryOutputTokens / 1_000_000) * 2 * 100
    expect(Math.round(summariser)).toBe(96)
  })
})

describe('the second, smaller loss', () => {
  /*
   * The number is right and the attribution is not. Caught only because the
   * grade is per line: two of these three would have passed a check that read
   * the note as one blob.
   */
  const n = (value: string): number => (value === 'none' ? 0 : value.split(' ').length)

  it('counts answers written down against answers written beside their source', () => {
    expect(on.reduce((sum, row) => sum + n(row.facts_anywhere), 0)).toBe(80)
    expect(on.reduce((sum, row) => sum + n(row.facts), 0)).toBe(77)
  })

  it('finds three runs whose number was right and whose citation was not', () => {
    const miscited = on.filter((row) => n(row.facts_anywhere) > n(row.facts))
    expect(miscited).toHaveLength(3)
    expect(
      miscited.filter((row) => n(row.facts_anywhere) === 3 && row.why.startsWith('missing')),
    ).toHaveLength(2)
  })
})
