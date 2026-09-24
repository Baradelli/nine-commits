import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_DIR, fetchPage, webSearch } from '../agent/src/tools/web.ts'
import { FACTS } from './context/task.ts'

/**
 * Fetches, once, everything the experiment will read.
 *
 * Run this and nothing else in the experiment touches somebody else's service.
 * That matters twice over: fifty runs against a live encyclopaedia is fifty
 * runs against fifty slightly different corpora, and it is also fifty times
 * more traffic than one person's blog post has any business generating.
 *
 *   npm run warm
 *
 * It writes `agent/webcache/MANIFEST.md`, which is the thing a reader should
 * look at: what was fetched, when, and how big it was. Neither the manifest nor
 * the cache beside it is committed — `webcache/` is gitignored — so a fresh
 * clone starts cold and has to run this first. After that the runs are
 * reproducible without a network connection, against whatever corpus this
 * fetch happened to get; the post says plainly that a cached corpus is a
 * different experiment from a live one.
 *
 * The queries here are the ones a run is expected to make. A run that searches
 * for something else gets a cache miss and, under `--cache only`, a refusal
 * that shows up in the trace as a failed tool call rather than as a silent
 * live fetch. That is the honest failure: the alternative is a tally where
 * some rows were measured against a page nobody else will ever see.
 */
const QUERIES = [
  'Transmission Control Protocol',
  'TCP header size',
  'IPv6',
  'IPv6 address length',
  'UTF-8',
  'UTF-8 code points',
  'Unicode code points UTF-8 encode',
  'minimum TCP header size bytes',
]

async function main(): Promise<void> {
  let requests = 0
  const onFetch = (): void => {
    requests += 1
  }

  for (const query of QUERIES) {
    const result = await webSearch(query, { cache: 'use', onFetch })
    console.log(
      `search  ${JSON.stringify(query)} — ${
        result.ok ? `${result.results.length} result(s)` : result.error
      }`,
    )
  }

  const pages: { title: string; url: string; chars: number; truncated: boolean }[] = []
  for (const fact of FACTS) {
    const result = await fetchPage(fact.url, { cache: 'use', onFetch })
    if (!result.ok) {
      console.error(`fetch   ${fact.url} — ${result.error}`)
      continue
    }
    pages.push({
      title: result.title,
      url: result.url,
      chars: result.chars,
      truncated: result.truncated,
    })
    console.log(
      `fetch   ${result.title} — ${result.chars} characters${
        result.truncated ? ', truncated for the model' : ''
      }`,
    )
  }

  const files = readdirSync(CACHE_DIR).filter((name) => name.endsWith('.json'))
  const bytes = files.reduce(
    (sum, name) => sum + statSync(join(CACHE_DIR, name)).size,
    0,
  )

  const manifest = [
    '# The cached corpus',
    '',
    'Every run in post 7’s tally read these bytes off this disk. They were',
    'fetched once, from the English Wikipedia through the MediaWiki action API.',
    'Neither this file nor the cache around it is committed: `webcache/` is',
    'gitignored, so a fresh clone starts cold and runs `npm run warm` to get',
    'here. What is reproducible is the procedure, not the bytes — but once the',
    'cache exists the experiment can be re-run without touching somebody',
    'else’s service and without the corpus having moved underneath it.',
    '',
    `Fetched: ${new Date().toISOString()}`,
    `Requests that left the machine during this warm-up: ${requests}`,
    `Cache entries: ${files.length} (${bytes} bytes on disk)`,
    '',
    '## Pages',
    '',
    '| page | characters | handed to the model |',
    '| --- | --- | --- |',
    ...pages.map(
      (page) =>
        `| [${page.title}](${page.url}) | ${page.chars} | ${
          page.truncated ? 'first 24,000' : 'all of it'
        } |`,
    ),
    '',
    '## Searches',
    '',
    ...QUERIES.map((query) => `- \`${query}\``),
    '',
    '## Licence',
    '',
    'Wikipedia article text is available under the Creative Commons',
    'Attribution-ShareAlike licence. The cached responses here, and the extracts',
    'that appear inside the published traces, are quoted from the pages linked',
    'above and remain under that licence.',
    '',
  ].join('\n')

  writeFileSync(join(CACHE_DIR, 'MANIFEST.md'), manifest, 'utf8')
  console.log(`\n${requests} request(s) left the machine; wrote MANIFEST.md`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
