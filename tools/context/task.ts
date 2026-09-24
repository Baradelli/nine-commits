import { articleUrl } from '../../agent/src/tools/web.ts'

/**
 * The one task both conditions run, and why it is this one.
 *
 * Post 7's second claim needs a control, and a control needs a task that
 * genuinely threatens the window. Post 6's tasks could not: they read one
 * ten-line file. So this one reads the web, three times, and three pages of
 * ordinary encyclopaedia prose are larger than everything else in the run put
 * together.
 *
 * Three constraints it was built under, all fixed before the first run:
 *
 * - **Every answer is a distinctive string.** Not `4`, which appears in any
 *   paragraph; `1,112,064`, which appears in one. A grader whose pass condition
 *   can be satisfied by accident is post 4's complaint with the numbers
 *   changed.
 * - **Every answer is inside the part of the page the agent is handed.** The
 *   fetch limit is 24,000 characters and the TCP article is 70,763, so an
 *   answer buried at the end would be measuring the limit rather than the run.
 *   `task.test.ts` asserts all three are reachable, against the page bodies in
 *   the published traces.
 * - **It asks for a citation.** `gpt-5-mini` very probably knows all three of
 *   these without looking, and a task it can answer from memory is not a task
 *   about context. Requiring the URL forces the page into the context, and the
 *   eval's provenance axis then says whether the number came from the page or
 *   from the model — which is the check post 4 built for exactly this.
 */

export const NOTE = 'notes/research.md'

export type Fact = {
  id: string
  /** The page the answer is on, as the run is expected to find it. */
  url: string
  /** What counts as having written the answer down. */
  pattern: RegExp
  /** Why this string and not another, in one line. */
  why: string
}

export const FACTS: readonly Fact[] = [
  {
    id: 'tcp-header',
    url: articleUrl('Transmission Control Protocol'),
    // The number as a standalone number, not as a substring of another one.
    // `2026` and `1200` do not contain this `20`; `20 bytes`, `20-byte` and a
    // bare `20` all do. Post 6's lesson is that a grader over a written
    // product must grade the product and not its formatting, and requiring the
    // unit would have failed a run that answered correctly — which is exactly
    // what the discarded pilot did.
    pattern: /(?<![\d.,])20(?![\d.,])/,
    why: 'the minimum TCP header size, in bytes',
  },
  {
    id: 'ipv6-length',
    url: articleUrl('IPv6'),
    pattern: /(?<![\d.,])128(?![\d.,])/,
    why: 'the length of an IPv6 address, in bits',
  },
  {
    id: 'utf8-codepoints',
    url: articleUrl('UTF-8'),
    pattern: /(?<![\d.])1[\s,. ]?112[\s,. ]?064(?![\d])/,
    why: 'the number of Unicode code points UTF-8 covers',
  },
]

export const PROMPT = [
  'Use the web tools to answer these three questions, then write the answers to',
  `${NOTE} as three lines — one per question, each giving the number and the URL of`,
  'the page you took it from.',
  '',
  '1. What is the minimum size of a TCP header, in bytes?',
  '2. How many bits long is an IPv6 address?',
  '3. How many Unicode code points can UTF-8 encode?',
  '',
  'Look each one up rather than answering from memory: the citation has to be a page you actually fetched.',
].join('\n')

/**
 * Facts the recorder checks for in the final sentence.
 *
 * Deliberately thin. The product of this task is a file, and post 6 is the
 * reason: the sentence grade and the file grade disagreed four times in a
 * hundred and fifty and the file was right every time. This is here so the
 * recorder has something to grade rather than refuse, and the tally reports it
 * next to the file grade rather than instead of it.
 */
export const EXPECT: readonly string[] = [NOTE]

export type Verdict = {
  /** All three answers written down, each on a line that cites its page. */
  pass: boolean
  /** Answers written on a line that also names the page they came from. */
  facts: string[]
  /** Answers written anywhere in the note, cited or not. */
  loose: string[]
  why: string
}

/**
 * Whether a line of the note names the page an answer came from.
 *
 * It has to be the link, not the word. The first version of this accepted the
 * bare article title anywhere on the line, and a test written before the runs
 * caught what that costs: the line
 *
 *   IPv6 address length: 128 bits — https://en.wikipedia.org/wiki/IP_address
 *
 * says `IPv6` in its own prose, so a title match passed a line whose citation
 * pointed at a different page. The task asked for a URL; the grader now asks
 * for one too.
 *
 * Both spellings of the path are accepted — underscores as the search results
 * give them, and spaces as a model sometimes writes them — because that is
 * formatting rather than provenance.
 */
function cites(line: string, fact: Fact): boolean {
  const encoded = fact.url.split('/wiki/')[1] ?? ''
  const title = decodeURIComponent(encoded)
  return (
    line.includes(`/wiki/${encoded}`) ||
    line.includes(`/wiki/${title}`) ||
    line.includes(`/wiki/${title.replace(/_/g, ' ')}`)
  )
}

/**
 * The note, graded line by line rather than as one blob.
 *
 * The line is the unit because the task asks for one per question, and because
 * a blob check passes a note that says the TCP header is 128 bytes and an IPv6
 * address is 20 bits: both numbers are present, both citations are present,
 * and every one of the four pairings is wrong. Requiring the number and its
 * source on the same line is what ties an answer to its question.
 */
export function check(after: Readonly<Record<string, string>>): Verdict {
  const note = after[NOTE]
  if (note === undefined) {
    return { pass: false, facts: [], loose: [], why: `no ${NOTE}` }
  }

  const lines = note.split(/\r\n|\r|\n/)
  const facts = FACTS.filter((fact) =>
    lines.some((line) => fact.pattern.test(line) && cites(line, fact)),
  ).map((f) => f.id)
  // The same answers without the citation rule, so the tally can show how
  // often the two differ rather than only the stricter number.
  const loose = FACTS.filter((fact) => fact.pattern.test(note)).map((f) => f.id)

  const stray = Object.keys(after)
    .filter((file) => file !== NOTE)
    .sort()
  if (stray.length > 0) {
    return { pass: false, facts, loose, why: `also wrote ${stray.join(', ')}` }
  }
  if (facts.length < FACTS.length) {
    const missing = FACTS.filter((f) => !facts.includes(f.id)).map((f) => f.id)
    return { pass: false, facts, loose, why: `missing ${missing.join(', ')}` }
  }
  return { pass: true, facts, loose, why: 'three answers, each with its source' }
}
